// Command demo-users creates the demo accounts for internal walkthroughs,
// one per role plus a member, and resets their passwords on every run.
// See backend/docs/DATA_SETUP.md, "Akses demo".
//
//	go run ./cmd/demo-users                            # generate passwords, write them to backend/.demo-users.local
//	DEMO_USERS_PASSWORD=... go run ./cmd/demo-users    # one shared password, nothing written
//
// Passwords never go to stdout. Target: DATABASE_URL (shell env, then
// backend/.env.local, then backend/.env). Remote targets are refused
// unless -allow-remote or ALLOW_REMOTE_DB=1.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"

	"nuhabit/backend/internal/demo"
)

// passwordFile is where generated passwords go, under the backend root.
// It is git-ignored.
const passwordFile = ".demo-users.local"

func main() {
	allowRemote := flag.Bool("allow-remote", false, "allow a non-local target")
	flag.Parse()

	root := backendRoot()
	db := open(root, *allowRemote)
	defer db.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	results, err := demo.EnsureUsers(ctx, db, demo.Options{Password: os.Getenv("DEMO_USERS_PASSWORD")})
	if err != nil {
		fail("ERROR: " + err.Error())
	}
	fmt.Println("Akun demo:")
	demo.PrintResults(os.Stdout, results)
	path := filepath.Join(root, passwordFile)
	n, err := demo.WritePasswords(path, results)
	if err != nil {
		fail("ERROR: " + err.Error())
	}
	switch {
	case n > 0:
		fmt.Printf("Password %d akun ditulis ke %s (jangan di-commit).\n", n, path)
	case os.Getenv("DEMO_USERS_PASSWORD") != "":
		fmt.Println("Semua akun memakai password dari DEMO_USERS_PASSWORD.")
	}
}
