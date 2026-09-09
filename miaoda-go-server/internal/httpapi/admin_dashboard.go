package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	store "example.com/miaoda/server/internal/store/sqlite"
)

var siteVisitorIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

var chinaTime = time.FixedZone("Asia/Shanghai", 8*60*60)

func (s *Server) recordSiteVisit(w http.ResponseWriter, r *http.Request) {
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var q struct {
		VisitorID string `json:"visitorId"`
	}
	if !decode(w, r, &q) {
		return
	}
	q.VisitorID = strings.TrimSpace(q.VisitorID)
	if !siteVisitorIDPattern.MatchString(q.VisitorID) {
		fail(w, http.StatusBadRequest, "invalid_visitor_id", "访客标识格式无效")
		return
	}
	if !s.authGuard.allow("site-visit:ip:"+clientIP(r), 240, time.Hour) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	_, _ = mac.Write([]byte("miaoda-site-visitor:" + q.VisitorID))
	visitorHash := hex.EncodeToString(mac.Sum(nil))
	seenAt := time.Now()
	if err := s.store.RecordSiteVisit(r.Context(), seenAt.In(chinaTime).Format("2006-01-02"), visitorHash, seenAt.UTC().Format(time.RFC3339Nano)); err != nil {
		fail(w, http.StatusInternalServerError, "visit_record_failed", "访问统计暂时不可用")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type salesCatalogItem struct {
	ID               string
	Category         string
	Label            string
	InterviewSeconds int64
	WrittenQuestions float64
	UnitPriceCents   int64
}

var salesCatalog = []salesCatalogItem{
	{ID: "interview-10m", Category: "interview", Label: "面试 10 分钟", InterviewSeconds: 10 * 60, UnitPriceCents: 190},
	{ID: "interview-1h", Category: "interview", Label: "面试 1 小时", InterviewSeconds: 60 * 60, UnitPriceCents: 990},
	{ID: "interview-2h", Category: "interview", Label: "面试 2 小时", InterviewSeconds: 2 * 60 * 60, UnitPriceCents: 1690},
	{ID: "interview-5h", Category: "interview", Label: "面试 5 小时", InterviewSeconds: 5 * 60 * 60, UnitPriceCents: 3690},
	{ID: "interview-10h", Category: "interview", Label: "面试 10 小时", InterviewSeconds: 10 * 60 * 60, UnitPriceCents: 6990},
	{ID: "written-5", Category: "written", Label: "笔试 5 次", WrittenQuestions: 5, UnitPriceCents: 190},
	{ID: "written-30", Category: "written", Label: "笔试 30 次", WrittenQuestions: 30, UnitPriceCents: 990},
	{ID: "written-80", Category: "written", Label: "笔试 80 次", WrittenQuestions: 80, UnitPriceCents: 1690},
	{ID: "written-200", Category: "written", Label: "笔试 200 次", WrittenQuestions: 200, UnitPriceCents: 3690},
	{ID: "written-450", Category: "written", Label: "笔试 450 次", WrittenQuestions: 450, UnitPriceCents: 6990},
}

func catalogSale(seconds int64, written float64) (salesCatalogItem, bool) {
	for _, item := range salesCatalog {
		if seconds > 0 && written == 0 && item.InterviewSeconds == seconds && item.WrittenQuestions == 0 {
			return item, true
		}
		if seconds == 0 && item.InterviewSeconds == 0 && math.Abs(item.WrittenQuestions-written) < 0.000001 {
			return item, true
		}
	}
	return salesCatalogItem{}, false
}

func salesQuotaLabel(seconds int64, written float64) string {
	parts := make([]string, 0, 2)
	if seconds > 0 {
		parts = append(parts, "面试"+interviewQuotaName(seconds))
	}
	if written > 0 {
		parts = append(parts, "笔试"+strconv.FormatFloat(written, 'f', -1, 64)+"次")
	}
	if len(parts) == 0 {
		return "空额度"
	}
	return strings.Join(parts, " + ")
}

type adminSalesProduct struct {
	ID             string `json:"id"`
	Category       string `json:"category"`
	Label          string `json:"label"`
	UnitPriceCents int64  `json:"unitPriceCents"`
	SoldCount      int64  `json:"soldCount"`
	RevenueCents   int64  `json:"revenueCents"`
}

type adminSalesPlatform struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	SoldCount     int64  `json:"soldCount"`
	PricedCount   int64  `json:"pricedCount"`
	UnpricedCount int64  `json:"unpricedCount"`
	RevenueCents  int64  `json:"revenueCents"`
}

type adminUnpricedSale struct {
	Label         string `json:"label"`
	Platform      string `json:"platform"`
	PlatformLabel string `json:"platformLabel"`
	SoldCount     int64  `json:"soldCount"`
}

type adminSalesSummary struct {
	RedeemedCards         int64                `json:"redeemedCards"`
	PricedCards           int64                `json:"pricedCards"`
	UnpricedCards         int64                `json:"unpricedCards"`
	EstimatedRevenueCents int64                `json:"estimatedRevenueCents"`
	Products              []adminSalesProduct  `json:"products"`
	Platforms             []adminSalesPlatform `json:"platforms"`
	Unpriced              []adminUnpricedSale  `json:"unpriced"`
}

func salesPlatformLabel(platform string) string {
	switch platform {
	case "taobao":
		return "淘宝"
	case "xianyu":
		return "闲鱼"
	case "liandong":
		return "链动小铺"
	default:
		return "历史/未归类"
	}
}

func summarizeSales(groups []store.RedemptionSalesGroup) adminSalesSummary {
	summary := adminSalesSummary{
		Products:  make([]adminSalesProduct, 0, len(salesCatalog)),
		Platforms: make([]adminSalesPlatform, 0, 4),
		Unpriced:  make([]adminUnpricedSale, 0),
	}
	productIndexes := make(map[string]int, len(salesCatalog))
	for _, item := range salesCatalog {
		productIndexes[item.ID] = len(summary.Products)
		summary.Products = append(summary.Products, adminSalesProduct{
			ID: item.ID, Category: item.Category, Label: item.Label, UnitPriceCents: item.UnitPriceCents,
		})
	}
	platformIndexes := map[string]int{}
	for _, platform := range []string{"taobao", "xianyu", "liandong", "legacy"} {
		platformIndexes[platform] = len(summary.Platforms)
		summary.Platforms = append(summary.Platforms, adminSalesPlatform{ID: platform, Label: salesPlatformLabel(platform)})
	}
	for _, group := range groups {
		platform := group.SalesPlatform
		platformIndex, exists := platformIndexes[platform]
		if !exists {
			platform = "legacy"
			platformIndex = platformIndexes[platform]
		}
		summary.RedeemedCards += group.Count
		summary.Platforms[platformIndex].SoldCount += group.Count
		item, priced := catalogSale(group.InterviewSeconds, group.WrittenQuestions)
		if !priced {
			summary.UnpricedCards += group.Count
			summary.Platforms[platformIndex].UnpricedCount += group.Count
			summary.Unpriced = append(summary.Unpriced, adminUnpricedSale{
				Label:         salesQuotaLabel(group.InterviewSeconds, group.WrittenQuestions),
				Platform:      platform,
				PlatformLabel: salesPlatformLabel(platform),
				SoldCount:     group.Count,
			})
			continue
		}
		revenue := group.Count * item.UnitPriceCents
		summary.PricedCards += group.Count
		summary.EstimatedRevenueCents += revenue
		productIndex := productIndexes[item.ID]
		summary.Products[productIndex].SoldCount += group.Count
		summary.Products[productIndex].RevenueCents += revenue
		summary.Platforms[platformIndex].PricedCount += group.Count
		summary.Platforms[platformIndex].RevenueCents += revenue
	}
	return summary
}

func (s *Server) adminDashboard(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 {
		days = 30
	}
	if days > 90 {
		days = 90
	}
	now := time.Now().In(chinaTime)
	today := now.Format("2006-01-02")
	start := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	visitorTotals, recordedDays, err := s.store.SiteVisitStats(r.Context(), start, today)
	if err != nil {
		fail(w, http.StatusInternalServerError, "dashboard_failed", "读取访问统计失败")
		return
	}
	recordedByDate := make(map[string]store.SiteVisitDay, len(recordedDays))
	for _, day := range recordedDays {
		recordedByDate[day.Date] = day
	}
	visitorDays := make([]store.SiteVisitDay, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		date := now.AddDate(0, 0, -offset).Format("2006-01-02")
		day := recordedByDate[date]
		day.Date = date
		visitorDays = append(visitorDays, day)
	}
	recordedUserDays, err := s.store.UserSignupStats(r.Context(), start, today)
	if err != nil {
		fail(w, http.StatusInternalServerError, "dashboard_failed", "读取新增用户统计失败")
		return
	}
	recordedUsersByDate := make(map[string]store.UserSignupDay, len(recordedUserDays))
	for _, day := range recordedUserDays {
		recordedUsersByDate[day.Date] = day
	}
	userDays := make([]store.UserSignupDay, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		date := now.AddDate(0, 0, -offset).Format("2006-01-02")
		day := recordedUsersByDate[date]
		day.Date = date
		userDays = append(userDays, day)
	}
	salesGroups, err := s.store.RedemptionSalesGroups(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "dashboard_failed", "读取销售统计失败")
		return
	}
	userCount, err := s.store.UserCount(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "dashboard_failed", "读取用户统计失败")
		return
	}
	write(w, http.StatusOK, map[string]any{
		"generatedAt": time.Now().UTC(),
		"visitor": map[string]any{
			"todayUnique": visitorTotals.TodayUnique,
			"todayViews":  visitorTotals.TodayViews,
			"totalUnique": visitorTotals.TotalUnique,
			"totalViews":  visitorTotals.TotalViews,
			"days":        visitorDays,
		},
		"sales": summarizeSales(salesGroups),
		"users": map[string]any{
			"total":    userCount,
			"todayNew": userDays[len(userDays)-1].NewUsers,
			"days":     userDays,
		},
		"notice": fmt.Sprintf("访问统计自埋点启用后累计，当前展示最近 %d 天；销售收入按已兑换且精确匹配固定套餐的卡密估算。", days),
	})
}
