package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"example.com/miaoda/server/internal/config"
	"example.com/miaoda/server/internal/httpapi"
	store "example.com/miaoda/server/internal/store/sqlite"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	cfg, e := config.Load()
	if e != nil {
		slog.Error("invalid configuration", "error", e)
		os.Exit(1)
	}
	db, e := store.Open(cfg.DatabasePath)
	if e != nil {
		slog.Error("database open failed", "error", e)
		os.Exit(1)
	}
	defer db.DB.Close()
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.New(cfg, db).Router(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       75 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	go func() {
		slog.Info("miaoda server listening", "addr", cfg.Addr)
		if e := srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			slog.Error("server failed", "error", e)
			os.Exit(1)
		}
	}()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}
