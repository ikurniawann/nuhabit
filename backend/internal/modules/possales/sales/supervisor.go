package sales

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// Approver is an approved supervisor (ApprovedSupervisor).
type Approver struct {
	ID   string
	Name string
}

// Approval is SupervisorPinApproval: Approver set, or Locked/Invalid.
type Approval struct {
	Approver     *Approver
	RetryMinutes int // > 0 when locked
}

// reject writes the standard rejection: 429 when locked, else 403 with msg.
func (a Approval) reject(w http.ResponseWriter, invalidMsg string) error {
	if a.RetryMinutes > 0 {
		return kit.Fail(w, 429, domain.SupervisorPinLockedMessage(a.RetryMinutes))
	}
	return kit.Fail(w, 403, invalidMsg)
}

// verifyPosPin is verifyPosPin: bcrypt hashes through pgcrypto's crypt()
// (bcryptjs writes $2b$, pgcrypto reads the identical $2a$ form), legacy
// plaintext compared as-is.
func verifyPosPin(ctx context.Context, q database.Querier, pin, stored string) (bool, error) {
	if stored == "" {
		return false, nil
	}
	if !strings.HasPrefix(stored, "$2") {
		return stored == pin, nil
	}
	hash := stored
	if len(hash) > 4 && (strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$")) {
		hash = "$2a$" + hash[4:]
	}
	var ok bool
	err := q.QueryRow(ctx, `SELECT crypt($1, $2) = $2`, pin, hash).Scan(&ok)
	return ok, err
}

// hashPosPin is hashPosPin (bcrypt cost 10, via pgcrypto).
func hashPosPin(ctx context.Context, q database.Querier, pin string) (string, error) {
	var h string
	err := q.QueryRow(ctx, `SELECT crypt($1, gen_salt('bf', 10))`, pin).Scan(&h)
	return h, err
}

// findSupervisor returns the first in-scope supervisor whose PIN matches.
func (h *Handler) findSupervisor(ctx context.Context, q database.Querier, pin, companyID, branchID string) (*ports.Supervisor, error) {
	list, err := h.p.Directory.ActiveSupervisors(ctx, q)
	if err != nil {
		return nil, err
	}
	for i := range list {
		s := list[i]
		if !scope.OperationalRowInScope(s.Scope, strPtr(companyID), strPtr(branchID)) {
			continue
		}
		ok, err := verifyPosPin(ctx, q, pin, s.PosPin)
		if err != nil {
			return nil, err
		}
		if ok {
			return &s, nil
		}
	}
	return nil, nil
}

// approveWithAttemptLimit is the shared frame: refuse while locked, look up
// the supervisor, record a failure or clear the count.
func (h *Handler) approveWithAttemptLimit(ctx context.Context, subjects []string, find func() (*ports.Supervisor, error)) (Approval, error) {
	now := h.now()
	if lock, err := findActiveLock(ctx, h.db, subjects, now); err != nil {
		return Approval{}, err
	} else if lock != nil {
		return Approval{RetryMinutes: domain.MinutesUntil(*lock, now)}, nil
	}
	s, err := find()
	if err != nil {
		return Approval{}, err
	}
	if s == nil {
		lock, err := recordFailure(ctx, h.db, subjects, h.now)
		if err != nil {
			return Approval{}, err
		}
		if lock != nil {
			return Approval{RetryMinutes: domain.MinutesUntil(*lock, h.now())}, nil
		}
		return Approval{}, nil
	}
	if _, err := h.db.Exec(ctx, `DELETE FROM auth.attempt_limits WHERE scope = $1 AND subject = ANY($2::text[])`, domain.SupervisorPinScope, subjects); err != nil {
		return Approval{}, err
	}
	name := "Supervisor"
	if s.FullName != nil && *s.FullName != "" {
		name = *s.FullName
	}
	return Approval{Approver: &Approver{ID: s.ID, Name: name}}, nil
}

// approveWithPin is approveWithSupervisorPin (FOC, no order): supervisors
// whose scope covers the cashier's company/branch.
func (h *Handler) approveWithPin(ctx context.Context, callerID, pin string) (Approval, error) {
	pin = domain.Trim(pin)
	return h.approveWithAttemptLimit(ctx, []string{"user:" + callerID}, func() (*ports.Supervisor, error) {
		if pin == "" {
			return nil, nil
		}
		caller, err := scope.Load(ctx, h.db, callerID)
		if err != nil {
			return nil, err
		}
		return h.findSupervisor(ctx, h.db, pin, deref(caller.CompanyID), deref(caller.BranchID))
	})
}

// orderScope is OrderScopeRow.
type orderScope struct{ CompanyID, BranchID string }

// orderInUserScope is isOrderInUserScope.
func (h *Handler) orderInUserScope(ctx context.Context, userID string, o orderScope) (bool, error) {
	s, err := scope.Load(ctx, h.db, userID)
	if err != nil {
		return false, err
	}
	return scope.OperationalRowInScope(s, strPtr(o.CompanyID), strPtr(o.BranchID)), nil
}

// approveOrderWithPin is approveOrderWithSupervisorPin: a missing or
// out-of-scope order answers like a wrong PIN; failures count per cashier
// and per order.
func (h *Handler) approveOrderWithPin(ctx context.Context, callerID, orderID string, order *orderScope, pin string) (Approval, error) {
	pin = domain.Trim(pin)
	return h.approveWithAttemptLimit(ctx, []string{"user:" + callerID, "order:" + orderID}, func() (*ports.Supervisor, error) {
		if order == nil || pin == "" {
			return nil, nil
		}
		in, err := h.orderInUserScope(ctx, callerID, *order)
		if err != nil || !in {
			return nil, err
		}
		return h.findSupervisor(ctx, h.db, pin, order.CompanyID, order.BranchID)
	})
}

/* ── auth.attempt_limits (lib/security/attempt-limit.ts) ─────────────── */

func loadAttempts(ctx context.Context, q database.Querier, sql string, args ...any) ([]domain.AttemptState, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AttemptState
	for rows.Next() {
		var s domain.AttemptState
		if err := rows.Scan(&s.Failures, &s.WindowStarted, &s.LockedUntil); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func findActiveLock(ctx context.Context, q database.Querier, subjects []string, now time.Time) (*time.Time, error) {
	states, err := loadAttempts(ctx, q, `SELECT failures, window_started_at, locked_until FROM auth.attempt_limits
		WHERE scope = $1 AND subject = ANY($2::text[])`, domain.SupervisorPinScope, subjects)
	if err != nil {
		return nil, err
	}
	var latest *time.Time
	for i := range states {
		if l := domain.ActiveLock(&states[i], now); l != nil && (latest == nil || l.After(*latest)) {
			latest = l
		}
	}
	return latest, nil
}

// recordFailure counts one failure per subject (sorted, row-locked) and
// returns the longest active lock.
func recordFailure(ctx context.Context, db database.DB, subjects []string, clock func() time.Time) (*time.Time, error) {
	ordered := append([]string(nil), subjects...)
	sortStrings(ordered)
	ordered = uniqueSorted(ordered)
	var latest *time.Time
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		for _, subject := range ordered {
			if _, err := tx.Exec(ctx, `INSERT INTO auth.attempt_limits (scope, subject) VALUES ($1, $2) ON CONFLICT (scope, subject) DO NOTHING`,
				domain.SupervisorPinScope, subject); err != nil {
				return err
			}
			states, err := loadAttempts(ctx, tx, `SELECT failures, window_started_at, locked_until FROM auth.attempt_limits
				WHERE scope = $1 AND subject = $2 FOR UPDATE`, domain.SupervisorPinScope, subject)
			if err != nil {
				return err
			}
			now := clock()
			var cur *domain.AttemptState
			if len(states) > 0 {
				cur = &states[0]
			}
			next := domain.ApplyFailure(cur, now, domain.SupervisorPinPolicy)
			if _, err := tx.Exec(ctx, `UPDATE auth.attempt_limits SET failures = $3, window_started_at = $4, locked_until = $5, updated_at = now()
				WHERE scope = $1 AND subject = $2`, domain.SupervisorPinScope, subject, next.Failures, next.WindowStarted, next.LockedUntil); err != nil {
				return err
			}
			if l := domain.ActiveLock(&next, now); l != nil && (latest == nil || l.After(*latest)) {
				latest = l
			}
		}
		return nil
	})
	return latest, err
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

func uniqueSorted(s []string) []string {
	out := s[:0]
	for i, v := range s {
		if i == 0 || v != s[i-1] {
			out = append(out, v)
		}
	}
	return out
}

/* ── /api/pos/supervisors ────────────────────────────────────────────── */

var protectedRoles = map[string]bool{"super_admin": true, "admin": true}

// listSupervisors is GET /api/pos/supervisors.
func (h *Handler) listSupervisors(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosSupervisors...); err != nil {
		return err
	}
	ctx := r.Context()
	fail := func(err error) error {
		h.log.Error("[pos/supervisors] GET failed", "error", err)
		return kit.Fail(w, 500, "Gagal memuat daftar supervisor")
	}
	q := r.URL.Query()
	if q.Get("candidates") == "1" {
		search := domain.Trim(q.Get("search"))
		sql := `SELECT "id", "full_name", "email", "role" FROM "users" WHERE "role" <> $1`
		args := []any{"pos_supervisor"}
		if search != "" {
			sql += ` AND ("full_name" ILIKE $2 OR "email" ILIKE $3)`
			pattern := strings.ReplaceAll("%"+search+"%", "*", "%")
			args = append(args, pattern, pattern)
		}
		sql += ` ORDER BY "full_name" ASC LIMIT ` + itoa(len(args)+1)
		args = append(args, 20)
		rows, err := jsrow.Query(ctx, h.db, sql, args...)
		if err != nil {
			return fail(err)
		}
		candidates := []*jsrow.Row{}
		for _, row := range rows {
			if !protectedRoles[row.Str("role")] {
				candidates = append(candidates, row)
			}
		}
		return httpx.Data(w, 200, jsrow.Object("candidates", candidates))
	}
	rows, err := jsrow.Query(ctx, h.db, `SELECT "id", "full_name", "email", "pos_pin" FROM "users" WHERE "role" = $1 ORDER BY "full_name" ASC`, "pos_supervisor")
	if err != nil {
		return fail(err)
	}
	list := make([]*jsrow.Row, len(rows))
	for i, row := range rows {
		pin := row.Str("pos_pin")
		list[i] = jsrow.Object(
			"id", row.Get("id"),
			"full_name", row.Get("full_name"),
			"email", row.Get("email"),
			"has_pin", pin != "",
			"legacy_pin", pin != "" && !strings.HasPrefix(pin, "$2"),
		)
	}
	return httpx.Data(w, 200, jsrow.Object("supervisors", list))
}

// updateSupervisor is POST /api/pos/supervisors (set_pin / promote / demote).
func (h *Handler) updateSupervisor(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.PosSupervisors...); err != nil {
		return err
	}
	ctx := r.Context()
	fail := func(err error) error {
		h.log.Error("[pos/supervisors] POST failed", "error", err)
		return kit.Fail(w, 500, "Gagal menyimpan perubahan supervisor")
	}
	raw, err := readJSON(r)
	if err != nil {
		return fail(err)
	}
	action, userID, pin, ok := parseSupervisorBody(raw)
	if !ok {
		return kit.Fail(w, 400, "Payload tidak valid")
	}
	target, err := jsrow.QueryOne(ctx, h.db, `SELECT "id", "full_name", "role" FROM "users" WHERE "id" = $1`, userID)
	if err != nil || target == nil {
		return kit.Fail(w, 404, "User tidak ditemukan")
	}
	role := target.Str("role")
	now := h.clock()
	msg := func(m string) error { return httpx.Data(w, 200, jsrow.Object("message", m)) }
	switch action {
	case "set_pin":
		if !domain.IsValidPosPin(pin) {
			return kit.Fail(w, 400, "PIN harus 4-6 digit angka")
		}
		if role != "pos_supervisor" {
			return kit.Fail(w, 400, "User ini bukan supervisor POS")
		}
		hash, err := hashPosPin(ctx, h.db, pin)
		if err == nil {
			_, err = h.db.Exec(ctx, `UPDATE "users" SET "pos_pin" = $1, "updated_at" = $2 WHERE "id" = $3`, hash, now, userID)
		}
		if err != nil {
			return fail(err)
		}
		return msg("PIN tersimpan")
	case "promote":
		if protectedRoles[role] {
			return kit.Fail(w, 400, "Akun admin tidak bisa dijadikan supervisor POS — role penuhnya akan hilang")
		}
		if role == "pos_supervisor" {
			return kit.Fail(w, 400, "User sudah menjadi supervisor POS")
		}
		if _, err := h.db.Exec(ctx, `UPDATE "users" SET "role" = $1, "updated_at" = $2 WHERE "id" = $3`, "pos_supervisor", now, userID); err != nil {
			return fail(err)
		}
		return msg("User dijadikan supervisor POS — set PIN-nya sekarang")
	}
	if role != "pos_supervisor" {
		return kit.Fail(w, 400, "User ini bukan supervisor POS")
	}
	if _, err := h.db.Exec(ctx, `UPDATE "users" SET "role" = $1, "pos_pin" = $2, "updated_at" = $3 WHERE "id" = $4`, "pos", nil, now, userID); err != nil {
		return fail(err)
	}
	return msg("Akses supervisor dicabut (role kembali kasir POS)")
}

// parseSupervisorBody is bodySchema.parse (discriminated union on action).
func parseSupervisorBody(raw any) (action, userID, pin string, ok bool) {
	m, isObj := raw.(map[string]any)
	if !isObj {
		return "", "", "", false
	}
	action, _ = m["action"].(string)
	uid, _ := m["user_id"].(string)
	if !validate.IsUUID(uid) {
		return "", "", "", false
	}
	switch action {
	case "set_pin":
		p, isStr := m["pin"].(string)
		if !isStr {
			return "", "", "", false
		}
		return action, uid, p, true
	case "promote", "demote":
		return action, uid, "", true
	}
	return "", "", "", false
}
