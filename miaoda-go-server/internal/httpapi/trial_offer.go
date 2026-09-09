package httpapi

import (
	"net/http"

	store "example.com/miaoda/server/internal/store/sqlite"
)

func (s *Server) adminTrialOffer(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	settings, err := s.store.TrialOfferSettings(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "读取新客赠送配置失败")
		return
	}
	write(w, http.StatusOK, settings)
}

func (s *Server) updateAdminTrialOffer(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var request store.TrialOfferSettings
	if !decode(w, r, &request) {
		return
	}
	settings, err := s.store.UpdateTrialOfferSettings(r.Context(), request)
	if err != nil {
		fail(w, http.StatusBadRequest, "validation_failed", "配置无效：面试额度最多 24 小时，笔试额度最多 100 次，单 IP 最多 1～20 个赠送账号，限制周期最多 365 天")
		return
	}
	write(w, http.StatusOK, settings)
}
