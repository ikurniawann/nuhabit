// Command api serves the Go HTTP API: the modules selected by MODULES plus
// /health and /ready.
//
//	go -C backend run ./cmd/api
//	api -routes        # print the route manifest for frontend/src/lib/go-routes.generated.json
//	api -healthcheck   # probe the local /health and exit 0/1 (container HEALTHCHECK)
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ocr"
	"nuhabit/backend/internal/platform/outbox"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "GET http://127.0.0.1:$PORT/health and exit 0 when it answers 200")
	routes := flag.Bool("routes", false, "print every module route as JSON (the Next proxy manifest) and exit")
	flag.Parse()

	if *routes {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(app.Routes()); err != nil {
			os.Exit(1)
		}
		return
	}

	// Shell env wins, then backend/.env.local, then backend/.env.
	config.LoadDotenv(".env.local", ".env")
	cfg := config.Load()

	if *healthcheck {
		os.Exit(probe(cfg.Port))
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel()}))
	slog.SetDefault(log)
	if err := cfg.Validate(); err != nil {
		log.Error("api stopped", "error", err)
		os.Exit(1)
	}
	disabled := config.DisabledIntegrations(os.Getenv)
	if !ocr.New().Available() {
		disabled = append(disabled, "OCR struk dan lampiran (tesseract tidak ditemukan)")
	}
	if len(disabled) > 0 {
		log.Warn("integrasi opsional nonaktif", "disabled", disabled)
	}
	if err := run(cfg, log); err != nil {
		log.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(cfg config.Config, log *slog.Logger) error {
	if loc, err := time.LoadLocation(cfg.TimeZone); err == nil {
		time.Local = loc
	} else {
		log.Warn("unknown TZ, keeping system zone", "tz", cfg.TimeZone, "error", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	openCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	db, err := database.Open(openCtx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		return err
	}
	defer db.Close()

	deps := module.Deps{
		DB:     db,
		Auth:   auth.NewService(db, log, time.Now, auth.Options{DatabaseURL: cfg.DatabaseURL, Production: cfg.IsProduction()}),
		Log:    log,
		Now:    time.Now,
		Config: cfg,
		Events: outbox.NewBus(db, log),
	}
	handler, mounted := app.Handler(deps, time.Now())
	go func() {
		if err := deps.Events.Run(ctx, 5*time.Second, 7*24*time.Hour); err != nil {
			log.Error("outbox dispatcher stopped", "error", err)
		}
	}()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// Streams end when shutdown starts instead of holding it for 20 s.
	draining := make(chan struct{})
	srv.BaseContext = func(net.Listener) context.Context { return httpx.WithShutdown(context.Background(), draining) }
	srv.RegisterOnShutdown(func() { close(draining) })
	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", srv.Addr, "env", cfg.AppEnv, "modules", mounted)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelShutdown()
	return srv.Shutdown(shutdownCtx)
}

func logLevel() slog.Level {
	var l slog.Level
	if err := l.UnmarshalText([]byte(os.Getenv("LOG_LEVEL"))); err != nil {
		return slog.LevelInfo
	}
	return l
}

func probe(port string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/health", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
