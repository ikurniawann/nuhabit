// Command gym-opening-balance opens the deferred revenue of gym packages
// sold before the gym journals existed, after pinning old credit deductions
// to their lots. See backend/docs/GYM_OPENING_BALANCE.md.
//
//	go -C backend run ./cmd/gym-opening-balance -dry-run   # list per purchase, write nothing
//	go -C backend run ./cmd/gym-opening-balance            # pin, mark and publish the journals
//
// Target: DATABASE_URL (shell env, then backend/.env.local, then
// backend/.env). Remote targets are refused unless -allow-remote or
// ALLOW_REMOTE_DB=1. The journals go through the outbox; the API process
// posts them.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"time"
	_ "time/tzdata" // zone names resolve without the OS zoneinfo, as in cmd/api

	"nuhabit/backend/internal/migrate"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/database"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "list what would be pinned and posted, write nothing")
	allowRemote := flag.Bool("allow-remote", false, "allow a non-local target")
	userID := flag.String("user", "", "user id recorded on the journals (optional)")
	flag.Parse()

	root := backendRoot()
	config.LoadDotenv(filepath.Join(root, ".env.local"), filepath.Join(root, ".env"))
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fail("ERROR: Set DATABASE_URL di .env.local")
	}
	if *allowRemote || os.Getenv("ALLOW_REMOTE_DB") == "1" {
		fmt.Fprintf(os.Stderr, "[warn] --allow-remote: target %s\n", migrate.MaskURL(url))
	} else if !migrate.IsLocalURL(url) {
		fail("REFUSED: DATABASE_URL harus mengarah ke Postgres lokal. Untuk target remote, tambahkan -allow-remote atau ALLOW_REMOTE_DB=1.")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	db, err := database.Open(ctx, url)
	if err != nil {
		fail("ERROR: " + err.Error())
	}
	defer db.Close()
	if *dryRun {
		fmt.Println("Dry run: tidak ada yang ditulis.")
	}
	err = gymcredits.RunOpeningBalance(ctx, db, gymcredits.OpeningOptions{DryRun: *dryRun, UserID: *userID, Now: time.Now(), Out: os.Stdout})
	if err != nil {
		fail("ERROR: " + err.Error())
	}
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
