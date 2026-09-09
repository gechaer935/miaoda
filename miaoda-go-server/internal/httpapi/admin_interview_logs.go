package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	store "example.com/miaoda/server/internal/store/sqlite"
)

func (s *Server) adminInterviewLogs(w http.ResponseWriter, r *http.Request) {
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
	summary, err := s.store.InterviewLogSummary(r.Context(), today)
	if err != nil {
		fail(w, http.StatusInternalServerError, "interview_logs_failed", "读取今日面试请求统计失败")
		return
	}
	recordedDays, err := s.store.InterviewLogDays(r.Context(), start, today)
	if err != nil {
		fail(w, http.StatusInternalServerError, "interview_logs_failed", "读取面试请求趋势失败")
		return
	}
	recordedByDate := make(map[string]store.InterviewLogDay, len(recordedDays))
	for _, day := range recordedDays {
		recordedByDate[day.Date] = day
	}
	filledDays := make([]store.InterviewLogDay, 0, days)
	for offset := days - 1; offset >= 0; offset-- {
		date := now.AddDate(0, 0, -offset).Format("2006-01-02")
		day := recordedByDate[date]
		day.Date = date
		filledDays = append(filledDays, day)
	}
	selectedDate := strings.TrimSpace(r.URL.Query().Get("date"))
	selectedRequests := make([]store.InterviewRequestLog, 0)
	selectedPage := 1
	selectedPageSize := 15
	selectedTotal := 0
	selectedTotalPages := 0
	if selectedDate != "" {
		if _, parseErr := time.Parse("2006-01-02", selectedDate); parseErr != nil || selectedDate < start || selectedDate > today {
			fail(w, http.StatusBadRequest, "invalid_interview_log_date", "请选择最近 30 天内的有效日期")
			return
		}
		selectedPage, _ = strconv.Atoi(r.URL.Query().Get("page"))
		if selectedPage < 1 {
			selectedPage = 1
		}
		requestedPageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		if requestedPageSize == 30 {
			selectedPageSize = 30
		}
		selectedTotal = int(recordedByDate[selectedDate].Requests)
		if selectedTotal > 0 {
			selectedTotalPages = (selectedTotal + selectedPageSize - 1) / selectedPageSize
			if selectedPage > selectedTotalPages {
				selectedPage = selectedTotalPages
			}
		}
		selectedRequests, err = s.store.InterviewLogsByDatePage(r.Context(), selectedDate, selectedPageSize, (selectedPage-1)*selectedPageSize)
		if err != nil {
			fail(w, http.StatusInternalServerError, "interview_logs_failed", "读取当天面试请求失败")
			return
		}
	}
	write(w, http.StatusOK, map[string]any{
		"today":              summary,
		"days":               filledDays,
		"selectedDate":       selectedDate,
		"selectedRequests":   selectedRequests,
		"selectedPage":       selectedPage,
		"selectedPageSize":   selectedPageSize,
		"selectedTotal":      selectedTotal,
		"selectedTotalPages": selectedTotalPages,
		"serverTime":         time.Now().UTC().Format(time.RFC3339Nano),
		"refreshSeconds":     5,
		"privacyNotice":      "记录问题内容、用户、模型、状态与错误摘要，用于排查重复触发；不保存回答、简历和上下文。",
	})
}
