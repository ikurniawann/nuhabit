package gymdesk

import (
	"bytes"
	"context"
	"encoding/csv"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// LogEntry is one gate scan of the check-in log.
type LogEntry struct {
	ID            string     `json:"id"`
	CustomerID    *string    `json:"customer_id"`
	Decision      string     `json:"decision"`
	Reason        *string    `json:"reason"`
	EntryKind     *string    `json:"entry_kind"`
	CreditDelta   int        `json:"credit_delta"`
	Source        string     `json:"source"`
	CreatedAt     time.Time  `json:"created_at"`
	MemberName    *string    `json:"member_name"`
	MemberPhone   *string    `json:"member_phone"`
	ClassTypeName *string    `json:"class_type_name"`
	StartsAt      *time.Time `json:"starts_at"`
	StaffName     *string    `json:"staff_name"`
	DeviceName    *string    `json:"device_name"`
}

// LogFilter is the check-in log query.
type LogFilter struct {
	Period   domain.Period
	Decision *string
	Page     int
	PageSize int
}

// LogPage is one page of the check-in log.
type LogPage struct {
	Rows     []LogEntry `json:"rows"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
}

// CSVLimit caps one check-in log export.
const CSVLimit = 10000

const logWhere = ` WHERE l.created_at >= $1 AND l.created_at < $2 AND ($3::text IS NULL OR l.decision = $3)`

// CheckinLog is one page of scans in the period, newest first.
func (s *Service) CheckinLog(ctx context.Context, f LogFilter) (*LogPage, error) {
	out := &LogPage{Page: f.Page, PageSize: f.PageSize}
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM gym.access_logs l`+logWhere,
		f.Period.From, f.Period.To, f.Decision).Scan(&out.Total); err != nil {
		return nil, err
	}
	rows, err := s.logRows(ctx, f, f.PageSize, (f.Page-1)*f.PageSize)
	if err != nil {
		return nil, err
	}
	out.Rows = rows
	return out, nil
}

func (s *Service) logRows(ctx context.Context, f LogFilter, limit, offset int) ([]LogEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT l.id::text, l.customer_id::text, l.decision, l.reason, l.entry_kind, l.credit_delta, l.source, l.created_at,
		       c.name, c.phone, t.name, s.starts_at, u.full_name, d.name
		  FROM gym.access_logs l
		  LEFT JOIN pos.pos_customers c ON c.id = l.customer_id
		  LEFT JOIN gym.bookings b ON b.id = l.booking_id
		  LEFT JOIN gym.class_sessions s ON s.id = b.session_id
		  LEFT JOIN gym.class_types t ON t.id = s.class_type_id
		  LEFT JOIN configuration.users u ON u.id = l.scanned_by
		  LEFT JOIN gym.gate_devices d ON d.id = l.device_id`+logWhere+`
		 ORDER BY l.created_at DESC, l.id
		 LIMIT $4 OFFSET $5`, f.Period.From, f.Period.To, f.Decision, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[LogEntry])
}

var (
	decisionLabel = map[string]string{"allowed": "Diterima", "denied": "Ditolak"}
	sourceLabel   = map[string]string{"gate": "Gate", "pos": "Kasir", "manual": "Front desk", "device": "Perangkat gate"}
	// reasonLabel is GATE_DENIAL_LABEL in frontend/src/lib/gym/booking.ts, shortened.
	reasonLabel = map[string]string{
		"token_invalid": "QR tidak dikenal", "token_expired": "QR kedaluwarsa", "token_consumed": "QR sudah dipakai",
		"member_not_active": "Keanggotaan tidak aktif", "anti_passback": "Baru saja masuk", "no_booking": "Tidak ada booking kelas",
		"insufficient_credits": "Kredit tidak cukup", "waiver_required": "Belum waiver", "open_gym_closed": "Di luar jam open gym",
	}
	kindLabel = map[string]string{"booking": "Check-in kelas", "re_entry": "Masuk ulang", "open_gym": "Open gym"}
)

func label(m map[string]string, v *string) string {
	if v == nil {
		return ""
	}
	if l, ok := m[*v]; ok {
		return l
	}
	return *v
}

func text(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// CheckinCSV is up to CSVLimit scans of the period as CSV, newest first,
// times in the period's zone.
func (s *Service) CheckinCSV(ctx context.Context, f LogFilter) ([]byte, error) {
	rows, err := s.logRows(ctx, f, CSVLimit, 0)
	if err != nil {
		return nil, err
	}
	clock := func(t *time.Time) string {
		if t == nil {
			return ""
		}
		return t.In(f.Period.Zone).Format("2006-01-02 15:04")
	}
	var buf bytes.Buffer
	out := csv.NewWriter(&buf)
	_ = out.Write([]string{"Waktu (" + localtime.Abbrev(f.Period.Zone) + ")", "Member", "Telepon", "Hasil", "Keterangan", "Kelas", "Jadwal kelas", "Kredit", "Sumber", "Staf", "Perangkat"})
	for _, r := range rows {
		note := label(kindLabel, r.EntryKind)
		if r.Decision == "denied" {
			note = label(reasonLabel, r.Reason)
		}
		_ = out.Write([]string{
			clock(&r.CreatedAt), text(r.MemberName), text(r.MemberPhone), label(decisionLabel, &r.Decision), note,
			text(r.ClassTypeName), clock(r.StartsAt), strconv.Itoa(-r.CreditDelta), label(sourceLabel, &r.Source), text(r.StaffName), text(r.DeviceName),
		})
	}
	out.Flush()
	return buf.Bytes(), out.Error()
}
