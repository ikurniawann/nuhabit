package procurement

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// auditEntry is AuditEntry from frontend/src/lib/audit. audit.audit_log is
// the cross-cutting append-only trail every context writes; it belongs in
// platform once a second module needs it.
type auditEntry struct {
	ActorID, ActorName string
	Action, Entity     string
	EntityID           string
	EntityLabel        *string
	Before, After      any
	Reason             *string
	IP, UserAgent      *string
}

// recordAudit writes one audit row on q (inside the action's transaction
// when q is one).
func recordAudit(ctx context.Context, q database.Querier, e auditEntry) error {
	toJSON := func(v any) *string {
		if v == nil {
			return nil
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		s := string(raw)
		return &s
	}
	var reason *string
	if e.Reason != nil {
		if r := strings.TrimSpace(*e.Reason); r != "" {
			reason = &r
		}
	}
	var actorName *string
	if e.ActorName != "" {
		actorName = &e.ActorName
	}
	_, err := q.Exec(ctx, `INSERT INTO audit.audit_log
		(actor_id, actor_name, action, entity, entity_id, entity_label, before, after, reason, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
		e.ActorID, actorName, e.Action, e.Entity, e.EntityID, e.EntityLabel,
		toJSON(e.Before), toJSON(e.After), reason, e.IP, e.UserAgent)
	return err
}

// recordAuditAfterCommit is the TS helper of the same name: a failure is
// logged and never fails the response.
func (s *Service) recordAuditAfterCommit(ctx context.Context, e auditEntry) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return recordAudit(ctx, tx, e) })
	if err != nil {
		s.log.ErrorContext(ctx, "[audit] gagal mencatat", "action", e.Action, "entity_id", e.EntityID, "error", err)
	}
}

// withRequestMeta fills IP (first x-forwarded-for hop, else x-real-ip) and
// the user agent, as requestMeta does.
func withRequestMeta(e auditEntry, r *http.Request) auditEntry {
	ip := ""
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = strings.TrimSpace(strings.Split(fwd, ",")[0])
	}
	if ip == "" {
		ip = r.Header.Get("X-Real-Ip")
	}
	if ip != "" {
		e.IP = &ip
	}
	if ua, ok := r.Header["User-Agent"]; ok && len(ua) > 0 {
		e.UserAgent = &ua[0]
	}
	return e
}
