package gymcare

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// FlagType is one kind of member flag.
type FlagType struct {
	ID                string          `json:"id" db:"id"`
	Code              string          `json:"code" db:"code"`
	Label             string          `json:"label" db:"label"`
	Category          domain.Category `json:"category" db:"category"`
	Color             string          `json:"color" db:"color"`
	Icon              string          `json:"icon" db:"icon"`
	DefaultExpiryDays *int            `json:"default_expiry_days" db:"default_expiry_days"`
	SortOrder         int             `json:"sort_order" db:"sort_order"`
	IsSystem          bool            `json:"is_system" db:"is_system"`
	IsActive          bool            `json:"is_active" db:"is_active"`
}

const typeColumns = `id::text, code, label, category, color, icon, default_expiry_days, sort_order, is_system, is_active`

// Flag is one active flag with its type.
type Flag struct {
	ID             string          `json:"id" db:"id"`
	CustomerID     string          `json:"customer_id" db:"customer_id"`
	CustomerName   *string         `json:"customer_name" db:"customer_name"`
	TypeID         string          `json:"type_id" db:"type_id"`
	TypeCode       string          `json:"type_code" db:"type_code"`
	TypeLabel      string          `json:"type_label" db:"type_label"`
	Category       domain.Category `json:"category" db:"category"`
	Color          string          `json:"color" db:"color"`
	Icon           string          `json:"icon" db:"icon"`
	Note           string          `json:"note" db:"note"`
	ExpiresOn      *string         `json:"expires_on" db:"expires_on"`
	Source         string          `json:"source" db:"source"`
	ReviewStatus   *string         `json:"review_status" db:"review_status"`
	ReviewNote     string          `json:"review_note" db:"review_note"`
	ReviewedAt     *time.Time      `json:"reviewed_at" db:"reviewed_at"`
	ReviewedByName string          `json:"reviewed_by_name" db:"reviewed_by_name"`
	CreatedByName  string          `json:"created_by_name" db:"created_by_name"`
	CreatedAt      time.Time       `json:"created_at" db:"created_at"`
}

const flagSelect = `SELECT f.id::text, f.customer_id::text, c.name AS customer_name, t.id::text AS type_id,
       t.code AS type_code, t.label AS type_label, t.category, t.color, t.icon, f.note,
       to_char(f.expires_on, 'YYYY-MM-DD') AS expires_on, f.source, f.review_status, f.review_note,
       f.reviewed_at, f.reviewed_by_name, f.created_by_name, f.created_at
  FROM gym.member_flags f
  JOIN gym.member_flag_types t ON t.id = f.type_id
  JOIN pos.pos_customers c ON c.id = f.customer_id`

// activeFlag is the condition on f for a flag that shows on the day in the
// today parameter.
func activeFlag(today string) string {
	return `f.removed_at IS NULL AND (f.expires_on IS NULL OR f.expires_on >= ` + today + `::date)`
}

// visibleFlag is the condition on f and t for a flag the viewer may read:
// general flags, or medical ones for a manager or a current coach.
func visibleFlag(manager, viewer, now string) string {
	return `(t.category = 'general' OR ` + manager + `::boolean OR ` + assignedSQL("f.customer_id", viewer, now) + `)`
}

// orderFlags shows medical flags first, then by type order and age.
const orderFlags = ` ORDER BY (t.category = 'medical') DESC, t.sort_order, f.created_at DESC, f.id`

/* ── Types ───────────────────────────────────────────────────────────────── */

// Types lists flag types in display order; only active ones unless all.
func (s *Service) Types(ctx context.Context, all bool) ([]FlagType, error) {
	rows, err := s.db.Query(ctx, `SELECT `+typeColumns+` FROM gym.member_flag_types
	  WHERE $1 OR is_active ORDER BY sort_order, label`, all)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[FlagType])
}

func (s *Service) loadType(ctx context.Context, q database.Querier, id string) (*FlagType, error) {
	rows, err := q.Query(ctx, `SELECT `+typeColumns+` FROM gym.member_flag_types WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	t, err := pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[FlagType])
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Jenis penanda tidak ditemukan")
	}
	return t, err
}

// CreateType adds a flag type; its code comes from the label, with a
// number when taken.
func (s *Service) CreateType(ctx context.Context, in domain.TypeInput) (*FlagType, error) {
	if msg := domain.ValidateType(in, true); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	label := strings.TrimSpace(*in.Label)
	color, icon, sortOrder := "info", "flag", 100
	if in.Color != nil {
		color = *in.Color
	}
	if in.Icon != nil {
		icon = *in.Icon
	}
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	var expiry *int
	if in.DefaultExpiryDays != nil {
		expiry = *in.DefaultExpiryDays
	}
	base := domain.TypeCode(label)
	var id string
	for i := 1; i <= 20; i++ {
		code := base
		if i > 1 {
			code = base + "_" + strconv.Itoa(i)
		}
		err := s.db.QueryRow(ctx, `INSERT INTO gym.member_flag_types (code, label, category, color, icon, default_expiry_days, sort_order)
		  VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING RETURNING id::text`,
			code, label, string(*in.Category), color, icon, expiry, sortOrder).Scan(&id)
		if database.IsNoRows(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return s.loadType(ctx, s.db, id)
	}
	return nil, httpx.Conflict("Sudah terlalu banyak jenis penanda dengan nama serupa")
}

// UpdateType edits a flag type. System types keep their category and stay
// active.
func (s *Service) UpdateType(ctx context.Context, id string, in domain.TypeInput) error {
	if msg := domain.ValidateType(in, false); msg != "" {
		return httpx.BadRequest(msg)
	}
	current, err := s.loadType(ctx, s.db, id)
	if err != nil {
		return err
	}
	if current.IsSystem && ((in.Category != nil && *in.Category != current.Category) || (in.Active != nil && !*in.Active)) {
		return httpx.BadRequest("Jenis penanda sistem tidak bisa dinonaktifkan atau diubah kategorinya")
	}
	var label *string
	if in.Label != nil {
		l := strings.TrimSpace(*in.Label)
		label = &l
	}
	expirySet := in.DefaultExpiryDays != nil
	var expiry *int
	if expirySet {
		expiry = *in.DefaultExpiryDays
	}
	_, err = s.db.Exec(ctx, `UPDATE gym.member_flag_types SET
	    label = COALESCE($2, label), category = COALESCE($3, category), color = COALESCE($4, color),
	    icon = COALESCE($5, icon), default_expiry_days = CASE WHEN $6 THEN $7 ELSE default_expiry_days END,
	    sort_order = COALESCE($8, sort_order), is_active = COALESCE($9, is_active), updated_at = now()
	  WHERE id = $1`, id, label, categoryText(in.Category), in.Color, in.Icon, expirySet, expiry, in.SortOrder, in.Active)
	return err
}

// categoryText is c as a nullable text parameter.
func categoryText(c *domain.Category) *string {
	if c == nil {
		return nil
	}
	s := string(*c)
	return &s
}

/* ── Reading flags ───────────────────────────────────────────────────────── */

// MemberFlags is what a roster shows for one member: the flags the viewer
// may read and how many medical flags it may not.
type MemberFlags struct {
	CustomerID    string `json:"customer_id"`
	Flags         []Flag `json:"flags"`
	HiddenMedical int    `json:"hidden_medical"`
}

// ForMembers returns the active flags of each member in ids (in that
// order) as v may read them.
func (s *Service) ForMembers(ctx context.Context, v Viewer, ids []string) ([]MemberFlags, error) {
	out := make([]MemberFlags, len(ids))
	at := map[string]int{}
	for i, id := range ids {
		out[i] = MemberFlags{CustomerID: id, Flags: []Flag{}}
		at[id] = i
	}
	if len(ids) == 0 {
		return out, nil
	}
	now := s.now()
	rows, err := s.db.Query(ctx, flagSelect+`
	  WHERE f.customer_id = ANY($1::uuid[]) AND `+activeFlag("$2")+` AND `+visibleFlag("$3", "$4", "$5")+orderFlags,
		ids, today(now), v.Manager, v.ID, now)
	if err != nil {
		return nil, err
	}
	flags, err := pgx.CollectRows(rows, pgx.RowToStructByName[Flag])
	if err != nil {
		return nil, err
	}
	for _, f := range flags {
		i := at[f.CustomerID]
		out[i].Flags = append(out[i].Flags, f)
	}
	// Medical flags the viewer may not read are only counted.
	rows, err = s.db.Query(ctx, `SELECT f.customer_id::text, count(*)::int
	    FROM gym.member_flags f JOIN gym.member_flag_types t ON t.id = f.type_id
	   WHERE f.customer_id = ANY($1::uuid[]) AND `+activeFlag("$2")+` AND NOT `+visibleFlag("$3", "$4", "$5")+`
	   GROUP BY f.customer_id`, ids, today(now), v.Manager, v.ID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[at[id]].HiddenMedical = n
	}
	return out, rows.Err()
}

// FlagFilter narrows the dashboard list.
type FlagFilter struct {
	Q        string
	Category *domain.Category
	TypeID   *string
	Page     int
	PageSize int
}

// FlagPage is one page of active flags.
type FlagPage struct {
	Rows     []Flag `json:"rows"`
	Total    int    `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	// HiddenMedical counts the active medical flags the viewer may not read.
	HiddenMedical int `json:"hidden_medical"`
}

// List pages the active flags v may read, newest first.
func (s *Service) List(ctx context.Context, v Viewer, f FlagFilter) (*FlagPage, error) {
	now := s.now()
	where := ` WHERE ` + activeFlag("$1") + ` AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.phone ILIKE '%' || $2 || '%')
	   AND ($3::text IS NULL OR t.category = $3) AND ($4::uuid IS NULL OR t.id = $4)`
	args := []any{today(now), f.Q, categoryText(f.Category), f.TypeID, v.Manager, v.ID, now}
	visible := visibleFlag("$5", "$6", "$7")
	out := &FlagPage{Rows: []Flag{}, Page: f.Page, PageSize: f.PageSize}
	countSQL := `SELECT count(*) FILTER (WHERE ` + visible + `)::int, count(*) FILTER (WHERE NOT ` + visible + `)::int
	  FROM gym.member_flags f JOIN gym.member_flag_types t ON t.id = f.type_id JOIN pos.pos_customers c ON c.id = f.customer_id` + where
	if err := s.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total, &out.HiddenMedical); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, flagSelect+where+` AND `+visible+` ORDER BY f.created_at DESC, f.id LIMIT $8 OFFSET $9`,
		append(args, f.PageSize, (f.Page-1)*f.PageSize)...)
	if err != nil {
		return nil, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Flag])
	return out, err
}

/* ── Writing flags ───────────────────────────────────────────────────────── */

// NewFlag is a flag to add. ExpiresSet with a nil ExpiresOn adds a flag
// that does not expire; without ExpiresSet the type's default applies.
type NewFlag struct {
	CustomerID string
	TypeID     string
	Note       string
	ExpiresSet bool
	ExpiresOn  *time.Time
}

// flagMeta is what the write rules need of a flag.
type flagMeta struct {
	customerID string
	category   domain.Category
}

// lockFlag reads an open flag for update; 404 when removed or missing.
func lockFlag(ctx context.Context, q database.Querier, id string) (*flagMeta, error) {
	var m flagMeta
	err := q.QueryRow(ctx, `SELECT f.customer_id::text, t.category
	    FROM gym.member_flags f JOIN gym.member_flag_types t ON t.id = f.type_id
	   WHERE f.id = $1 AND f.removed_at IS NULL FOR UPDATE OF f`, id).Scan(&m.customerID, &m.category)
	if database.IsNoRows(err) {
		return nil, notFoundFlag
	}
	return &m, err
}

var notFoundFlag = httpx.NotFound("Penanda tidak ditemukan")

// mayWrite checks that v may add, edit or remove a flag of category on the
// member: medical needs a manager or a current coach (others get 404 for an
// existing flag so its existence does not leak); general needs a desk grant
// or a coach profile.
func (s *Service) mayWrite(ctx context.Context, q database.Querier, v Viewer, category domain.Category, customerID string, existing bool) error {
	if category == domain.Medical {
		ok, err := s.seesMedical(ctx, q, v, customerID)
		if err != nil || ok {
			return err
		}
		if existing {
			return notFoundFlag
		}
		return httpx.Forbidden("Penanda medis hanya bisa dicatat coach yang memegang sesi member ini atau manajer gym")
	}
	if v.Staff {
		return nil
	}
	_, err := requireCoach(ctx, q, v.ID)
	return err
}

// Add stores a flag by v.
func (s *Service) Add(ctx context.Context, v Viewer, in NewFlag) (*Flag, error) {
	if !domain.ValidNote(in.Note, domain.NoteMax) {
		return nil, httpx.BadRequest("Catatan penanda maksimal 300 karakter")
	}
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		t, err := s.loadType(ctx, tx, in.TypeID)
		if err != nil {
			return err
		}
		if !t.IsActive || t.IsSystem {
			return httpx.BadRequest("Jenis penanda ini tidak bisa dipakai")
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1)`, in.CustomerID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.NotFound("Member tidak ditemukan")
		}
		if err := s.mayWrite(ctx, tx, v, t.Category, in.CustomerID, false); err != nil {
			return err
		}
		day, _ := time.Parse(time.DateOnly, today(s.now()))
		expires := in.ExpiresOn
		if !in.ExpiresSet {
			expires = domain.DefaultExpiry(day, t.DefaultExpiryDays)
		} else if expires != nil && !domain.ValidExpiry(*expires, day) {
			return httpx.BadRequest("Tanggal berakhir mulai hari ini, paling lama 10 tahun lagi")
		}
		source := domain.SourceStaff
		if !v.Staff {
			source = domain.SourceCoach
		}
		return tx.QueryRow(ctx, `INSERT INTO gym.member_flags (customer_id, type_id, note, expires_on, source, created_by, created_by_name)
		  VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
			in.CustomerID, t.ID, in.Note, expires, source, v.ID, v.Name).Scan(&id)
	})
	if err != nil {
		return nil, err
	}
	return s.one(ctx, id)
}

func (s *Service) one(ctx context.Context, id string) (*Flag, error) {
	rows, err := s.db.Query(ctx, flagSelect+` WHERE f.id = $1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToAddrOfStructByName[Flag])
}

// FlagPatch edits a flag: nil Note keeps it; ExpiresSet replaces the
// expiry (nil = none).
type FlagPatch struct {
	Note       *string
	ExpiresSet bool
	ExpiresOn  *time.Time
}

// Edit changes a flag's note or expiry.
func (s *Service) Edit(ctx context.Context, v Viewer, id string, p FlagPatch) error {
	if p.Note != nil && !domain.ValidNote(*p.Note, domain.NoteMax) {
		return httpx.BadRequest("Catatan penanda maksimal 300 karakter")
	}
	day, _ := time.Parse(time.DateOnly, today(s.now()))
	if p.ExpiresSet && p.ExpiresOn != nil && !domain.ValidExpiry(*p.ExpiresOn, day) {
		return httpx.BadRequest("Tanggal berakhir mulai hari ini, paling lama 10 tahun lagi")
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := lockFlag(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := s.mayWrite(ctx, tx, v, m.category, m.customerID, true); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET note = COALESCE($2, note),
		    expires_on = CASE WHEN $3 THEN $4 ELSE expires_on END, updated_at = now() WHERE id = $1`,
			id, p.Note, p.ExpiresSet, p.ExpiresOn)
		return err
	})
}

// Remove soft-deletes a flag.
func (s *Service) Remove(ctx context.Context, v Viewer, id string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := lockFlag(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := s.mayWrite(ctx, tx, v, m.category, m.customerID, true); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET removed_at = now(), removed_by = $2, updated_at = now() WHERE id = $1`, id, v.ID)
		return err
	})
}

// Review records a coach or manager decision on a medical flag. Cleared
// removes the flag; a restriction or a doctor's note request keeps it on
// the roster with the review note.
func (s *Service) Review(ctx context.Context, v Viewer, id, decision, note string) error {
	if !domain.ValidNote(note, domain.ReviewNoteMax) {
		return httpx.BadRequest("Catatan tinjauan maksimal 300 karakter")
	}
	valid := false
	for _, d := range domain.ReviewDecisions {
		valid = valid || d == decision
	}
	if !valid {
		return httpx.BadRequest("Pilih hasil tinjauan: aman, batasi latihan, atau perlu surat dokter")
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := lockFlag(ctx, tx, id)
		if err != nil {
			return err
		}
		if m.category != domain.Medical {
			return httpx.BadRequest("Hanya penanda medis yang ditinjau")
		}
		if err := s.mayWrite(ctx, tx, v, m.category, m.customerID, true); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE gym.member_flags SET review_status = $2, review_note = $3,
		    reviewed_at = now(), reviewed_by = $4, reviewed_by_name = $5,
		    removed_at = CASE WHEN $6 THEN removed_at ELSE now() END,
		    removed_by = CASE WHEN $6 THEN removed_by ELSE $4::uuid END, updated_at = now()
		  WHERE id = $1`, id, decision, note, v.ID, v.Name, domain.ReviewKeepsFlag(decision))
		return err
	})
}
