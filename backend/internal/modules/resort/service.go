package resort

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Venues resolves the caller's resort venue (resolveVenue in
// lib/resort/server.ts): the user's configuration.users company and
// branch, completed by the CRM default_company_id / default_branch_id
// settings. An empty id means unresolved.
type Venues interface {
	Resolve(ctx context.Context, userID string) (companyID, branchID string, err error)
}

// Venue is ResortContext: the caller and the venue it works in.
type Venue struct {
	UserID    string
	ActorName string // loadActorName: full_name, or "Front Office"
	CompanyID string
	BranchID  string
}

// Service holds the resort use cases.
type Service struct {
	db  database.DB
	now func() time.Time
}

// NewService builds the service on db (a pool, or a tx in tests).
func NewService(db database.DB, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

// lockBranchStock takes the per-branch advisory lock that serializes room
// stock: reservation creation (and the stock guard trigger) and check-in
// room assignment. The TS does not lock; the trigger in
// 20261005160000_resort_room_stock_guard.sql takes the same key, so a TS
// insert racing a Go one is checked against committed rows too.
func lockBranchStock(ctx context.Context, tx pgx.Tx, branchID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('resort-booking:' || $1))`, branchID)
	return err
}

// refusal turns a domain refusal into the TS ApiError.
func refusal(err error) error {
	var r *domain.Refusal
	if errors.As(err, &r) {
		return httpx.Status(r.Status, r.Message)
	}
	return err
}

// actorName is loadActorName on the caller's profile name.
func actorName(fullName string) string {
	if name := validate.JSTrim(fullName); name != "" {
		return name
	}
	return "Front Office"
}

// patch is a buildUpdateSet: validated columns in schema order.
type patch struct {
	cols []string
	vals []any
}

func (p *patch) add(col string, v any) { p.cols = append(p.cols, col); p.vals = append(p.vals, v) }

func (p *patch) empty() bool { return len(p.cols) == 0 }

// set is `a = $n, b = $n+1` continuing after the leading params.
func (p *patch) set(leading int) string {
	parts := make([]string, len(p.cols))
	for i, c := range p.cols {
		parts[i] = c + " = $" + strconv.Itoa(leading+i+1)
	}
	return strings.Join(parts, ", ")
}
