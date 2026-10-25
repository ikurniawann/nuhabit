// Command demo-data adds or removes the seeded demo gym content. See
// backend/docs/DATA_SETUP.md.
//
//	go run ./cmd/demo-data -remove -dry-run   # list what would go and what stays, write nothing
//	go run ./cmd/demo-data -remove            # delete the untouched demo rows
//	go run ./cmd/demo-data -add               # load the demo set into a fresh database
//
// Target: DATABASE_URL (shell env, then backend/.env.local, then
// backend/.env). Remote targets are refused unless -allow-remote or
// ALLOW_REMOTE_DB=1.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	_ "time/tzdata" // zone names resolve without the OS zoneinfo, as in cmd/api

	"nuhabit/backend/internal/demo"
)

func main() {
	remove := flag.Bool("remove", false, "remove the demo rows that no real booking or purchase touched")
	add := flag.Bool("add", false, "load the demo set (class types, coaches, packages, templates, site demo)")
	dryRun := flag.Bool("dry-run", false, "with -remove: list what would be removed and what stays, write nothing")
	allowRemote := flag.Bool("allow-remote", false, "allow a non-local target")
	flag.Parse()
	if *remove == *add {
		fail("Pilih salah satu: -remove atau -add")
	}

	root := backendRoot()
	db := open(root, *allowRemote)
	defer db.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	var err error
	if *add {
		err = demo.Add(ctx, db, filepath.Join(root, "database", "seeders"), os.Stdout)
	} else {
		if *dryRun {
			fmt.Println("Dry run: tidak ada yang ditulis.")
		}
		err = demo.Remove(ctx, db, *dryRun, os.Stdout)
	}
	if err != nil {
		fail("ERROR: " + err.Error())
	}
}
