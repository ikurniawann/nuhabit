package insights

import (
	"context"
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/insights/domain"
)

// Do read tools and write-action proposals (lib/assistant/tools.ts,
// write-tools.ts). The model only picks a tool and its arguments; the SQL is
// fixed, parameterized and bounded by LIMIT.

func errorResult(msg string) domain.Object { return domain.Object{{Key: "error", Value: msg}} }

// runTool runs one read tool. Unknown names and failures come back as data
// so the model can explain them.
func (s *Service) runTool(ctx context.Context, name string, args map[string]any) domain.Object {
	run, ok := map[string]func(context.Context, map[string]any) (domain.Object, error){
		domain.ToolCariKaryawan:     s.toolCariKaryawan,
		domain.ToolAbsensiHariIni:   s.toolAbsensi,
		domain.ToolStokMenipis:      s.toolStokMenipis,
		domain.ToolPenjualanPeriode: s.toolPenjualan,
		domain.ToolStatusKandidat:   s.toolStatusKandidat,
	}[name]
	if !ok {
		return errorResult("Tool tidak dikenal: " + name)
	}
	out, err := run(ctx, args)
	if err != nil {
		s.log.ErrorContext(ctx, "[do:tool] gagal", "tool", name, "error", err)
		return errorResult("Data gagal diambil dari sistem")
	}
	return out
}

func (s *Service) toolCariKaryawan(ctx context.Context, args map[string]any) (domain.Object, error) {
	keyword := domain.ArgString(args, "nama")
	if keyword == "" {
		return errorResult("Nama tidak boleh kosong"), nil
	}
	rows, err := queryObjects(ctx, s.db, `SELECT e.full_name, e.nip, e.employment_status, e.is_active,
	        e.join_date::text AS join_date,
	        d.name AS departemen
	   FROM hris.employees e
	   LEFT JOIN hris.departments d ON d.id = e.department_id
	  WHERE e.full_name ILIKE $1 OR e.nip ILIKE $1
	  ORDER BY e.is_active DESC, e.full_name
	  LIMIT $2`, "%"+keyword+"%", domain.ToolRowLimit)
	if err != nil {
		return nil, err
	}
	return domain.Object{{Key: "jumlah", Value: len(rows)}, {Key: "karyawan", Value: rows}}, nil
}

func (s *Service) toolAbsensi(ctx context.Context, args map[string]any) (domain.Object, error) {
	date := domain.ArgDate(args, "tanggal")
	if date == "" {
		date = todayJakarta(s.now())
	}
	summary, err := queryObjects(ctx, s.db, `SELECT count(*)::int AS sudah_absen,
	        count(*) FILTER (WHERE is_late)::int AS terlambat
	   FROM hris.attendance
	  WHERE date = $1::date`, date)
	if err != nil {
		return nil, err
	}
	belum, err := queryObjects(ctx, s.db, `SELECT e.full_name, e.nip
	   FROM hris.employees e
	  WHERE e.is_active
	    AND NOT EXISTS (
	      SELECT 1 FROM hris.attendance a
	       WHERE a.employee_id = e.id AND a.date = $1::date
	    )
	  ORDER BY e.full_name
	  LIMIT $2`, date, domain.ToolRowLimit)
	if err != nil {
		return nil, err
	}
	var sudah, terlambat any = 0, 0
	if len(summary) > 0 {
		sudah, terlambat = summary[0].Get("sudah_absen"), summary[0].Get("terlambat")
	}
	out := domain.Object{
		{Key: "tanggal", Value: date},
		{Key: "sudah_absen", Value: sudah},
		{Key: "terlambat", Value: terlambat},
		{Key: "belum_absen_jumlah", Value: len(belum)},
		{Key: "belum_absen", Value: belum},
	}
	if len(belum) == domain.ToolRowLimit {
		out = append(out, domain.Field{Key: "catatan", Value: "Daftar dipotong di " + strconv.Itoa(domain.ToolRowLimit) + " nama pertama"})
	}
	return out, nil
}

func (s *Service) toolStokMenipis(ctx context.Context, _ map[string]any) (domain.Object, error) {
	rows, err := queryObjects(ctx, s.db, `SELECT rm.nama AS bahan, rm.kode,
	        i.qty_available::float AS tersedia,
	        i.qty_minimum::float AS minimum,
	        i.qty_on_order::float AS sedang_dipesan
	   FROM inventory.inventory i
	   JOIN item.raw_materials rm ON rm.id = i.raw_material_id
	  WHERE i.is_active
	    AND rm.deleted_at IS NULL
	    AND i.qty_available <= i.qty_minimum
	  ORDER BY (i.qty_minimum - i.qty_available) DESC
	  LIMIT $1`, domain.ToolRowLimit)
	if err != nil {
		return nil, err
	}
	return domain.Object{{Key: "jumlah", Value: len(rows)}, {Key: "bahan", Value: rows}}, nil
}

// toolPenjualan uses the single omzet definition: paid orders that are not
// cancelled, voided or merged.
func (s *Service) toolPenjualan(ctx context.Context, args map[string]any) (domain.Object, error) {
	dari := domain.ArgDate(args, "dari")
	if dari == "" {
		dari = todayJakarta(s.now())
	}
	sampai := domain.ArgDate(args, "sampai")
	if sampai == "" {
		sampai = dari
	}
	rows, err := queryObjects(ctx, s.db, `SELECT count(*)::int AS jumlah_pesanan,
	        COALESCE(sum(total_amount), 0)::float AS total_omzet,
	        COALESCE(avg(total_amount), 0)::float AS rata_rata
	   FROM pos.pos_orders
	  WHERE COALESCE(ordered_at, created_at) >= $1::date
	    AND COALESCE(ordered_at, created_at) < ($2::date + interval '1 day')
	    AND payment_status = 'paid'
	    AND status::text NOT IN ('cancelled', 'voided', 'merged')`, dari, sampai)
	if err != nil {
		return nil, err
	}
	out := domain.Object{{Key: "dari", Value: dari}, {Key: "sampai", Value: sampai}}
	if len(rows) > 0 {
		out = append(out, rows[0]...)
	}
	return out, nil
}

func (s *Service) toolStatusKandidat(ctx context.Context, args map[string]any) (domain.Object, error) {
	keyword := domain.ArgString(args, "nama")
	var limit any = min(max(domain.ArgInt(args, "batas", 10), 1), domain.ToolRowLimit)
	if f := limit.(float64); f == math.Trunc(f) {
		limit = int64(f) // a fractional LIMIT fails in PostgreSQL, as in the TS
	}
	var rows []domain.Object
	var err error
	if keyword != "" {
		rows, err = queryObjects(ctx, s.db, `SELECT full_name, status, source, domicile, created_at::text
		   FROM recruitment.candidates
		  WHERE full_name ILIKE $1
		  ORDER BY created_at DESC
		  LIMIT $2`, "%"+keyword+"%", limit)
	} else {
		rows, err = queryObjects(ctx, s.db, `SELECT full_name, status, source, domicile, created_at::text
		   FROM recruitment.candidates
		  ORDER BY created_at DESC
		  LIMIT $1`, limit)
	}
	if err != nil {
		return nil, err
	}
	return domain.Object{{Key: "jumlah", Value: len(rows)}, {Key: "kandidat", Value: rows}}, nil
}

// pendingAction is PendingActionMeta, the confirmation card shown by the UI.
type pendingAction struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

type actionCtx struct {
	UserID, UserName string
	SessionID        string // "" when there is none
}

// proposeWriteAction validates a write tool call and stores a pending
// ai_assistant_actions row; it never writes business data. errMsg is set
// when nothing was proposed.
func (s *Service) proposeWriteAction(ctx context.Context, name string, args map[string]any, ac actionCtx) (*pendingAction, string) {
	if !domain.IsWriteAction(name) {
		return nil, "Aksi tidak dikenal: " + name
	}
	var payload any
	var summary string
	switch name {
	case domain.ActionPengumuman:
		p, msg := domain.ValidatePengumuman(args)
		if msg != "" {
			return nil, msg
		}
		tagInfo := ""
		if len(p.Tags) > 0 {
			tagInfo = ", tag: " + strings.Join(p.Tags, ", ")
		}
		payload = p
		summary = `Buat DRAFT pengumuman "` + p.Judul + `" (` + strconv.Itoa(domain.Len(p.Isi)) + " karakter" + tagInfo + "). " +
			"Draft tidak tampil ke karyawan sampai dipublikasikan lewat CMS Pengumuman."
	case domain.ActionCatatan:
		c, msg := domain.ValidateCatatanKandidat(args)
		if msg != "" {
			return nil, msg
		}
		// Resolve the candidate now so the card names one certain person.
		matches, err := queryObjects(ctx, s.db, `SELECT id, full_name FROM recruitment.candidates
		  WHERE full_name ILIKE $1
		  ORDER BY created_at DESC
		  LIMIT 6`, "%"+c.Kandidat+"%")
		if err != nil {
			s.log.ErrorContext(ctx, "[do:write] usulan gagal", "action", name, "error", err)
			return nil, "Aksi gagal disiapkan"
		}
		switch len(matches) {
		case 0:
			return nil, `Tidak ada kandidat bernama "` + c.Kandidat + `"`
		case 1:
		default:
			names := make([]string, len(matches))
			for i, m := range matches {
				names[i] = domain.JSString(m.Get("full_name"))
			}
			return nil, "Lebih dari satu kandidat cocok (" + strings.Join(names, ", ") + "). Minta user menyebut nama lengkap yang persis."
		}
		fullName := domain.JSString(matches[0].Get("full_name"))
		payload = domain.Object{
			{Key: "candidate_id", Value: matches[0].Get("id")},
			{Key: "candidate_name", Value: matches[0].Get("full_name")},
			{Key: "catatan", Value: c.Catatan},
		}
		summary = `Tambah catatan HR ke kandidat "` + fullName + `": ` + domain.Truncate(c.Catatan, 140)
	}
	raw, err := domain.Marshal(payload)
	if err != nil {
		return nil, "Aksi gagal disiapkan"
	}
	var session *string
	if ac.SessionID != "" {
		session = &ac.SessionID
	}
	var id string
	err = s.db.QueryRow(ctx, `INSERT INTO ai_assistant_actions (session_id, user_id, action_name, payload, summary)
	   VALUES ($1, $2, $3, $4::text::jsonb, $5)
	   RETURNING id::text`, session, ac.UserID, name, string(raw), summary).Scan(&id)
	if err != nil {
		s.log.ErrorContext(ctx, "[do:write] usulan gagal", "action", name, "error", err)
		return nil, "Aksi gagal disiapkan"
	}
	return &pendingAction{ID: id, Name: name, Summary: summary, Status: "pending"}, ""
}
