// Command migrate applies backend/database/migrations to PostgreSQL. It is
// the Go port of backend/database/scripts/apply-migrations.js.
//
//	go -C backend run ./cmd/migrate            # dry run (read-only)
//	go -C backend run ./cmd/migrate -apply     # execute
//	go -C backend run ./cmd/migrate -verify    # compare the schema with a fresh replay
//
// Target: MIGRATE_DATABASE_URL, else DATABASE_URL. Precedence: shell env,
// then backend/.env.local, then backend/.env. Remote targets are refused
// unless -allow-remote or ALLOW_REMOTE_DB=1. -verify exits 3 on drift.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"

	"nuhabit/backend/internal/migrate"
	"nuhabit/backend/internal/platform/config"
)

func main() {
	apply := flag.Bool("apply", false, "execute pending migrations (default is a dry run)")
	allowRemote := flag.Bool("allow-remote", false, "allow a non-local target")
	verify := flag.Bool("verify", false, "replay every migration into a shadow database and report schema drift in the target")
	shadow := flag.String("shadow", "", "empty database for -verify (default: a scratch database created on the target's server)")
	flag.Parse()

	root := backendRoot()
	config.LoadDotenv(filepath.Join(root, ".env.local"), filepath.Join(root, ".env"))

	url := os.Getenv("MIGRATE_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		fail("ERROR: Set MIGRATE_DATABASE_URL (target Postgres lokal) di .env.local")
	}
	dir := os.Getenv("MIGRATIONS_DIR")
	if dir == "" {
		dir = filepath.Join(root, "database", "migrations")
	}

	if *allowRemote || os.Getenv("ALLOW_REMOTE_DB") == "1" {
		fmt.Fprintf(os.Stderr, "[warn] --allow-remote: apply ke %s\n", migrate.MaskURL(url))
	} else if !migrate.IsLocalURL(url) {
		fail("REFUSED: MIGRATE_DATABASE_URL harus mengarah ke Postgres lokal (localhost/127.0.0.1), bukan database remote/production.\n" +
			"Untuk target remote (mis. server-sulu), tambahkan -allow-remote atau ALLOW_REMOTE_DB=1.")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var err error
	if *verify {
		err = migrate.Verify(ctx, migrate.VerifyOptions{URL: url, ShadowURL: *shadow, Dir: dir, Out: os.Stdout})
	} else {
		err = migrate.Run(ctx, migrate.Options{URL: url, Dir: dir, Apply: *apply, Out: os.Stdout, Err: os.Stderr})
	}
	if errors.Is(err, migrate.ErrDrift) {
		// Distinct from 1 so a deploy can stop on drift but only warn when the
		// check itself could not run (no CREATEDB for the scratch database).
		fmt.Fprintln(os.Stderr, "Fatal: "+err.Error())
		os.Exit(3)
	}
	if err != nil {
		fail("Fatal: " + err.Error())
	}
}

// backendRoot is the directory holding go.mod: the working directory under
// `go -C backend run`, or BACKEND_ROOT when set (container images).
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
