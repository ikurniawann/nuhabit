// Package demo adds and removes the seeded demo gym content (class types,
// coaches, packages, schedule templates, the site demo sessions, bookers
// and branches) and creates the demo staff accounts. cmd/demo-data and
// cmd/demo-users wrap it; see backend/docs/DATA_SETUP.md.
package demo

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// The demo rows the migrations and database/seeders/site-demo.sql create.
var (
	ClassTypes = []string{"HYROX Fundamentals", "Engine Builder", "Strength Circuit", "Race Simulation", "Mobility & Recovery",
		"Station", "Engine", "Race Sim", "Personal Training", "Small Group PT"}
	Coaches  = []string{"Kevin Hartono", "Maya Kusuma", "Rizky Ramadhan", "Tara Widjaja"}
	Packages = []string{"Trial Class", "Starter 5", "10 Visit Pack", "20 Visit Pack", "Race Prep Block",
		"Pass 4 Minggu", "Pass 8 Minggu", "Pass 6 Bulan", "Holiday Pass 1 Minggu", "PT 1 Sesi", "PT 10 Sesi"}
	BranchCodes = []string{"DEMO-SENOPATI", "DEMO-CANGGU"}
)

const (
	// bookerPrefix starts the fixed ids of the "Demo Booker" customers.
	bookerPrefix = "de000002-0000-4000-8000-0000000000"
	// siteDemoNote marks the sessions site-demo.sql creates.
	siteDemoNote = "site-demo seeder"
)

// Item is one demo row of a plan.
type Item struct {
	Table string
	ID    string
	Label string
	// Reason says why a kept row stays.
	Reason string
}

// Plan lists what a removal deletes and what it keeps. Tables are in
// deletion order (children first).
type Plan struct {
	Remove []Item
	Keep   []Item
}

// tableOrder is the deletion order: a row is only removed when every row
// referencing it is removed too, so children come first.
var tableOrder = []string{
	"gym.bookings", "gym.class_sessions", "gym.session_templates", "gym.credit_packages",
	"gym.class_types", "gym.coaches", "configuration.branches", "site.articles", "site.events", "pos.pos_customers",
}

// dependents hold rows that only exist for their parent and go with it
// (generated occurrences, branch prices, the default warehouse of a
// branch). They are deleted before the parent and keep it only when a row
// outside the plan references the dependent itself.
var dependents = map[string]bool{"gym.session_template_occurrences": true, "gym.package_branch_prices": true, "configuration.warehouses": true}

func lower(names []string) []string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = strings.ToLower(n)
	}
	return out
}

// candidates lists the demo rows of each table: id and label.
func candidates(ctx context.Context, q database.Querier) (map[string][]Item, error) {
	queries := map[string]struct {
		sql  string
		args []any
	}{
		"pos.pos_customers": {`SELECT id::text, COALESCE(name, phone) FROM pos.pos_customers WHERE id::text LIKE $1 ORDER BY id`, []any{bookerPrefix + "%"}},
		"gym.bookings": {`SELECT b.id::text, COALESCE(c.name, '') || ' @ ' || to_char(s.starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')
			FROM gym.bookings b JOIN pos.pos_customers c ON c.id = b.customer_id JOIN gym.class_sessions s ON s.id = b.session_id
			WHERE b.customer_id::text LIKE $1 ORDER BY s.starts_at, b.id`, []any{bookerPrefix + "%"}},
		"gym.class_types": {`SELECT id::text, name FROM gym.class_types WHERE lower(name) = ANY($1) ORDER BY name`, []any{lower(ClassTypes)}},
		"gym.coaches":     {`SELECT id::text, name FROM gym.coaches WHERE lower(name) = ANY($1) ORDER BY name`, []any{lower(Coaches)}},
		"gym.credit_packages": {`SELECT id::text, name FROM gym.credit_packages WHERE lower(name) = ANY($1) ORDER BY sort_order, name`,
			[]any{lower(Packages)}},
		"gym.class_sessions": {`SELECT s.id::text, t.name || ' ' || to_char(s.starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')
			FROM gym.class_sessions s JOIN gym.class_types t ON t.id = s.class_type_id
			WHERE s.created_by IS NULL AND (s.notes = $1 OR lower(t.name) = ANY($2)) ORDER BY s.starts_at, s.id`, []any{siteDemoNote, lower(ClassTypes)}},
		"gym.session_templates": {`SELECT st.id::text, t.name || ' hari ' || st.weekday::text || ' ' || to_char(st.start_time, 'HH24:MI')
			FROM gym.session_templates st JOIN gym.class_types t ON t.id = st.class_type_id
			WHERE st.created_by IS NULL AND lower(t.name) = ANY($1) ORDER BY st.weekday, st.start_time, st.id`, []any{lower(ClassTypes)}},
		"configuration.branches": {`SELECT id::text, name || ' (' || code || ')' FROM configuration.branches WHERE code = ANY($1) ORDER BY code`, []any{BranchCodes}},
		"site.articles":          {`SELECT id::text, slug FROM site.articles WHERE slug LIKE 'demo-%' ORDER BY slug`, nil},
		"site.events":            {`SELECT id::text, slug FROM site.events WHERE slug LIKE 'demo-%' ORDER BY slug`, nil},
	}
	out := map[string][]Item{}
	for _, table := range tableOrder {
		exists, err := tableExists(ctx, q, table)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		spec := queries[table]
		rows, err := q.Query(ctx, spec.sql, spec.args...)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", table, err)
		}
		items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Item, error) {
			it := Item{Table: table}
			err := r.Scan(&it.ID, &it.Label)
			return it, err
		})
		if err != nil {
			return nil, fmt.Errorf("%s: %w", table, err)
		}
		out[table] = items
	}
	return out, nil
}

func tableExists(ctx context.Context, q database.Querier, table string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists)
	return exists, err
}

// foreignKey is one single-column foreign key pointing at a table.
type foreignKey struct {
	Table, Column string
	HasID         bool // the referencing table has an id column
}

// foreignKeysTo lists the single-column foreign keys that reference table.
func foreignKeysTo(ctx context.Context, q database.Querier, table string) ([]foreignKey, error) {
	rows, err := q.Query(ctx, `SELECT n.nspname || '.' || r.relname, a.attname,
			EXISTS (SELECT 1 FROM pg_attribute i WHERE i.attrelid = r.oid AND i.attname = 'id' AND NOT i.attisdropped)
		FROM pg_constraint c
		JOIN pg_class r ON r.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = r.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
		WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1
		ORDER BY 1, 2`, table)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (foreignKey, error) {
		var fk foreignKey
		err := r.Scan(&fk.Table, &fk.Column, &fk.HasID)
		return fk, err
	})
}

// PlanRemoval decides which demo rows can go. A row stays when a row that
// is not itself being removed still references it (a real booking on a
// demo session, a purchase of a demo package, a session a staff member
// created with a demo class type), and anything that row keeps alive stays
// with it.
func PlanRemoval(ctx context.Context, q database.Querier) (*Plan, error) {
	found, err := candidates(ctx, q)
	if err != nil {
		return nil, err
	}
	plan := &Plan{}
	keep := map[string]map[string]string{} // table -> id -> reason
	// ids are the candidates of table still in the plan; never nil, since
	// pgx sends a nil slice as a NULL array and ANY(NULL) matches nothing.
	ids := func(table string) []string {
		out := []string{}
		for _, it := range found[table] {
			if _, kept := keep[table][it.ID]; !kept {
				out = append(out, it.ID)
			}
		}
		return out
	}
	fks := map[string][]foreignKey{}
	for _, table := range tableOrder {
		if len(found[table]) == 0 {
			continue
		}
		if fks[table], err = foreignKeysTo(ctx, q, table); err != nil {
			return nil, fmt.Errorf("%s: %w", table, err)
		}
	}
	for changed := true; changed; {
		changed = false
		for _, table := range tableOrder {
			live := ids(table)
			if len(live) == 0 {
				continue
			}
			for _, fk := range fks[table] {
				var blockers []blocker
				var err error
				if dependents[fk.Table] {
					blockers, err = dependentBlockers(ctx, q, fk, live)
				} else {
					blockers, err = directBlockers(ctx, q, fk, live, found, ids)
				}
				if err != nil {
					return nil, fmt.Errorf("%s via %s.%s: %w", table, fk.Table, fk.Column, err)
				}
				for _, b := range blockers {
					if keep[table] == nil {
						keep[table] = map[string]string{}
					}
					keep[table][b.id] = b.reason
					changed = true
				}
			}
		}
	}
	for _, table := range tableOrder {
		for _, it := range found[table] {
			if reason, kept := keep[table][it.ID]; kept {
				it.Reason = reason
				plan.Keep = append(plan.Keep, it)
			} else {
				plan.Remove = append(plan.Remove, it)
			}
		}
	}
	return plan, nil
}

// blocker is a candidate row that a reference keeps, with the reason.
type blocker struct {
	id     string
	reason string
}

func collectBlockers(rows pgx.Rows, err error, reason func(n int64) string) ([]blocker, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (blocker, error) {
		var b blocker
		var n int64
		err := r.Scan(&b.id, &n)
		b.reason = reason(n)
		return b, err
	})
}

// directBlockers are the live parents a row of fk.Table references, unless
// that row is a demo row of this plan.
func directBlockers(ctx context.Context, q database.Querier, fk foreignKey, live []string, found map[string][]Item, ids func(string) []string) ([]blocker, error) {
	removable := "false"
	args := []any{live}
	if fk.HasID && len(found[fk.Table]) > 0 {
		removable = "id = ANY($2::uuid[])"
		args = append(args, ids(fk.Table))
	}
	rows, err := q.Query(ctx, fmt.Sprintf(`SELECT %s::text, count(*) FROM %s WHERE %s = ANY($1::uuid[]) AND NOT (%s) GROUP BY 1`,
		fk.Column, fk.Table, fk.Column, removable), args...)
	return collectBlockers(rows, err, func(n int64) string { return fmt.Sprintf("masih dirujuk %s (%d baris)", fk.Table, n) })
}

// dependentBlockers are the live parents whose dependent rows (fk.Table)
// are themselves referenced from outside: the dependent cannot go, so
// neither can the parent.
func dependentBlockers(ctx context.Context, q database.Querier, fk foreignKey, live []string) ([]blocker, error) {
	if !fk.HasID {
		return nil, nil
	}
	refs, err := foreignKeysTo(ctx, q, fk.Table)
	if err != nil {
		return nil, err
	}
	var out []blocker
	for _, ref := range refs {
		if dependents[ref.Table] {
			continue
		}
		rows, err := q.Query(ctx, fmt.Sprintf(`SELECT d.%s::text, count(*) FROM %s d JOIN %s x ON x.%s = d.id WHERE d.%s = ANY($1::uuid[]) GROUP BY 1`,
			fk.Column, fk.Table, ref.Table, ref.Column, fk.Column), live)
		blockers, err := collectBlockers(rows, err, func(n int64) string {
			return fmt.Sprintf("masih dirujuk %s lewat %s (%d baris)", ref.Table, fk.Table, n)
		})
		if err != nil {
			return nil, err
		}
		out = append(out, blockers...)
	}
	return out, nil
}

// Apply deletes the plan's rows on tx, dependents first.
func Apply(ctx context.Context, tx pgx.Tx, plan *Plan) error {
	byTable := map[string][]string{}
	for _, it := range plan.Remove {
		byTable[it.Table] = append(byTable[it.Table], it.ID)
	}
	for _, table := range tableOrder {
		ids := byTable[table]
		if len(ids) == 0 {
			continue
		}
		fks, err := foreignKeysTo(ctx, tx, table)
		if err != nil {
			return err
		}
		for _, fk := range fks {
			if !dependents[fk.Table] {
				continue
			}
			if _, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE %s = ANY($1::uuid[])`, fk.Table, fk.Column), ids); err != nil {
				return fmt.Errorf("%s: %w", fk.Table, err)
			}
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id = ANY($1::uuid[])`, table), ids); err != nil {
			return fmt.Errorf("%s: %w", table, err)
		}
	}
	return nil
}

// Print writes the plan as the command shows it.
func (p *Plan) Print(w io.Writer, dryRun bool) {
	verb := "Dihapus"
	if dryRun {
		verb = "Akan dihapus"
	}
	fmt.Fprintf(w, "%s: %d baris\n", verb, len(p.Remove))
	for _, table := range tableOrder {
		n := 0
		for _, it := range p.Remove {
			if it.Table == table {
				n++
			}
		}
		if n > 0 {
			fmt.Fprintf(w, "  %-28s %d\n", table, n)
		}
	}
	if len(p.Keep) == 0 {
		fmt.Fprintln(w, "Dipertahankan: tidak ada")
		return
	}
	fmt.Fprintf(w, "Dipertahankan: %d baris (sudah dipakai data asli)\n", len(p.Keep))
	keep := append([]Item(nil), p.Keep...)
	sort.SliceStable(keep, func(i, j int) bool { return keep[i].Table < keep[j].Table })
	for _, it := range keep {
		fmt.Fprintf(w, "  %-28s %-48s %s\n", it.Table, it.Label, it.Reason)
	}
}

var errDryRun = errors.New("demo: dry run")

// Remove plans and, unless dryRun, deletes the demo rows in one transaction.
func Remove(ctx context.Context, db database.DB, dryRun bool, out io.Writer) error {
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		plan, err := PlanRemoval(ctx, tx)
		if err != nil {
			return err
		}
		plan.Print(out, dryRun)
		if dryRun {
			return errDryRun
		}
		return Apply(ctx, tx, plan)
	})
	if errors.Is(err, errDryRun) {
		return nil
	}
	return err
}

/* ── Add ─────────────────────────────────────────────────────────────── */

// slot is one weekly demo class.
type slot struct {
	days      []int
	start     string
	classType string
	coach     string
	area      string
}

var slots = []slot{
	{[]int{1, 2, 3, 4, 5, 6}, "06:30", "Engine Builder", "Kevin Hartono", "Main Floor"},
	{[]int{1, 2, 3, 4, 5}, "07:30", "HYROX Fundamentals", "Rizky Ramadhan", "Main Floor"},
	{[]int{1, 3, 5}, "17:30", "Strength Circuit", "Maya Kusuma", "Sled Lane"},
	{[]int{2, 4}, "17:30", "Mobility & Recovery", "Tara Widjaja", "Studio B"},
	{[]int{1, 2, 3, 4, 5}, "18:30", "HYROX Fundamentals", "Rizky Ramadhan", "Main Floor"},
	{[]int{2, 4}, "19:30", "Race Simulation", "Kevin Hartono", "Main Floor"},
	{[]int{1, 3, 5}, "19:45", "Mobility & Recovery", "Tara Widjaja", "Studio B"},
	{[]int{6}, "08:00", "Race Simulation", "Kevin Hartono", "Main Floor"},
	{[]int{6, 7}, "09:30", "Strength Circuit", "Maya Kusuma", "Sled Lane"},
	{[]int{7}, "08:00", "Engine Builder", "Rizky Ramadhan", "Main Floor"},
	{[]int{7}, "10:30", "Mobility & Recovery", "Tara Widjaja", "Studio B"},
}

// Add loads the demo set: the class types, coaches, packages and weekly
// templates the migrations seed (for the oldest active branch), then
// database/seeders/site-demo.sql (demo branches, two weeks of sessions,
// bookers and site content). Every step is idempotent. seedersDir holds
// site-demo.sql.
func Add(ctx context.Context, db database.DB, seedersDir string, out io.Writer) error {
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color, is_personal)
			SELECT v.name, v.description, v.duration, v.cost, v.capacity, v.color, v.personal
			FROM (VALUES
			  ('HYROX Fundamentals', 'Kenali delapan station HYROX dan cara mengatur pace di tiap station.', 60, 1, 16, 'lime', false),
			  ('Engine Builder', 'Conditioning berat lari untuk membangun race pace.', 60, 1, 20, 'info', false),
			  ('Strength Circuit', 'Sled push, sled pull, carry, dan lunge untuk kekuatan race.', 75, 1, 14, 'warning', false),
			  ('Race Simulation', 'Simulasi penuh delapan station melawan waktu.', 90, 2, 12, 'danger', false),
			  ('Mobility & Recovery', 'Pemulihan pasca-latihan, range of motion, dan pencegahan cedera.', 45, 1, 18, 'success', false),
			  ('Personal Training', 'Sesi 1:1 bersama coach, program disusun untuk target race kamu.', 60, 1, 1, 'ink', true),
			  ('Small Group PT', 'Sesi PT dua sampai empat orang dengan satu coach.', 60, 1, 4, 'info', true)
			) AS v(name, description, duration, cost, capacity, color, personal)
			WHERE NOT EXISTS (SELECT 1 FROM gym.class_types t WHERE lower(t.name) = lower(v.name))`); err != nil {
			return fmt.Errorf("class types: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO gym.coaches (name, bio, specialization)
			SELECT v.name, v.bio, v.specialization
			FROM (VALUES
			  ('Kevin Hartono', 'Spesialis engine dan race simulation. Menyusun sesi interval untuk pace HYROX.', 'Engine & simulation'),
			  ('Maya Kusuma', 'Coach kekuatan dengan latar belakang kompetisi functional fitness.', 'Strength & conditioning'),
			  ('Rizky Ramadhan', 'Pacing race day dan teknik station, dari wall ball sampai sandbag lunge.', 'HYROX race coach'),
			  ('Tara Widjaja', 'Mobilitas, pemulihan, dan pencegahan cedera untuk atlet HYROX.', 'Mobility & recovery')
			) AS v(name, bio, specialization)
			WHERE NOT EXISTS (SELECT 1 FROM gym.coaches c WHERE lower(c.name) = lower(v.name))`); err != nil {
			return fmt.Errorf("coaches: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO gym.credit_packages (name, description, kind, credits, price_idr, validity_days, purchase_limit_per_member, badge, applicable_class_type_ids, sort_order)
			SELECT v.name, v.description, v.kind, v.credits, v.price_idr, v.validity_days, v.limit_per, v.badge,
			       CASE WHEN v.pt THEN (SELECT array_agg(t.id ORDER BY t.name) FROM gym.class_types t WHERE t.is_personal) END, v.sort_order
			FROM (VALUES
			  ('Trial Class', 'Satu kelas percobaan untuk member baru.', 'credits', 1, 200000::numeric, 14, 1, NULL::text, false, 10),
			  ('Starter 5', 'Lima kredit untuk mulai rutin latihan.', 'credits', 5, 800000::numeric, 60, NULL::int, NULL, false, 20),
			  ('10 Visit Pack', 'Sepuluh kredit, berlaku 90 hari.', 'credits', 10, 1500000::numeric, 90, NULL, NULL, false, 30),
			  ('20 Visit Pack', 'Dua puluh kredit, harga per kelas paling hemat.', 'credits', 20, 2700000::numeric, 120, NULL, NULL, false, 40),
			  ('Race Prep Block', 'Delapan kredit untuk blok persiapan race HYROX.', 'credits', 8, 1400000::numeric, 60, NULL, NULL, false, 50),
			  ('PT 1 Sesi', 'Satu sesi personal training.', 'credits', 1, 450000::numeric, 30, NULL, NULL, true, 60),
			  ('PT 10 Sesi', 'Sepuluh sesi personal training, berlaku 120 hari.', 'credits', 10, 4000000::numeric, 120, NULL, NULL, true, 61),
			  ('Pass 4 Minggu', 'Booking kelas tanpa batas selama 4 minggu.', 'pass', 0, 1200000::numeric, 28, NULL, NULL, false, 110),
			  ('Pass 8 Minggu', 'Booking kelas tanpa batas selama 8 minggu.', 'pass', 0, 2200000::numeric, 56, NULL, 'Paling laris', false, 120),
			  ('Pass 6 Bulan', 'Booking kelas tanpa batas selama 6 bulan.', 'pass', 0, 5400000::numeric, 182, NULL, NULL, false, 130),
			  ('Holiday Pass 1 Minggu', 'Latihan tanpa batas selama seminggu, cocok saat berkunjung.', 'pass', 0, 400000::numeric, 7, NULL, NULL, false, 140)
			) AS v(name, description, kind, credits, price_idr, validity_days, limit_per, badge, pt, sort_order)
			WHERE NOT EXISTS (SELECT 1 FROM gym.credit_packages p WHERE lower(p.name) = lower(v.name))`); err != nil {
			return fmt.Errorf("packages: %w", err)
		}
		for _, sl := range slots {
			if _, err := tx.Exec(ctx, `INSERT INTO gym.session_templates (class_type_id, coach_id, branch_id, area, weekday, start_time, duration_min, capacity, credit_cost, valid_from)
				SELECT t.id, c.id, b.id, $4, dow, $3::time, t.default_duration_min, t.default_capacity, t.default_credit_cost, CURRENT_DATE
				FROM gym.class_types t
				JOIN gym.coaches c ON lower(c.name) = lower($2)
				CROSS JOIN (SELECT id FROM configuration.branches WHERE is_active ORDER BY created_at LIMIT 1) b
				CROSS JOIN unnest($5::int[]) AS dow
				WHERE lower(t.name) = lower($1)
				  AND NOT EXISTS (SELECT 1 FROM gym.session_templates x
				    WHERE x.class_type_id = t.id AND x.branch_id = b.id AND x.weekday = dow AND x.start_time = $3::time)`,
				sl.classType, sl.coach, sl.start, sl.area, sl.days); err != nil {
				return fmt.Errorf("templates: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	sql, err := os.ReadFile(filepath.Join(seedersDir, "site-demo.sql"))
	if err != nil {
		return err
	}
	// The file runs its own BEGIN/COMMIT; without arguments pgx sends it
	// as one simple-protocol batch.
	if _, err := db.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("site-demo.sql: %w", err)
	}
	plan, err := PlanRemoval(ctx, db)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Demo siap: %d baris demo di database.\n", len(plan.Remove)+len(plan.Keep))
	fmt.Fprintln(out, "Jalankan Generate sekarang di Gym > Template Jadwal untuk sesi dari template.")
	return nil
}
