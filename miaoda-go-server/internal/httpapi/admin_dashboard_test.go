package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
)

func TestCatalogSaleMatchesPublishedPrices(t *testing.T) {
	tests := []struct {
		seconds int64
		written float64
		cents   int64
	}{
		{10 * 60, 0, 190},
		{60 * 60, 0, 990},
		{2 * 60 * 60, 0, 1690},
		{5 * 60 * 60, 0, 3690},
		{10 * 60 * 60, 0, 6990},
		{0, 5, 190},
		{0, 30, 990},
		{0, 80, 1690},
		{0, 200, 3690},
		{0, 450, 6990},
	}
	for _, test := range tests {
		item, ok := catalogSale(test.seconds, test.written)
		if !ok || item.UnitPriceCents != test.cents {
			t.Errorf("catalogSale(%d,%g)=%#v,%v want %d cents", test.seconds, test.written, item, ok, test.cents)
		}
	}
	for _, unpriced := range [][2]float64{{3600, 5}, {3 * 3600, 0}, {0, 50}} {
		if item, ok := catalogSale(int64(unpriced[0]), unpriced[1]); ok {
			t.Errorf("custom or combined quota unexpectedly priced: %#v", item)
		}
	}
}

func TestDashboardCountsUniqueVisitorsAndImmutableSalesLedger(t *testing.T) {
	_, db := accountTestServer(t)
	adminPassword := "dashboard-admin-password-123456"
	server := New(config.Config{
		JWTSecret:  strings.Repeat("d", 40),
		TokenTTL:   time.Hour,
		AdminToken: adminPassword,
	}, db)
	router := server.Router()

	for _, visitorID := range []string{"visitor-aaaaaaaaaaaaaaaa", "visitor-aaaaaaaaaaaaaaaa", "visitor-bbbbbbbbbbbbbbbb"} {
		recorder, _ := accountJSON(t, router, http.MethodPost, "/api/public/site-visit", map[string]string{"visitorId": visitorID}, "")
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("site visit status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	var storedHash string
	if err := db.DB.QueryRow("SELECT visitor_hash FROM site_daily_visitors LIMIT 1").Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash == "visitor-aaaaaaaaaaaaaaaa" || len(storedHash) != 64 {
		t.Fatalf("raw visitor identifier was stored: %q", storedHash)
	}
	yesterday := time.Now().In(chinaTime).AddDate(0, 0, -1)
	if err := db.RecordSiteVisit(t.Context(), yesterday.Format("2006-01-02"), strings.Repeat("f", 64), yesterday.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}

	register, registered := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "SalesDashboardUser", "password": "password8", "deviceId": "dashboard-web", "platform": "web",
	}, "")
	if register.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	userToken, _ := registered["token"].(string)
	nowChina := time.Now().In(chinaTime)
	todayChina := time.Date(nowChina.Year(), nowChina.Month(), nowChina.Day(), 0, 30, 0, 0, chinaTime)
	if _, err := db.DB.Exec("UPDATE users SET created_at=? WHERE username=?", todayChina.UTC().Format(time.RFC3339Nano), "SalesDashboardUser"); err != nil {
		t.Fatal(err)
	}

	createAndRedeem := func(seconds int64, written float64, count int, platform string) string {
		t.Helper()
		created, payload := adminJSON(t, router, http.MethodPost, "/api/admin/cards/create", map[string]any{
			"count": count, "interviewSeconds": seconds, "writtenQuestions": written, "salesPlatform": platform,
		}, adminPassword, "")
		if created.Code != http.StatusOK {
			t.Fatalf("create cards status=%d body=%s", created.Code, created.Body.String())
		}
		batch := payload["batch"].(map[string]any)
		for _, raw := range payload["cards"].([]any) {
			redeem, _ := accountJSON(t, router, http.MethodPost, "/api/account/redeem", map[string]string{"cardKey": raw.(string)}, userToken)
			if redeem.Code != http.StatusOK {
				t.Fatalf("redeem status=%d body=%s", redeem.Code, redeem.Body.String())
			}
		}
		return batch["batchCode"].(string)
	}
	interviewBatch := createAndRedeem(10*60, 0, 2, "taobao")
	createAndRedeem(0, 30, 1, "liandong")
	createAndRedeem(60*60, 5, 1, "taobao")

	type dashboardResponse struct {
		Visitor struct {
			TodayUnique int64 `json:"todayUnique"`
			TodayViews  int64 `json:"todayViews"`
			TotalUnique int64 `json:"totalUnique"`
			TotalViews  int64 `json:"totalViews"`
			Days        []struct {
				Date           string `json:"date"`
				UniqueVisitors int64  `json:"uniqueVisitors"`
				PageViews      int64  `json:"pageViews"`
			} `json:"days"`
		} `json:"visitor"`
		Sales struct {
			RedeemedCards         int64 `json:"redeemedCards"`
			PricedCards           int64 `json:"pricedCards"`
			UnpricedCards         int64 `json:"unpricedCards"`
			EstimatedRevenueCents int64 `json:"estimatedRevenueCents"`
			Products              []struct {
				ID        string `json:"id"`
				SoldCount int64  `json:"soldCount"`
			} `json:"products"`
			Platforms []struct {
				ID            string `json:"id"`
				SoldCount     int64  `json:"soldCount"`
				UnpricedCount int64  `json:"unpricedCount"`
				RevenueCents  int64  `json:"revenueCents"`
			} `json:"platforms"`
		} `json:"sales"`
		Users struct {
			Total    int64 `json:"total"`
			TodayNew int64 `json:"todayNew"`
			Days     []struct {
				Date     string `json:"date"`
				NewUsers int64  `json:"newUsers"`
			} `json:"days"`
		} `json:"users"`
	}
	loadDashboard := func() dashboardResponse {
		t.Helper()
		recorder, _ := adminJSON(t, router, http.MethodGet, "/api/admin/dashboard?days=30", nil, adminPassword, "")
		if recorder.Code != http.StatusOK {
			t.Fatalf("dashboard status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var dashboard dashboardResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &dashboard); err != nil {
			t.Fatal(err)
		}
		return dashboard
	}
	dashboard := loadDashboard()
	if dashboard.Visitor.TodayUnique != 2 || dashboard.Visitor.TodayViews != 3 || dashboard.Visitor.TotalUnique != 3 || dashboard.Visitor.TotalViews != 4 || len(dashboard.Visitor.Days) != 30 {
		t.Fatalf("unexpected visitor summary: %#v", dashboard.Visitor)
	}
	if dashboard.Sales.RedeemedCards != 4 || dashboard.Sales.PricedCards != 3 || dashboard.Sales.UnpricedCards != 1 || dashboard.Sales.EstimatedRevenueCents != 1370 || dashboard.Users.Total != 1 {
		t.Fatalf("unexpected dashboard totals: sales=%#v users=%#v", dashboard.Sales, dashboard.Users)
	}
	if dashboard.Users.TodayNew != 1 || len(dashboard.Users.Days) != 30 || dashboard.Users.Days[len(dashboard.Users.Days)-1].Date != todayChina.Format("2006-01-02") || dashboard.Users.Days[len(dashboard.Users.Days)-1].NewUsers != 1 {
		t.Fatalf("unexpected daily user growth: %#v", dashboard.Users)
	}
	productCounts := map[string]int64{}
	for _, product := range dashboard.Sales.Products {
		productCounts[product.ID] = product.SoldCount
	}
	if productCounts["interview-10m"] != 2 || productCounts["written-30"] != 1 {
		t.Fatalf("unexpected product counts: %#v", productCounts)
	}
	platforms := map[string]struct {
		sold, unpriced, revenue int64
	}{}
	for _, platform := range dashboard.Sales.Platforms {
		platforms[platform.ID] = struct {
			sold, unpriced, revenue int64
		}{platform.SoldCount, platform.UnpricedCount, platform.RevenueCents}
	}
	if platforms["taobao"] != (struct{ sold, unpriced, revenue int64 }{3, 1, 380}) ||
		platforms["liandong"] != (struct{ sold, unpriced, revenue int64 }{1, 0, 990}) {
		t.Fatalf("unexpected platform totals: %#v", platforms)
	}

	deleted, _ := adminJSON(t, router, http.MethodDelete, "/api/admin/card-batches/"+interviewBatch, nil, adminPassword, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete redeemed batch status=%d body=%s", deleted.Code, deleted.Body.String())
	}
	dashboardAfterDelete := loadDashboard()
	if dashboardAfterDelete.Sales.RedeemedCards != 4 || dashboardAfterDelete.Sales.EstimatedRevenueCents != 1370 {
		t.Fatalf("sales ledger changed after deleting cards: %#v", dashboardAfterDelete.Sales)
	}
	var ledgerCount int
	if err := db.DB.QueryRow("SELECT count(*) FROM sales_ledger").Scan(&ledgerCount); err != nil || ledgerCount != 4 {
		t.Fatalf("sales ledger count=%d err=%v", ledgerCount, err)
	}
}
