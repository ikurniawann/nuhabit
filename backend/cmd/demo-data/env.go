package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/migrate"
	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/database"
)

// open reads DATABASE_URL (shell env, then .env.local, then .env under
// root), refuses a remote target without allowRemote or ALLOW_REMOTE_DB=1,
// and connects. The URL is only ever printed masked.
func open(root string, allowRemote bool) *pgxpool.Pool {
	config.LoadDotenv(filepath.Join(root, ".env.local"), filepath.Join(root, ".env"))
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fail("ERROR: Set DATABASE_URL di .env.local")
	}
	if allowRemote || os.Getenv("ALLOW_REMOTE_DB") == "1" {
		fmt.Fprintf(os.Stderr, "[warn] --allow-remote: target %s\n", migrate.MaskURL(url))
	} else if !migrate.IsLocalURL(url) {
		fail("REFUSED: DATABASE_URL harus mengarah ke Postgres lokal. Untuk target remote, tambahkan -allow-remote atau ALLOW_REMOTE_DB=1.")
	}
	db, err := database.Open(context.Background(), url)
	if err != nil {
		fail("ERROR: " + err.Error())
	}
	return db
}

// backendRoot is BACKEND_ROOT, else the nearest directory above the working
// directory that holds go.mod, as in cmd/migrate.
func backendRoot() string {
	if r := os.Getenv("BACKEND_ROOT"); r != "" {
		return r
	}
	dir, err := os.Getwd()
	if err != nil {
		return "."
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d
		}
		if filepath.Dir(d) == d {
			return dir
		}
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
