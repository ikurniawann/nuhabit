package kit

import (
	"context"
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// RequestMeta is requestMeta(request): client ip (first x-forwarded-for hop
// or x-real-ip) and user agent.
type RequestMeta struct {
	IP        *string
	UserAgent *string
}

// MetaOf reads the audit metadata from r.
func MetaOf(r *http.Request) RequestMeta {
	var m RequestMeta
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if ip := strings.TrimSpace(strings.Split(fwd, ",")[0]); ip != "" {
			m.IP = &ip
		}
	}
	if m.IP == nil {
		if ip := r.Header.Get("X-Real-Ip"); ip != "" {
			m.IP = &ip
		}
	}
	if _, ok := r.Header["User-Agent"]; ok {
		ua := r.Header.Get("User-Agent")
		m.UserAgent = &ua
	}
	return m
}

// Audit is one audit.audit_log row (frontend/src/lib/audit).
type Audit struct {
	ActorID     string
	ActorName   *string
	Action      string
	Entity      string
	EntityID    *string
	EntityLabel *string
	Before      any // nil = NULL
	After       any // nil = NULL
	Reason      *string
	Meta        RequestMeta
}

// RecordAudit is recordAudit: one append-only row written on q, so inside a
// transaction it commits or rolls back with the action.
//
// audit.audit_log is shared infrastructure written by several contexts; it
// belongs in a platform package once one exists.
func RecordAudit(ctx context.Context, q database.Querier, a Audit) error {
	before, err := jsonOrNil(a.Before)
	if err != nil {
		return err
	}
	after, err := jsonOrNil(a.After)
	if err != nil {
		return err
	}
	var reason *string
	if a.Reason != nil {
		if t := strings.TrimSpace(*a.Reason); t != "" {
			reason = &t
		}
	}
	var actor *string
	if a.ActorID != "" {
		actor = &a.ActorID
	}
	_, err = q.Exec(ctx, `INSERT INTO audit.audit_log
		(actor_id, actor_name, action, entity, entity_id, entity_label, before, after, reason, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
		actor, a.ActorName, a.Action, a.Entity, a.EntityID, a.EntityLabel, before, after, reason, a.Meta.IP, a.Meta.UserAgent)
	return err
}

func jsonOrNil(v any) (*string, error) {
	if v == nil {
		return nil, nil
	}
	b, err := marshal(v)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}
