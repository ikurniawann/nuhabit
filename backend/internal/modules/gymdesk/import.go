package gymdesk

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/importer"
)

// CSV/XLSX import of members: name, phone, email and join date, plus the
// opening balance a member brings from the old records (credits and a
// running pass). Rows are matched by phone, then email, so the file can be
// imported again; the opening balance is written once per member. See
// backend/docs/DATA_SETUP.md.

const openingNote = "Saldo awal (impor)"

var memberSpec = importer.Spec{
	Entity: "gym.members", FileName: "template-member.csv",
	Columns: []importer.Column{
		{Key: "nama", Label: "Nama", Required: true, Help: "Nama member (2-80 karakter)"},
		{Key: "telepon", Label: "Telepon", Required: true, Help: "Nomor WhatsApp, kunci unik (08xx atau 62xx)"},
		{Key: "email", Label: "Email", Help: "Kunci kedua bila nomor berubah"},
		{Key: "tanggal_bergabung", Label: "Tanggal bergabung", Help: "YYYY-MM-DD; kosong = hari ini (hanya member baru)"},
		{Key: "saldo_kredit", Label: "Saldo kredit", Help: "Sisa kredit dari catatan lama (1-1000), dicatat sekali sebagai saldo awal"},
		{Key: "kredit_berlaku_sampai", Label: "Kredit berlaku sampai", Help: "YYYY-MM-DD; kosong = sesuai aturan creditExpiryDays"},
		{Key: "paket_pass", Label: "Paket pass", Help: "Nama paket pass yang sedang berjalan"},
		{Key: "pass_berakhir", Label: "Pass berakhir", Help: "YYYY-MM-DD, wajib bila paket pass diisi"},
		{Key: "catatan", Label: "Catatan", Help: "Ditambahkan ke catatan saldo awal"},
	},
	Sample: [][]string{
		{"Rina Putri", "081234567890", "rina@example.com", "2025-03-01", "6", "2026-12-31", "", "", "Sisa paket 10 Visit"},
		{"Budi Santoso", "081298765432", "", "2026-01-15", "", "", "Pass 8 Minggu", "2026-12-15", ""},
	},
}

func (h *handler) memberTemplate(w http.ResponseWriter, _ *http.Request, _ *auth.User) error {
	return importer.WriteTemplate(w, memberSpec)
}

func (h *handler) importMembers(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	up, err := importer.Read(r, memberSpec)
	if err != nil {
		return err
	}
	opts := importer.Options{DryRun: up.DryRun, Entity: memberSpec.Entity, ActorID: user.ID, ActorName: user.FullName, Request: r}
	report, err := importer.Run(r.Context(), h.svc.db, opts, up.Rows, func(ctx context.Context, tx pgx.Tx, row importer.Row) (importer.Result, error) {
		return h.svc.importMember(ctx, tx, row, user.ID)
	})
	if err != nil {
		return err
	}
	return httpx.OK(w, report)
}

// memberRow is the existing member a row matches.
type memberRow struct {
	ID, Name, Phone, Email string
}

// findMember matches a member by phone digits (08xx and 62xx spellings),
// else by email; nil when none.
func findMember(ctx context.Context, q database.Querier, phone, email string) (*memberRow, error) {
	digits := phoneDigits(phone)
	var m memberRow
	err := q.QueryRow(ctx, `SELECT id::text, COALESCE(name, ''), COALESCE(phone, ''), COALESCE(email, '')
		FROM pos.pos_customers
		WHERE ($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ($1, '0' || substring($1 from 3)))
		   OR ($2 <> '' AND lower(email) = $2)
		ORDER BY (regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ($1, '0' || substring($1 from 3))) DESC, created_at
		LIMIT 1`, digits, strings.ToLower(email)).Scan(&m.ID, &m.Name, &m.Phone, &m.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}

// phoneDigits is the number as 62xx digits, "" when it holds no digits.
func phoneDigits(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	d := b.String()
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	return d
}

func (s *Service) importMember(ctx context.Context, tx pgx.Tx, row importer.Row, actorID string) (importer.Result, error) {
	f := memberSpec.Fields(row)
	name := f.Text("nama", 80)
	phone := f.Text("telepon", 32)
	email, _ := f.Email("email")
	joinDate, _ := f.Date("tanggal_bergabung")
	credits, hasCredits := f.Int("saldo_kredit", 1, 1000)
	creditsUntil, _ := f.Date("kredit_berlaku_sampai")
	passPackage := f.Text("paket_pass", 120)
	passEnd, hasPassEnd := f.Date("pass_berakhir")
	if passPackage != "" && !hasPassEnd {
		f.Fail("pass_berakhir", "wajib diisi bila paket pass diisi")
	}
	if passPackage == "" && hasPassEnd {
		f.Fail("paket_pass", "wajib diisi bila pass berakhir diisi")
	}
	note := openingNote
	if extra := f.Text("catatan", 500); extra != "" {
		note += ": " + extra
	}
	if err := f.Err(); err != nil {
		return importer.Result{}, err
	}
	res := importer.Result{Label: name + " (" + phone + ")"}
	existing, err := findMember(ctx, tx, phone, email)
	if err != nil {
		return res, err
	}
	var notes []string
	customerID := ""
	if existing == nil {
		customerID, err = s.ports.Accounts.Register(ctx, tx, NewMember{Name: name, Phone: phone, Email: email})
		if err != nil {
			return res, err
		}
		if joinDate != "" {
			// The join date of a member who signed up before the system
			// existed; registration stamps today otherwise.
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET created_at = ($2::date)::timestamptz WHERE id = $1`, customerID, joinDate); err != nil {
				return res, err
			}
		}
		res.Status = importer.Created
	} else {
		customerID = existing.ID
		res.Status = importer.Unchanged
		patch := ProfilePatch{}
		if existing.Name != name {
			patch.Name = &name
		}
		if phoneDigits(existing.Phone) != phoneDigits(phone) {
			patch.Phone = &phone
		}
		if email != "" && !strings.EqualFold(existing.Email, email) {
			patch.Email = &email
		}
		if patch.Name != nil || patch.Phone != nil || patch.Email != nil {
			if err := s.ports.Accounts.UpdateProfile(ctx, tx, customerID, patch); err != nil {
				return res, err
			}
			res.Status = importer.Updated
		}
	}
	if hasCredits {
		created, err := s.ports.Opening.OpeningCredits(ctx, tx, customerID, credits, creditsUntil, note, actorID)
		if err != nil {
			return res, err
		}
		if created {
			notes = append(notes, fmt.Sprintf("saldo awal %d kredit", credits))
			if res.Status == importer.Unchanged {
				res.Status = importer.Updated
			}
		} else {
			notes = append(notes, "saldo awal sudah dicatat")
		}
	}
	if passPackage != "" {
		created, err := s.ports.Opening.OpeningPass(ctx, tx, customerID, passPackage, passEnd)
		if err != nil {
			return res, err
		}
		if created {
			notes = append(notes, "pass "+passPackage+" sampai "+passEnd)
			if res.Status == importer.Unchanged {
				res.Status = importer.Updated
			}
		} else {
			notes = append(notes, "pass aktif sudah ada")
		}
	}
	res.Message = strings.Join(notes, "; ")
	return res, nil
}

// OpeningBalances writes the balances a member brings from the old
// records (owned by gym-credits). Both report whether they wrote anything;
// a member already holding the balance is left as is.
type OpeningBalances interface {
	OpeningCredits(ctx context.Context, q database.Querier, customerID string, credits int, expiresOn, note, actorID string) (bool, error)
	OpeningPass(ctx context.Context, q database.Querier, customerID, packageName, endsOn string) (bool, error)
}
