// Package migrate is the Go port of backend/database/scripts/apply-migrations.js:
// the same file discovery and order, the same schema_migrations(filename,
// applied_at, checksum) bookkeeping, one transaction per file, dry run by
// default and a local-target guard.
package migrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// SearchPath is searchPathSchemas() from backend/database/schema-map.js.
// Bare table names in FKs, triggers and functions resolve through it.
var SearchPath = []string{
	"public", "iam", "configuration", "hris", "performance", "recruitment", "item", "purchasing",
	"inventory", "manufacturing", "pos", "ticketing", "promo", "crm", "accounting", "dataroom", "auth",
}

// File is one migration on disk.
type File struct {
	Name string // basename, the schema_migrations key
	Path string
}

var leadingDigits = regexp.MustCompile(`^(\d+)`)

func orderPrefix(name string) string {
	if m := leadingDigits.FindString(name); m != "" {
		return m
	}
	return name
}

// ListFiles walks dir recursively for *.sql, rejects duplicate basenames and
// sorts by the leading digit prefix of the basename (string order), then
// by the basename. Folder layout never changes the order.
func ListFiles(dir string) ([]File, error) {
	if _, err := os.Stat(dir); err != nil {
		return nil, nil
	}
	var files []File
	seen := map[string]bool{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".sql") {
			return nil
		}
		if seen[d.Name()] {
			return fmt.Errorf("Duplikat nama file migrasi: %s (basename harus unik)", d.Name())
		}
		seen[d.Name()] = true
		files = append(files, File{Name: d.Name(), Path: p})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(files, func(i, j int) bool {
		pi, pj := orderPrefix(files[i].Name), orderPrefix(files[j].Name)
		if pi != pj {
			return pi < pj
		}
		return files[i].Name < files[j].Name
	})
	return files, nil
}

// IsLocalURL mirrors isLocalDatabaseUrl in pg-utils.js.
func IsLocalURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1"
}

var passwordInURL = regexp.MustCompile(`:[^:@/]+@`)

// MaskURL hides the password the way the JS warning does.
func MaskURL(raw string) string { return passwordInURL.ReplaceAllString(raw, ":****@") }

// Checksum is the sha256 hex of the file contents.
func Checksum(sql []byte) string {
	sum := sha256.Sum256(sql)
	return hex.EncodeToString(sum[:])
}

// Options configure Run.
type Options struct {
	URL   string
	Dir   string
	Apply bool
	Out   io.Writer // progress
	Err   io.Writer // failures
}

// Run applies (or, without Apply, lists) pending migrations. It returns an
// error after printing the failing file, as the JS script exits 1.
func Run(ctx context.Context, opts Options) error {
	files, err := ListFiles(opts.Dir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("Tidak ada file migrasi di %s", opts.Dir)
	}

	cfg, err := pgx.ParseConfig(opts.URL)
	if err != nil {
		return err
	}
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, "SET search_path TO "+strings.Join(SearchPath, ", ")); err != nil {
		return err
	}

	// Dry run is read-only: never create the bookkeeping table.
	var reg *string
	if err := conn.QueryRow(ctx, "SELECT to_regclass('public.schema_migrations')::text AS t").Scan(&reg); err != nil {
		return err
	}
	tableExists := reg != nil
	if opts.Apply && !tableExists {
		if _, err := conn.Exec(ctx, `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum   TEXT
      );
    `); err != nil {
			return err
		}
	}
	applied := map[string]bool{}
	if tableExists || opts.Apply {
		rows, err := conn.Query(ctx, "SELECT filename FROM schema_migrations ORDER BY filename")
		if err != nil {
			return err
		}
		names, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, n := range names {
			applied[n] = true
		}
	}

	var pending []File
	for _, f := range files {
		if !applied[f.Name] {
			pending = append(pending, f)
		}
	}
	if len(pending) == 0 {
		fmt.Fprintln(opts.Out, "Semua migrasi sudah diterapkan.")
		return nil
	}

	if !opts.Apply {
		fmt.Fprintf(opts.Out, "Dry-run: %d migrasi pending dari %d file.\n", len(pending), len(files))
		for _, f := range pending {
			info, err := os.Stat(f.Path)
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(opts.Dir, f.Path)
			fmt.Fprintf(opts.Out, "  [pending] %s (%.1f KB)\n", rel, float64(info.Size())/1024)
		}
		fmt.Fprintln(opts.Out, "\nJalankan dengan -apply untuk eksekusi.")
		return nil
	}

	done := 0
	for _, f := range pending {
		sql, err := os.ReadFile(f.Path)
		if err != nil {
			return err
		}
		if err := applyOne(ctx, conn, f.Name, sql); err != nil {
			_, _ = conn.Exec(context.Background(), "ROLLBACK")
			fmt.Fprintf(opts.Err, "  [FAIL]  %s\n          %s\n", f.Name, errorMessage(err))
			return fmt.Errorf("migrasi %s gagal", f.Name)
		}
		fmt.Fprintf(opts.Out, "  [ok]    %s\n", f.Name)
		done++
	}
	fmt.Fprintf(opts.Out, "\nSelesai. %d migrasi diterapkan.\n", done)
	return nil
}

// errorMessage is what node-postgres puts in err.message: the server text
// without pgx's "ERROR: ... (SQLSTATE ...)" decoration.
func errorMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}

// applyOne mirrors the JS client: BEGIN, the whole file as one simple-query
// (multi-statement) call, the bookkeeping row, COMMIT.
func applyOne(ctx context.Context, conn *pgx.Conn, name string, sql []byte) error {
	if _, err := conn.Exec(ctx, "BEGIN"); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, string(sql)); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", name, Checksum(sql)); err != nil {
		return err
	}
	_, err := conn.Exec(ctx, "COMMIT")
	return err
}
