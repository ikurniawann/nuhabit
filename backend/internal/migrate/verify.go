package migrate

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// VerifyOptions configure Verify.
type VerifyOptions struct {
	URL string // the database to check
	// ShadowURL is an empty database Verify may fill. When empty, Verify
	// creates a scratch database on the target's server and drops it after.
	ShadowURL string
	Dir       string
	Out       io.Writer
}

// ErrDrift is returned when the target lacks objects the migrations create
// or holds a different definition of them.
var ErrDrift = errors.New("schema drift")

// Verify replays every migration into a shadow database and compares its
// catalog with the target's. It catches migrations recorded in
// schema_migrations whose effects are missing (a restored dump, a file edited
// after it ran, a manual hotfix) before code that depends on them ships.
// Objects only the target has are listed but do not fail the check.
func Verify(ctx context.Context, opts VerifyOptions) error {
	shadow := opts.ShadowURL
	if shadow == "" {
		created, drop, err := createScratch(ctx, opts.URL)
		if err != nil {
			return fmt.Errorf("shadow database: %w (pass -shadow with an empty database)", err)
		}
		defer drop()
		shadow = created
	}
	if err := Run(ctx, Options{URL: shadow, Dir: opts.Dir, Apply: true, Out: io.Discard, Err: opts.Out}); err != nil {
		return fmt.Errorf("replay into shadow: %w", err)
	}
	want, err := snapshot(ctx, shadow)
	if err != nil {
		return fmt.Errorf("read shadow catalog: %w", err)
	}
	have, err := snapshot(ctx, opts.URL)
	if err != nil {
		return fmt.Errorf("read target catalog: %w", err)
	}
	if !report(opts.Out, diff(want, have)) {
		return ErrDrift
	}
	return nil
}

// createScratch makes an empty database next to the target and returns its
// URL and a function that drops it.
func createScratch(ctx context.Context, target string) (string, func(), error) {
	u, err := url.Parse(target)
	if err != nil || u.Host == "" {
		return "", nil, errors.New("target is not a postgres:// URL")
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	name := "nuhabit_verify_" + hex.EncodeToString(b[:])
	conn, err := pgx.Connect(ctx, target)
	if err != nil {
		return "", nil, err
	}
	defer conn.Close(context.Background())
	// template0 keeps whatever was added to template1 out of the comparison.
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE template0"); err != nil {
		return "", nil, err
	}
	shadow := *u
	shadow.Path = "/" + name
	drop := func() {
		c, err := pgx.Connect(context.Background(), target)
		if err != nil {
			return
		}
		defer c.Close(context.Background())
		_, _ = c.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name)
	}
	return shadow.String(), drop, nil
}

// catalogQuery lists every user object as (kind, key, detail). Names are cast
// to text: name || name stays a name and truncates the key to 63 bytes. The detail is
// the definition that must match: column type and nullability, constraint
// and index definitions, enum labels, and hashes of function, trigger and
// view bodies (snapshot normalizes the deparsed ones). Objects owned by extensions are left out.
const catalogQuery = `
WITH ns AS (
  SELECT oid, nspname::text AS nspname FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND nspname NOT LIKE 'pg\_temp\_%' AND nspname NOT LIKE 'pg\_toast\_temp\_%'
),
ext AS (SELECT classid, objid FROM pg_depend WHERE deptype = 'e'),
rel AS (
  SELECT c.oid, c.relname::text AS relname, c.relkind, ns.nspname FROM pg_class c JOIN ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
)
SELECT 'schema', nspname, '' FROM ns
UNION ALL
SELECT 'extension', extname::text, '' FROM pg_extension
UNION ALL
SELECT 'relation', nspname || '.' || relname, relkind::text FROM rel
UNION ALL
SELECT 'column', rel.nspname || '.' || rel.relname || '.' || a.attname::text,
       format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
FROM pg_attribute a JOIN rel ON rel.oid = a.attrelid
WHERE rel.relkind <> 'S' AND a.attnum > 0 AND NOT a.attisdropped
UNION ALL
SELECT 'constraint', rel.nspname || '.' || rel.relname || '.' || con.conname::text, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN rel ON rel.oid = con.conrelid
UNION ALL
SELECT 'index', ns.nspname || '.' || i.relname::text, pg_get_indexdef(i.oid)
FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN ns ON ns.oid = i.relnamespace
WHERE x.indrelid IN (SELECT oid FROM rel)
UNION ALL
SELECT 'view', nspname || '.' || relname, pg_get_viewdef(oid) FROM rel WHERE relkind IN ('v', 'm')
UNION ALL
SELECT 'trigger', rel.nspname || '.' || rel.relname || '.' || t.tgname::text, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN rel ON rel.oid = t.tgrelid WHERE NOT t.tgisinternal
UNION ALL
SELECT 'function', ns.nspname || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
UNION ALL
SELECT 'enum', ns.nspname || '.' || t.typname::text, string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder)
FROM pg_type t JOIN ns ON ns.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
GROUP BY ns.nspname, t.typname`

type object struct{ kind, key string }

// snapshot reads the catalog with the migrations' search_path, so view and
// constraint definitions qualify names the same way in both databases.
func snapshot(ctx context.Context, dsn string) (map[object]string, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "SET search_path TO "+strings.Join(SearchPath, ", ")); err != nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, catalogQuery)
	if err != nil {
		return nil, err
	}
	out := map[object]string{}
	var kind, key, detail string
	_, err = pgx.ForEachRow(rows, []any{&kind, &key, &detail}, func() error {
		switch kind {
		case "constraint", "index":
			detail = canonical(detail)
		case "view", "trigger":
			sum := md5.Sum([]byte(canonical(detail)))
			detail = hex.EncodeToString(sum[:])
		}
		out[object{kind, key}] = detail
		return nil
	})
	return out, err
}

var (
	casts  = regexp.MustCompile(`::[a-z_][a-z0-9_.]*(?: varying| precision| with(?:out)? time zone)?(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])?`)
	layout = regexp.MustCompile(`[\s()]+`)
)

// canonical drops casts, parentheses and whitespace from a deparsed
// definition. A dump and restore (or a baseline file written from
// pg_get_constraintdef) re-parses the text, and Postgres then prints
// x IN ('a') as = ANY ((ARRAY['a'::varchar])::text[]) on one side and
// = ANY (ARRAY[('a'::varchar)::text]) on the other. Values, columns and
// operators still have to match.
func canonical(def string) string {
	return layout.ReplaceAllString(casts.ReplaceAllString(def, ""), "")
}

type drift struct {
	missing, differs, extra []object
	want, have              map[object]string
}

func diff(want, have map[object]string) drift {
	d := drift{want: want, have: have}
	for o, def := range want {
		got, ok := have[o]
		switch {
		case !ok:
			d.missing = append(d.missing, o)
		case got != def:
			d.differs = append(d.differs, o)
		}
	}
	for o := range have {
		if _, ok := want[o]; !ok {
			d.extra = append(d.extra, o)
		}
	}
	for _, list := range [][]object{d.missing, d.differs, d.extra} {
		sort.Slice(list, func(i, j int) bool {
			if list[i].kind != list[j].kind {
				return list[i].kind < list[j].kind
			}
			return list[i].key < list[j].key
		})
	}
	return d
}

// report prints the drift and says whether the target passes.
func report(w io.Writer, d drift) bool {
	for _, o := range d.missing {
		fmt.Fprintf(w, "  [missing] %s %s\n", o.kind, o.key)
	}
	for _, o := range d.differs {
		fmt.Fprintf(w, "  [differs] %s %s\n            migrations: %s\n            database:   %s\n",
			o.kind, o.key, d.want[o], d.have[o])
	}
	for _, o := range d.extra {
		fmt.Fprintf(w, "  [extra]   %s %s\n", o.kind, o.key)
	}
	fmt.Fprintf(w, "\n%d object dari migrasi; %d hilang, %d berbeda, %d hanya ada di database.\n",
		len(d.want), len(d.missing), len(d.differs), len(d.extra))
	return len(d.missing) == 0 && len(d.differs) == 0
}
