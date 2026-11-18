package database_test

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/database"
)

func TestSlowQueryLog(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	ctx := context.Background()
	db, err := database.Open(ctx, url, 40*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(ctx, `SELECT 1 WHERE $1 = 'rahasia-cepat'`, "rahasia-cepat"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "SELECT pg_sleep(0.08),\n   $1::text", "rahasia-lambat"); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if strings.Count(out, "slow query") != 1 || !strings.Contains(out, "SELECT pg_sleep(0.08), $1::text") {
		t.Fatalf("want one slow query line with the compacted SQL, got:\n%s", out)
	}
	if strings.Contains(out, "rahasia") {
		t.Fatalf("arguments must not be logged:\n%s", out)
	}
}
