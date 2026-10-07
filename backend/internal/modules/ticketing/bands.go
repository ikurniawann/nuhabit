package ticketing

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The venue's NFC band registry and staff band pairing (bands-server.ts).
// 'dipakai' is set by visits and 'karyawan' by pairing; the registry only
// marks bands tersedia, hilang or rusak.

// BandStatuses are the ticket_bands statuses.
var BandStatuses = []string{"tersedia", "dipakai", "hilang", "rusak", "karyawan"}

const bandColumns = `id, nfc_uid, label, status, created_at, updated_at`

// ListBands is listBands.
func (s *Service) ListBands(ctx context.Context, v Venue, q, status string, page, limit float64) (listResult, error) {
	conds := []string{"branch_id = $1", "company_id = $2"}
	args := []any{v.BranchID, v.CompanyID}
	if status != "" && slices.Contains(BandStatuses, status) {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("status = $%d", len(args)))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		conds = append(conds, fmt.Sprintf("(nfc_uid ILIKE $%d OR label ILIKE $%d)", len(args), len(args)))
	}
	lim, off := pageArgs(page, limit)
	args = append(args, lim, off)
	rows, err := queryRows(ctx, s.db, fmt.Sprintf(`SELECT %s, COUNT(*) OVER() AS total_count
		FROM ticketing.ticket_bands
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, bandColumns, strings.Join(conds, " AND "), len(args)-1, len(args)), args...)
	if err != nil {
		return listResult{}, err
	}
	return splitTotal(rows), nil
}

// RegisterBand is registerBand.
func (s *Service) RegisterBand(ctx context.Context, v Venue, rawUID string, label *string) (*Row, error) {
	uid := domain.NormalizeNfcUID(rawUID)
	if !domain.IsValidNfcUID(uid) {
		return nil, httpx.BadRequest("UID gelang tidak valid — scan ulang kartu/gelang")
	}
	var status string
	err := s.db.QueryRow(ctx, `SELECT status FROM ticketing.ticket_bands
		WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3`, v.BranchID, v.CompanyID, uid).Scan(&status)
	if err == nil {
		return nil, httpx.Conflict("Gelang sudah terdaftar (status: " + status + ")")
	}
	if !database.IsNoRows(err) {
		return nil, err
	}
	return queryRow(ctx, s.db, `INSERT INTO ticketing.ticket_bands (company_id, branch_id, nfc_uid, label, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+bandColumns, v.CompanyID, v.BranchID, uid, orNil(label), v.UserID)
}

// BandPatch is updateBandSchema after parsing; nil fields are untouched.
type BandPatch struct {
	LabelSet bool
	Label    *string
	Status   *string
}

// UpdateBand is updateBand.
func (s *Service) UpdateBand(ctx context.Context, v Venue, id string, p BandPatch) (*Row, error) {
	if p.Status != nil {
		switch *p.Status {
		case "dipakai":
			return nil, httpx.BadRequest("Status 'dipakai' diatur otomatis oleh registrasi kunjungan")
		case "karyawan":
			return nil, httpx.BadRequest("Status 'karyawan' diatur otomatis oleh pairing Gelang Karyawan")
		}
	}
	set := newPatch(3)
	if p.LabelSet {
		set.add("label", orNil(p.Label))
	}
	if p.Status != nil {
		set.add("status", *p.Status)
	}
	row, err := queryRow(ctx, s.db, `UPDATE ticketing.ticket_bands SET `+set.sql()+`
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		  AND status NOT IN ('dipakai', 'karyawan')
		RETURNING `+bandColumns, append([]any{id, v.BranchID, v.CompanyID}, set.values...)...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound("Gelang tidak ditemukan, sedang dipakai kunjungan aktif, atau dipegang karyawan (cabut pairing dulu)")
	}
	return row, nil
}

// patch is patchAssignments: "updated_at = now()" first, then each set
// column with a placeholder after offset.
type patch struct {
	offset      int
	assignments []string
	values      []any
}

func newPatch(offset int, fixed ...string) *patch {
	return &patch{offset: offset, assignments: append([]string{"updated_at = now()"}, fixed...)}
}

func (p *patch) add(column string, value any) {
	p.values = append(p.values, value)
	p.assignments = append(p.assignments, fmt.Sprintf("%s = $%d", column, p.offset+len(p.values)))
}

func (p *patch) sql() string { return strings.Join(p.assignments, ", ") }

// ListStaffPasses is listStaffPasses: active pairings, searchable by
// employee name, NIP or band UID, ordered by employee name.
func (s *Service) ListStaffPasses(ctx context.Context, v Venue, q string) ([]*Row, error) {
	uidPattern := ""
	if q != "" {
		uid := domain.NormalizeNfcUID(q)
		if uid == "" {
			uid = q
		}
		uidPattern = "%" + uid + "%"
	}
	passes, err := queryRows(ctx, s.db, `SELECT sp.id, sp.band_id, b.nfc_uid, b.label AS band_label,
		  sp.employee_id, sp.created_at, b.nfc_uid ILIKE $3 AS uid_match
		FROM ticketing.ticket_staff_passes sp
		JOIN ticketing.ticket_bands b ON b.id = sp.band_id
		WHERE sp.branch_id = $1 AND sp.company_id = $2 AND sp.is_active = true`, v.BranchID, v.CompanyID, uidPattern)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(passes))
	byEmployee := map[string][]*Row{}
	for _, p := range passes {
		id := p.Str("employee_id")
		if _, seen := byEmployee[id]; !seen {
			ids = append(ids, id)
		}
		byEmployee[id] = append(byEmployee[id], p)
	}
	pattern := ""
	if q != "" {
		pattern = "%" + q + "%"
	}
	employees, err := s.ports.Employees.Find(ctx, s.db, ids, pattern)
	if err != nil {
		return nil, err
	}
	out := []*Row{}
	for _, e := range employees {
		for _, p := range byEmployee[e.ID] {
			if q != "" && !e.Matched && !p.Bool("uid_match") {
				continue
			}
			if len(out) == 200 {
				return out, nil
			}
			out = append(out, object(
				"id", p.Get("id"), "band_id", p.Get("band_id"), "nfc_uid", p.Get("nfc_uid"), "band_label", p.Get("band_label"),
				"employee_id", e.ID, "full_name", e.FullName, "nip", e.NIP, "employee_active", e.IsActive,
				"created_at", p.Get("created_at"),
			))
		}
	}
	return out, nil
}

// PairStaffPass is pairStaffPass: a 'tersedia' band to an active employee.
func (s *Service) PairStaffPass(ctx context.Context, v Venue, rawUID, employeeID string) (string, string, error) {
	uid := domain.NormalizeNfcUID(rawUID)
	if !domain.IsValidNfcUID(uid) {
		return "", "", httpx.BadRequest("UID gelang tidak valid — scan ulang")
	}
	var id, employee string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var bandID, status string
		err := tx.QueryRow(ctx, `SELECT id::text, status FROM ticketing.ticket_bands
			WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3
			FOR UPDATE`, v.BranchID, v.CompanyID, uid).Scan(&bandID, &status)
		if database.IsNoRows(err) {
			return httpx.BadRequest("Gelang " + uid + " belum terdaftar di registry — daftarkan dulu")
		}
		if err != nil {
			return err
		}
		if status != "tersedia" {
			return httpx.Conflict(`Gelang berstatus "` + status + `" — hanya gelang tersedia yang bisa dipasangkan`)
		}
		found, err := s.ports.Employees.Find(ctx, tx, []string{employeeID}, "")
		if err != nil {
			return err
		}
		if len(found) == 0 || !found[0].IsActive {
			return httpx.BadRequest("Karyawan tidak ditemukan / nonaktif")
		}
		employee = found[0].FullName
		var held bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_staff_passes
			WHERE branch_id = $1 AND employee_id = $2 AND is_active = true)`, v.BranchID, employeeID).Scan(&held); err != nil {
			return err
		}
		if held {
			return httpx.Conflict("Karyawan ini sudah memegang gelang — cabut dulu yang lama")
		}
		if err := tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_staff_passes (company_id, branch_id, band_id, employee_id, created_by)
			VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, v.CompanyID, v.BranchID, bandID, employeeID, v.UserID).Scan(&id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'karyawan', updated_at = now() WHERE id = $1`, bandID)
		return err
	})
	return id, employee, onDuplicate(err, "Gelang/karyawan sudah terpasang — muat ulang daftar")
}

// RevokeStaffPass is revokeStaffPass: the pairing goes inactive (history
// kept) and the band returns to 'tersedia'.
func (s *Service) RevokeStaffPass(ctx context.Context, v Venue, id string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		var bandID string
		err := tx.QueryRow(ctx, `UPDATE ticketing.ticket_staff_passes
			SET is_active = false, revoked_at = now(), revoked_by = $4, updated_at = now()
			WHERE id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true
			RETURNING band_id::text`, id, v.BranchID, v.CompanyID, v.UserID).Scan(&bandID)
		if database.IsNoRows(err) {
			return httpx.NotFound("Pairing tidak ditemukan / sudah dicabut")
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'tersedia', updated_at = now()
			WHERE id = $1 AND status = 'karyawan'`, bandID)
		return err
	})
}
