// Package kit is the transport toolkit shared by the stored-value
// sub-packages (wallet, gift cards, promo): the POS and promo guards, the
// shared rate limiter, the handler wrappers and the response helpers
// whose envelopes the TS routes use.
package kit

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

// Venue is a company + branch pair (either may be unset).
type Venue struct {
	CompanyID *string
	BranchID  *string
}

// Branch is an active configuration.branches row.
type Branch struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Directory reads venue and settings data owned by other contexts
// (configuration branches and companies, crm.crm_settings, pos_orders
// numbers).
type Directory interface {
	// DefaultVenue is getCrmDefaultVenue: crm_settings default_company_id /
	// default_branch_id; any failure is an empty venue.
	DefaultVenue(ctx context.Context, q database.Querier) Venue
	// BranchCompany is configuration.branches.company_id (nil when unknown).
	BranchCompany(ctx context.Context, q database.Querier, branchID string) (*string, error)
	ActiveBranches(ctx context.Context, q database.Querier) ([]Branch, error)
	// FirstCompanyName is the oldest configuration.companies name.
	FirstCompanyName(ctx context.Context, q database.Querier) (*string, error)
	// ArkCoinEnabled is isArkCoinEnabled (crm_settings ark_coin_enabled,
	// default on).
	ArkCoinEnabled(ctx context.Context, q database.Querier) bool
	// OrderNumbers maps pos_orders ids to their order_number.
	OrderNumbers(ctx context.Context, q database.Querier, ids []string) (map[string]string, error)
}

// Kit carries what every stored-value handler needs.
type Kit struct {
	Auth    *auth.Service
	Log     *slog.Logger
	Now     func() time.Time
	DB      database.DB
	Dir     Directory
	Limiter *ratelimit.Limiter
	// AppOrigin is NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_BASE_URL ("" = request).
	AppOrigin string
}

/* ── guards ──────────────────────────────────────────────────────────── */

// PosUser mirrors getPosSession / requirePosSession: a staff user with a
// POS menu grant. A 401 or 403 from the guard both become 401
// "Authentication required".
func (k *Kit) PosUser(r *http.Request) (*auth.User, error) {
	u, err := k.Auth.RequireMenuPrefix(r, iam.Pos...)
	var e *httpx.Error
	if errors.As(err, &e) && (e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden) {
		return nil, httpx.Unauthorized("Authentication required")
	}
	return u, err
}

// RateLimit mirrors checkRateLimit + a 429 with msg; every replica counts
// against the same window.
func (k *Kit) RateLimit(ctx context.Context, key string, limit int, msg string) error {
	w, err := k.Limiter.Fixed(ctx, key, limit, domain.RateWindow, k.Now())
	if err != nil {
		return err
	}
	if !w.Allowed {
		return httpx.TooManyRequests(msg)
	}
	return nil
}

// EnforceRateLimit is enforceRateLimit in lib/pos/route-guards.ts.
func (k *Kit) EnforceRateLimit(ctx context.Context, key string, limit int) error {
	return k.RateLimit(ctx, key, limit, "Terlalu banyak percobaan — tunggu sebentar")
}

// RequireDefaultVenue is requireDefaultVenue in lib/pos/route-guards.ts.
func (k *Kit) RequireDefaultVenue(ctx context.Context) (company, branch string, err error) {
	v := k.Dir.DefaultVenue(ctx, k.DB)
	if Deref(v.CompanyID) == "" || Deref(v.BranchID) == "" {
		return "", "", httpx.BadRequest("Venue belum dikonfigurasi")
	}
	return *v.CompanyID, *v.BranchID, nil
}

// PromoContext is requirePromoContext's result.
type PromoContext struct {
	UserID    string
	Role      string
	CompanyID string
	BranchID  string
}

// VenueNotConfigured is the 400 of requirePromoContext.
const VenueNotConfigured = "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user"

// PromoContext mirrors requirePromoContext: the promo menu, then the venue
// from the user's business scope (importBusinessIds) with the CRM default
// venue filling the gaps (resolveTicketingVenue).
func (k *Kit) PromoContext(r *http.Request) (*PromoContext, error) {
	u, err := k.Auth.RequireMenuPrefix(r, iam.Promo...)
	if err != nil {
		return nil, err
	}
	sc, err := scope.Load(r.Context(), k.DB, u.ID)
	if err != nil {
		return nil, err
	}
	companyID, branchID := scope.ImportBusinessIDs(sc)
	company, branch := Deref(companyID), Deref(branchID)
	if company == "" || branch == "" {
		v := k.Dir.DefaultVenue(r.Context(), k.DB)
		if company == "" {
			company = Deref(v.CompanyID)
		}
		if branch == "" {
			branch = Deref(v.BranchID)
		}
	}
	if company == "" || branch == "" {
		return nil, httpx.BadRequest(VenueNotConfigured)
	}
	return &PromoContext{UserID: u.ID, Role: u.Role, CompanyID: company, BranchID: branch}, nil
}

/* ── handler wrappers ────────────────────────────────────────────────── */

// API is an apiHandler route: *httpx.Error renders as is, PostgreSQL
// constraint errors map to the shared 4xx, anything else is a logged 500
// "Terjadi kesalahan server".
func API(fn httpx.HandlerFunc) http.Handler { return httpx.Handle(fn) }

// Caught is a route with its own try/catch: *httpx.Error renders as is,
// anything else is logged and becomes a 500 with failMessage.
func (k *Kit) Caught(failMessage string, fn httpx.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			var e *httpx.Error
			if errors.As(err, &e) {
				httpx.WriteError(w, r, e)
				return
			}
			k.Log.ErrorContext(r.Context(), failMessage, "path", r.URL.Path, "error", err.Error())
			httpx.WriteError(w, r, httpx.Status(http.StatusInternalServerError, failMessage))
		}
	})
}

// Raw is a route whose catch answers 500 with the error's own message
// (getErrorMessage in the TS routes).
func (k *Kit) Raw(fn httpx.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			var e *httpx.Error
			if errors.As(err, &e) {
				httpx.WriteError(w, r, e)
				return
			}
			k.Log.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "error", err.Error())
			httpx.WriteError(w, r, httpx.Status(http.StatusInternalServerError, ErrorMessage(err)))
		}
	})
}

// ErrorMessage is `error.message`: a PostgreSQL error without the
// "ERROR: … (SQLSTATE …)" decoration node-postgres does not add.
func ErrorMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}

/* ── responses ───────────────────────────────────────────────────────── */

// OK writes {"success":true,"data":data} with status.
func OK(w http.ResponseWriter, status int, data any) error { return httpx.Data(w, status, data) }

// OKMessage writes {"success":true,"data":data,"message":msg}
// (successResponse(data, message)).
func OKMessage(w http.ResponseWriter, status int, data any, msg string) error {
	return httpx.DataMessage(w, status, data, msg)
}

// MessageData writes {"success":true,"message":msg,"data":data}, the key
// order of routes that put the message first.
func MessageData(w http.ResponseWriter, status int, msg string, data any) error {
	return httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    any    `json:"data"`
	}{true, msg, data})
}

/* ── request helpers ─────────────────────────────────────────────────── */

// BodyObject is the decoded body as an object, or an empty object when the
// body is missing, malformed or not an object (`.catch(() => ({}))`).
func BodyObject(r *http.Request) map[string]any {
	v, present := validate.ReadBody(r)
	if m, isMap := v.(map[string]any); present && isMap {
		return m
	}
	return map[string]any{}
}

// UUIDParam mirrors uuidParam in lib/wallet/route.ts.
func UUIDParam(r *http.Request, name string) (string, error) {
	id := r.PathValue(name)
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

// Origin mirrors appOrigin(request): the configured origin, else the
// forwarded or request host.
func (k *Kit) Origin(r *http.Request) string {
	origin := k.AppOrigin
	if origin == "" {
		scheme := "http"
		if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0]), "https") {
			scheme = "https"
		}
		host := r.Header.Get("x-forwarded-host")
		if host == "" {
			host = r.Host
		}
		origin = scheme + "://" + host
	}
	return strings.TrimRight(origin, "/")
}

// Deref is *s or "".
func Deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// NullIfEmpty is `value || null`.
func NullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
