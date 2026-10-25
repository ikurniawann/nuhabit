package investor

import (
	"context"
	"fmt"
	"html"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/investor/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/localtime"
)

// Kirim ringkasan harian: investors who turn it on get one email per day
// from 07:00 WIB with yesterday's revenue, the month to date and the
// member and class figures. The job runs every few minutes and claims each
// (user, day) once through platform.reminder_sends, so replicas and
// restarts never send twice.

const (
	digestKind = "investor-digest"
	digestHour = 7
)

// DigestEnabled is the caller's setting.
func (s *Service) DigestEnabled(ctx context.Context, userID string) (bool, error) {
	var enabled bool
	err := s.db.QueryRow(ctx, `SELECT enabled FROM investor.digest_settings WHERE user_id = $1`, userID).Scan(&enabled)
	if database.IsNoRows(err) {
		return false, nil
	}
	return enabled, err
}

// SetDigest stores the caller's setting.
func (s *Service) SetDigest(ctx context.Context, userID string, enabled bool) error {
	_, err := s.db.Exec(ctx, `INSERT INTO investor.digest_settings (user_id, enabled) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, userID, enabled)
	return err
}

var digestWarn sync.Once

// SendDailyDigest mails every subscribed investor the digest of today
// (WIB) once the clock passes 07:00. Each send is claimed in its own
// transaction; a failed send rolls the claim back for the next run.
func (s *Service) SendDailyDigest(ctx context.Context, now time.Time) error {
	if now.In(localtime.Jakarta).Hour() < digestHour {
		return nil
	}
	if s.ports.Mailer == nil || !s.ports.Mailer.Configured() {
		digestWarn.Do(func() { s.log.Warn("investor: ringkasan harian tidak dikirim, email belum dikonfigurasi") })
		return nil
	}
	rows, err := s.db.Query(ctx, `SELECT d.user_id::text, u.email FROM investor.digest_settings d
		JOIN auth.users u ON u.id = d.user_id WHERE d.enabled ORDER BY d.user_id`)
	if err != nil {
		return err
	}
	type recipient struct{ ID, Email string }
	recipients, err := pgx.CollectRows(rows, pgx.RowToStructByPos[recipient])
	if err != nil || len(recipients) == 0 {
		return err
	}
	day := localtime.DayKey(now, localtime.Jakarta)
	var overview *Overview
	var failed []string
	for _, r := range recipients {
		err := database.WithTx(ctx, s.db, func(q pgx.Tx) error {
			claimed, err := jobs.ClaimSend(ctx, q, digestKind, r.ID, day, nil)
			if err != nil || !claimed {
				return err
			}
			if overview == nil {
				if overview, _, err = s.Overview(ctx, nil); err != nil {
					return err
				}
			}
			if !s.ports.Mailer.Send(ctx, r.Email, digestSubject(overview), digestHTML(overview)) {
				return fmt.Errorf("kirim ke %s gagal", r.ID)
			}
			return nil
		})
		if err != nil {
			failed = append(failed, r.ID)
			s.log.ErrorContext(ctx, "investor: ringkasan harian gagal", "user", r.ID, "error", err)
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("investor: %d ringkasan harian gagal terkirim", len(failed))
	}
	return nil
}

func digestSubject(o *Overview) string {
	return "Ringkasan harian NüHabit " + localtime.FormatDate(mustDay(o.Today), localtime.Jakarta)
}

func mustDay(day string) time.Time {
	t, _ := localtime.ParseDay(day, localtime.Jakarta)
	return t
}

var streamLabels = map[string]string{
	domain.StreamPackages: "Paket kredit",
	domain.StreamPasses:   "Pass",
	domain.StreamPT:       "Personal training",
	domain.StreamPOS:      "Toko / POS",
}

// digestHTML renders the digest: yesterday, month to date by stream, members
// and classes. Figures are rupiah without decimals.
func digestHTML(o *Overview) string {
	var b strings.Builder
	row := func(label string, value string) {
		fmt.Fprintf(&b, `<tr><td style="padding:4px 12px 4px 0">%s</td><td style="padding:4px 0;text-align:right"><strong>%s</strong></td></tr>`,
			html.EscapeString(label), html.EscapeString(value))
	}
	b.WriteString(`<div style="font-family:Arial,sans-serif;color:#1f2a1f;max-width:560px">`)
	fmt.Fprintf(&b, `<h2 style="margin:0 0 12px">Ringkasan harian %s</h2>`, html.EscapeString(localtime.FormatDate(mustDay(o.Today), localtime.Jakarta)))
	b.WriteString(`<table style="border-collapse:collapse;font-size:14px">`)
	row("Pendapatan kemarin", rupiah(o.Revenue.Today.Previous))
	row("Pendapatan bulan berjalan", rupiah(o.Revenue.MTD.Value))
	for _, s := range domain.Streams {
		row("  "+streamLabels[s], rupiah(o.Revenue.Streams[s]))
	}
	row("Pendapatan tahun berjalan", rupiah(o.Revenue.YTD.Value))
	row("Member aktif 30 hari", fmt.Sprintf("%d", o.Members.Active))
	row("Member baru bulan ini", fmt.Sprintf("%.0f", o.Members.New.Value))
	row("Check-in kelas 30 hari", fmt.Sprintf("%d", o.Classes.CheckedIn))
	row("Rata-rata isi kelas", fmt.Sprintf("%.0f%%", o.Classes.AvgFill*100))
	row("Sesi PT bulan ini", fmt.Sprintf("%.0f", o.PT.Value))
	row("ARK Coin beredar", rupiah(o.ArkCoin))
	row("Pendapatan ditangguhkan", rupiah(o.DeferredRevenue.Total))
	b.WriteString(`</table>`)
	b.WriteString(`<p style="font-size:12px;color:#5b6b5b;margin-top:16px">Angka dihitung dalam WIB untuk seluruh cabang. Buka portal investor untuk grafik dan laporan bulanan.</p></div>`)
	return b.String()
}

// rupiah formats a whole-rupiah amount with dots as thousand separators.
func rupiah(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	digits := fmt.Sprintf("%.0f", v)
	var out []byte
	for i, c := range []byte(digits) {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	if neg {
		return "-Rp " + string(out)
	}
	return "Rp " + string(out)
}
