package master

import (
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// auditParams is paramsSchema of GET /api/audit after parsing.
type auditParams struct {
	actorID, entity, action, entityID, search, dateFrom, dateTo string
	page, limit                                                 int
}

// errBadFilter is a ZodError from paramsSchema.parse.
var errBadFilter = errors.New("filter tidak valid")

// parseAuditParams mirrors the route: drop "" and "all" values (the last
// remaining value of a key wins, like Object.fromEntries), then paramsSchema.
func parseAuditParams(q url.Values) (auditParams, error) {
	get := func(key string) (string, bool) {
		vals := q[key]
		for i := len(vals) - 1; i >= 0; i-- {
			if vals[i] != "" && vals[i] != "all" {
				return vals[i], true
			}
		}
		return "", false
	}
	p := auditParams{page: 1, limit: 30}
	text := func(key string, max int, dst *string) bool {
		v, ok := get(key)
		if ok && validate.UTF16Len(v) > max {
			return false
		}
		*dst = v
		return true
	}
	ok := true
	if v, sent := get("actor_id"); sent {
		ok = ok && validate.IsUUID(v)
		p.actorID = v
	}
	ok = text("entity", 60, &p.entity) && ok
	ok = text("action", 60, &p.action) && ok
	ok = text("entity_id", 100, &p.entityID) && ok
	ok = text("search", 100, &p.search) && ok
	for key, dst := range map[string]*string{"date_from": &p.dateFrom, "date_to": &p.dateTo} {
		if v, sent := get(key); sent {
			ok = ok && isoDate.MatchString(v)
			*dst = v
		}
	}
	coerce := func(key string, max float64, dst *int) {
		v, sent := get(key)
		if !sent {
			return
		}
		n := kit.NumberFromString(v) // z.coerce.number()
		if math.IsNaN(n) || n != math.Trunc(n) || n < 1 || n > max {
			ok = false
			return
		}
		*dst = int(n)
	}
	coerce("page", float64(1<<53-1), &p.page)
	coerce("limit", 100, &p.limit)
	if !ok {
		return p, errBadFilter
	}
	return p, nil
}

type auditMeta struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"totalPages"`
}

type auditBody struct {
	Success bool       `json:"success"`
	Data    []*kit.Row `json:"data"`
	Actors  []*kit.Row `json:"actors"`
	Meta    auditMeta  `json:"meta"`
}

// failBody is the route's own error body ({success:false, message}).
type failBody struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// audit is GET /api/audit: the audit trail, newest first. The TS route does
// not use apiHandler: a bad filter is 400 "Filter tidak valid" and any other
// failure 500 "Gagal memuat jejak audit", both under "message".
func (h handler) audit(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.SettingsAudit...); err != nil {
		var appErr *httpx.Error
		if errors.As(err, &appErr) {
			return err
		}
		return h.auditFailed(w, r, err)
	}
	p, err := parseAuditParams(r.URL.Query())
	if err != nil {
		return httpx.JSON(w, http.StatusBadRequest, failBody{false, "Filter tidak valid"})
	}
	body, err := h.auditPage(r, p)
	if err != nil {
		return h.auditFailed(w, r, err)
	}
	return httpx.JSON(w, http.StatusOK, body)
}

func (h handler) auditFailed(w http.ResponseWriter, r *http.Request, err error) error {
	slog.ErrorContext(r.Context(), "GET /api/audit", "error", err)
	return httpx.JSON(w, http.StatusInternalServerError, failBody{false, "Gagal memuat jejak audit"})
}

func (h handler) auditPage(r *http.Request, p auditParams) (auditBody, error) {
	var values []any
	add := func(v any) string {
		values = append(values, v)
		return "$" + strconv.Itoa(len(values))
	}
	var where []string
	if p.actorID != "" {
		where = append(where, "a.actor_id = "+add(p.actorID))
	}
	if p.entity != "" {
		where = append(where, "a.entity = "+add(p.entity))
	}
	if p.action != "" {
		where = append(where, "a.action = "+add(p.action))
	}
	if p.entityID != "" {
		where = append(where, "a.entity_id = "+add(p.entityID))
	}
	if term := validate.JSTrim(p.search); term != "" {
		ph := add("%" + term + "%")
		where = append(where, "(a.entity_label ILIKE "+ph+" OR a.reason ILIKE "+ph+" OR a.actor_name ILIKE "+ph+")")
	}
	// Date range in Asia/Jakarta, the session time zone.
	if p.dateFrom != "" {
		where = append(where, "a.created_at >= "+add(p.dateFrom)+"::date")
	}
	if p.dateTo != "" {
		where = append(where, "a.created_at < ("+add(p.dateTo)+"::date + 1)")
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	ctx := r.Context()
	var total int64
	if err := h.db.QueryRow(ctx, `SELECT COUNT(*) FROM audit.audit_log a `+whereSQL, values...).Scan(&total); err != nil {
		return auditBody{}, err
	}
	limit := add(p.limit)
	offset := add((p.page - 1) * p.limit)
	rows, err := kit.Query(ctx, h.db, `SELECT a.id, a.created_at::text AS created_at, a.actor_id,
              COALESCE(a.actor_name, u.full_name) AS actor_name,
              a.action, a.entity, a.entity_id, a.entity_label, a.before, a.after, a.reason, a.ip
         FROM audit.audit_log a
         LEFT JOIN configuration.users u ON u.id = a.actor_id
         `+whereSQL+`
        ORDER BY a.created_at DESC, a.id
        LIMIT `+limit+` OFFSET `+offset, values...)
	if err != nil {
		return auditBody{}, err
	}
	actors, err := kit.Query(ctx, h.db, `SELECT DISTINCT ON (actor_id) actor_id, actor_name
         FROM audit.audit_log WHERE actor_id IS NOT NULL
        ORDER BY actor_id, created_at DESC
        LIMIT 200`)
	if err != nil {
		return auditBody{}, err
	}
	pages := int64(math.Ceil(float64(total) / float64(p.limit)))
	return auditBody{true, rows, actors, auditMeta{p.page, p.limit, total, pages}}, nil
}
