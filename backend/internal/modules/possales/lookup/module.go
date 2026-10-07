// Package lookup ports two cashier scans: GET /api/pos/pass-lookup (season
// pass member discount) and POST /api/pos/member-qr (member card QR, which
// is also a gym class check-in).
package lookup

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/lookup/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves the routes of this package.
type Handler struct {
	db    database.DB
	auth  *auth.Service
	log   *slog.Logger
	now   func() time.Time
	ports Ports
}

// New builds the handler on deps.DB.
func New(deps module.Deps, p Ports) *Handler { return newHandler(deps, deps.DB, p) }

// newHandler takes the database separately so tests can pass a rolled-back
// transaction.
func newHandler(deps module.Deps, db database.DB, p Ports) *Handler {
	if p.Passes == nil {
		p.Passes = PassesSQL{}
	}
	if p.MemberQr == nil {
		p.MemberQr = MemberQrSQL{}
	}
	h := &Handler{db: db, auth: deps.Auth, log: deps.Log, now: deps.Now, ports: p}
	if h.log == nil {
		h.log = slog.Default()
	}
	if h.now == nil {
		h.now = time.Now
	}
	return h
}

// Routes lists the routes.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/pass-lookup", Handler: httpx.Handle(h.passLookup)},
		{Pattern: "POST /api/pos/member-qr", Handler: httpx.Handle(h.memberQr)},
	}
}

// passLookup matches a scanned pass QR token, pass code or wristband UID and
// returns the member discount when the pass is active and in its window.
func (h *Handler) passLookup(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	raw := validate.JSTrim(r.URL.Query().Get("code"))
	if raw == "" {
		return kit.Fail(w, http.StatusBadRequest, "Kode pass kosong")
	}
	pass, err := h.ports.Passes.FindSeasonPass(r.Context(), h.db, domain.ParsePassCode(raw))
	if err != nil {
		h.log.Error("[pos] pass lookup error", "err", err)
		return kit.Fail(w, http.StatusInternalServerError, "Gagal memeriksa pass")
	}
	return httpx.Data(w, http.StatusOK, domain.EvaluatePass(pass, domain.TodayInJakarta(h.now())))
}

type memberQrData struct {
	CustomerID string            `json:"customer_id"`
	Name       *string           `json:"name"`
	Phone      string            `json:"phone"`
	Gym        *GymCheckInResult `json:"gym"`
}

// memberQr accepts a member card QR for the order, then tries a gym class
// check-in for the same member. The order goes ahead whatever the gym
// decides, and a failed check-in only leaves `gym` null.
func (h *Handler) memberQr(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.PosOperations...)
	if err != nil {
		return err
	}
	// parseJsonBody: an unreadable body validates as {}.
	body, ok := validate.ReadBody(r)
	if !ok {
		body, ok = map[string]any{}, true
	}
	f := validate.New(body, ok)
	token := f.Str("token", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 120})
	if err := f.Err("QR tidak valid"); err != nil {
		return err
	}

	ctx := r.Context()
	var scan QrScan
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) (err error) {
		scan, err = h.ports.MemberQr.ScanMemberQr(ctx, tx, *token, user.ID, h.now())
		return err
	})
	if err != nil {
		return err
	}
	if scan.Problem != "" {
		return httpx.Conflict(domain.QrProblemLabel[scan.Problem])
	}

	return httpx.Data(w, http.StatusOK, memberQrData{
		CustomerID: scan.CustomerID, Name: scan.Name, Phone: scan.Phone,
		Gym: h.gymCheckIn(ctx, scan.CustomerID, user.ID),
	})
}

func (h *Handler) gymCheckIn(ctx context.Context, customerID, scannedBy string) *GymCheckInResult {
	if h.ports.Gym == nil {
		return nil
	}
	res, err := h.ports.Gym.CheckInAtPos(ctx, h.db, customerID, scannedBy)
	if err != nil {
		h.log.Error("[pos/member-qr] gym check-in failed", "err", err)
		return nil
	}
	return res
}
