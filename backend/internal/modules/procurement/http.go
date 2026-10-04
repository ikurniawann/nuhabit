package procurement

import (
	"errors"
	"net/http"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Routes lists every ported /api/purchasing route of this context.
func (h *Handler) Routes() []module.Route {
	var routes []module.Route
	add := func(pattern string, fn httpx.HandlerFunc) {
		routes = append(routes, module.Route{Pattern: pattern, Handler: httpx.Handle(fn)})
	}
	h.prRoutes(add)
	h.poRoutes(add)
	h.receivingRoutes(add)
	h.returnRoutes(add)
	h.masterRoutes(add)
	h.payableRoutes(add)
	h.reportRoutes(add)
	return routes
}

type addRoute func(pattern string, fn httpx.HandlerFunc)

/* ── Envelopes ───────────────────────────────────────────────────────── */

// dataOnly is NextResponse.json({ data }).
type dataOnly struct {
	Data any `json:"data"`
}

// okData is NextResponse.json({ success: true, data }).
type okData struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

// okDataMessage is NextResponse.json({ success: true, data, message }).
type okDataMessage struct {
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Message string `json:"message"`
}

// okMessage is NextResponse.json({ success: true, message }).
type okMessage struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func writeData(w http.ResponseWriter, status int, data any) error {
	return httpx.JSON(w, status, dataOnly{Data: data})
}

func writeOK(w http.ResponseWriter, status int, data any) error {
	return httpx.JSON(w, status, okData{Success: true, Data: data})
}

func writeOKMessage(w http.ResponseWriter, status int, data any, msg string) error {
	return httpx.JSON(w, status, okDataMessage{Success: true, Data: data, Message: msg})
}

/* ── Request helpers ─────────────────────────────────────────────────── */

// errMalformedBody is `await request.json()` throwing a SyntaxError: the TS
// routes (validateBody included) let it reach apiHandler, which answers 500.
var errMalformedBody = errors.New("request body is not valid JSON")

// readBody mirrors `await request.json()`.
func readBody(r *http.Request) (any, error) {
	body, present := validate.ReadBody(r)
	if !present {
		return nil, errMalformedBody
	}
	return body, nil
}

// bodyForm is validateBody's first half: the JSON body as a validate.Form.
func bodyForm(r *http.Request) (*validate.Form, error) {
	body, err := readBody(r)
	if err != nil {
		return nil, err
	}
	return validate.New(body, true), nil
}

// queryInt is parseInt(sp.get(key) || def).
func queryInt(r *http.Request, key string, def int) (int, bool) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def, true
	}
	return domain.JSParseInt(v)
}

// queryPtr is sp.get(key) as a nullable string ("" stays "").
func queryPtr(r *http.Request, key string) *string {
	q := r.URL.Query()
	if !q.Has(key) {
		return nil
	}
	v := q.Get(key)
	return &v
}

// firstIssueError is parseBodyOrThrow: 400 with the first issue's message
// and every issue under details.
func firstIssueError(f *validate.Form, fallback string) error {
	if f.Valid() {
		return nil
	}
	msg := f.Issues()[0].Message
	if msg == "" {
		msg = fallback
	}
	return httpx.BadRequest(msg, f.Issues())
}
