package app

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// dataroomPorts reads the Dataroom env the TS reads (lib/dataroom/config.ts,
// mail.ts, lib/branding.ts, lib/app-origin.ts).
func dataroomPorts(d module.Deps, getenv func(string) string, lookup func(string) (string, bool)) dataroom.Ports {
	brand := strings.TrimSpace(getenv("NEXT_PUBLIC_APP_NAME"))
	if brand == "" {
		brand = "NüHabit"
	}
	from := "Dataroom <onboarding@resend.dev>"
	if v, ok := lookup("DATAROOM_FROM_EMAIL"); ok {
		from = v
	} else if v, ok := lookup("FROM_EMAIL"); ok {
		from = v
	}
	return dataroom.Ports{
		Directory:    dataroomDirectory{db: d.DB},
		Mailer:       &resendMailer{apiKey: strings.TrimSpace(getenv("RESEND_API_KEY")), log: d.Log, client: &http.Client{Timeout: 15 * time.Second}},
		AppOrigin:    ticketingAppOrigin(getenv),
		Brand:        brand,
		MailFrom:     from,
		QuotaBytes:   envSize(getenv("DATAROOM_QUOTA_GB"), 50) * math.Pow(1024, 3),
		MaxFileBytes: envSize(getenv("DATAROOM_MAX_FILE_MB"), 100) * math.Pow(1024, 2),
	}
}

// envSize is Math.max(1, Number(value) || def).
func envSize(value string, def float64) float64 {
	n, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || n == 0 || math.IsNaN(n) {
		n = def
	}
	return math.Max(1, n)
}

// dataroomDirectory reads hris.departments and hris.employees with the SQL
// of lib/dataroom/access.ts until HRIS exposes these reads.
type dataroomDirectory struct{ db database.Querier }

var _ dataroom.Directory = dataroomDirectory{}

func (a dataroomDirectory) ActorDepartment(ctx context.Context, userID string) (*string, *string, error) {
	var id, name *string
	err := a.db.QueryRow(ctx, `SELECT e.department_id::text, d.name
		FROM hris.employees e LEFT JOIN hris.departments d ON d.id = e.department_id
		WHERE e.user_id = $1 ORDER BY e.created_at DESC NULLS LAST LIMIT 1`, userID).Scan(&id, &name)
	if database.IsNoRows(err) {
		return nil, nil, nil
	}
	return id, name, err
}

func (a dataroomDirectory) Departments(ctx context.Context) ([]dataroom.DepartmentRef, error) {
	return a.departments(ctx, `SELECT id::text, name FROM hris.departments WHERE COALESCE(is_active, true) ORDER BY name`)
}

func (a dataroomDirectory) DepartmentsByID(ctx context.Context, ids []string) ([]dataroom.DepartmentRef, error) {
	return a.departments(ctx, `SELECT id::text, name FROM hris.departments WHERE id = ANY($1::uuid[]) ORDER BY name`, ids)
}

func (a dataroomDirectory) departments(ctx context.Context, sql string, args ...any) ([]dataroom.DepartmentRef, error) {
	rows, err := a.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[dataroom.DepartmentRef])
}

// resendMailer is lib/resend sendEmail over Resend's HTTP API: false
// without RESEND_API_KEY (warned once) or on any failure.
type resendMailer struct {
	apiKey string
	log    *slog.Logger
	client *http.Client
	warned sync.Once
}

func (m *resendMailer) Send(ctx context.Context, to, from, subject, html string) bool {
	if m.apiKey == "" {
		m.warned.Do(func() { m.log.Warn("[resend] RESEND_API_KEY belum diset; email tidak dikirim") })
		return false
	}
	payload, _ := json.Marshal(map[string]string{"from": from, "to": to, "subject": subject, "html": html})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		m.log.Error("Email send error:", "error", err)
		return false
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		m.log.Error("Email send error:", "error", err)
		return false
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		m.log.Error("Resend error:", "status", res.StatusCode)
		return false
	}
	return true
}
