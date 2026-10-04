package posops

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Handler serves every route of the module.
type Handler struct {
	svc  *Service
	auth *auth.Service
}

// Routes lists every route of the module.
func (h *Handler) Routes() []module.Route {
	var out []module.Route
	for _, group := range [][]module.Route{
		h.shiftRoutes(),
		h.tableRoutes(),
		h.reservationRoutes(),
		h.productRoutes(),
		h.customerRoutes(),
		h.dashboardRoutes(),
		h.reportRoutes(),
		h.stockRoutes(),
		h.settingsRoutes(),
	} {
		out = append(out, group...)
	}
	return out
}

/* ── Responses ───────────────────────────────────────────────────────── */

// Fail is a response the TS route builds itself, e.g.
// NextResponse.json({ success: false, error, active_shift }, { status: 409 }).
type Fail struct {
	Status int
	Body   *Obj
}

func (f *Fail) Error() string { return f.Body.Str("error") }

// fail builds {success:false,error:msg} plus extra key, value pairs.
func fail(status int, msg string, extra ...any) *Fail {
	body := NewObj("success", false, "error", msg)
	for i := 0; i+1 < len(extra); i += 2 {
		body.Set(extra[i].(string), extra[i+1])
	}
	return &Fail{Status: status, Body: body}
}

func writeObj(w http.ResponseWriter, status int, body *Obj) error {
	return httpx.JSON(w, status, body)
}

// okData writes {success:true,data} with status 200.
func okData(w http.ResponseWriter, data any) error {
	return writeObj(w, http.StatusOK, NewObj("success", true, "data", data))
}

// caught wraps a route whose own try/catch turns unexpected errors into
// 500 {success:false,error:message(err)}. *Fail and *httpx.Error keep their
// status and body.
func caught(message func(error) string, fn httpx.HandlerFunc) http.Handler {
	return rendered(fn, func(err error) (int, string) { return http.StatusInternalServerError, message(err) })
}

// rendered is caught with a status chosen per error.
func rendered(fn httpx.HandlerFunc, render func(error) (int, string)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := fn(w, r)
		if err == nil {
			return
		}
		var f *Fail
		if errors.As(err, &f) {
			_ = writeObj(w, f.Status, f.Body)
			return
		}
		var he *httpx.Error
		if errors.As(err, &he) {
			httpx.WriteError(w, r, err)
			return
		}
		status, msg := render(err)
		_ = writeObj(w, status, NewObj("success", false, "error", msg))
	})
}

// apiRoute is apiHandler: *Fail renders as built, everything else goes
// through httpx.Handle (pg constraint 4xx, 500 "Terjadi kesalahan server").
func apiRoute(fn httpx.HandlerFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		err := fn(w, r)
		var f *Fail
		if errors.As(err, &f) {
			return writeObj(w, f.Status, f.Body)
		}
		return err
	})
}

// pgMessage is error.message of a node-postgres error (or any Error).
func pgMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	var syn *jsError
	if errors.As(err, &syn) {
		return syn.msg
	}
	return err.Error()
}

// fixed returns a catch message that ignores the error: the TS route
// rethrows QueryBuilder errors, which are plain objects, so
// `error instanceof Error ? error.message : fallback` lands on fallback.
// Body parse failures are real Errors and keep their message.
func fixed(fallback string) func(error) string {
	return func(err error) string {
		var syn *jsError
		if errors.As(err, &syn) {
			return syn.msg
		}
		return fallback
	}
}

/* ── Guards ──────────────────────────────────────────────────────────── */

// posUser mirrors getPosSession: the user with a pos.* grant, or nil when
// the session is missing or lacks the grant (the route answers 401 itself).
func (h *Handler) posUser(r *http.Request) (*auth.User, error) {
	u, err := h.auth.RequireMenuPrefix(r, iam.Pos...)
	var he *httpx.Error
	if errors.As(err, &he) && (he.Status == http.StatusUnauthorized || he.Status == http.StatusForbidden) {
		return nil, nil
	}
	return u, err
}

// requirePos returns the user, or the route's own 401 body.
func (h *Handler) requirePos(r *http.Request, msg string) (*auth.User, error) {
	u, err := h.posUser(r)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, fail(http.StatusUnauthorized, msg)
	}
	return u, nil
}

/* ── Request bodies ──────────────────────────────────────────────────── */

// jsError is a JS Error instance a TS route throws and its catch renders
// with error.message: the SyntaxError of `await request.json()`, or the
// TypeError of reading a property of a null body.
type jsError struct{ msg string }

func (e *jsError) Error() string { return e.msg }

// jsonBody mirrors `await request.json()` without a catch: a missing or
// malformed body is a SyntaxError the route's catch renders.
func jsonBody(r *http.Request) (any, error) {
	body, ok := validate.ReadBody(r)
	if !ok {
		return nil, &jsError{msg: "Unexpected end of JSON input"}
	}
	return body, nil
}

// objectBody is `(await request.json()) as Record<string, unknown>` whose
// first property read is key: a null body throws the TypeError.
func objectBody(r *http.Request, key string) (any, error) {
	body, err := jsonBody(r)
	if err == nil && body == nil {
		return nil, &jsError{msg: "Cannot read properties of null (reading '" + key + "')"}
	}
	return body, err
}

// jsonBodyOr mirrors `await request.json().catch(() => fallback)`.
func jsonBodyOr(r *http.Request, fallback any) any {
	body, ok := validate.ReadBody(r)
	if !ok {
		return fallback
	}
	return body
}

// emptyObject is the `({})` fallback body.
func emptyObject() any { return map[string]any{} }

// field reads a body key with JS undefined for a missing key.
func field(body any, key string) any { return domain.Field(body, key) }
