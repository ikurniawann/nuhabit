// Package audit writes audit.audit_log, the append-only trail every context
// writes (frontend/src/lib/audit recordAudit and requestMeta).
package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Entry is one audit.audit_log row (AuditEntry).
type Entry struct {
	ActorID     string // "" = NULL
	ActorName   *string
	Action      string
	Entity      string
	EntityID    *string
	EntityLabel *string
	Before      any // nil = NULL
	After       any // nil = NULL
	Reason      *string
	IP          *string
	UserAgent   *string
}

// Write is recordAudit: one row on q, so inside a transaction it commits or
// rolls back with the action. The reason is trimmed; blank becomes NULL.
func Write(ctx context.Context, q database.Querier, e Entry) error {
	before, err := jsonText(e.Before)
	if err != nil {
		return err
	}
	after, err := jsonText(e.After)
	if err != nil {
		return err
	}
	var actor, reason *string
	if e.ActorID != "" {
		actor = &e.ActorID
	}
	if e.Reason != nil {
		if r := strings.TrimSpace(*e.Reason); r != "" {
			reason = &r
		}
	}
	_, err = q.Exec(ctx, `INSERT INTO audit.audit_log
		(actor_id, actor_name, action, entity, entity_id, entity_label, before, after, reason, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
		actor, e.ActorName, e.Action, e.Entity, e.EntityID, e.EntityLabel, before, after, reason, e.IP, e.UserAgent)
	return err
}

// jsonText is JSON.stringify (no HTML escaping), nil for nil.
func jsonText(v any) (*string, error) {
	if v == nil {
		return nil, nil
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	s := strings.TrimSuffix(buf.String(), "\n")
	return &s, nil
}

// WithRequest fills IP and UserAgent as requestMeta does: the first
// x-forwarded-for hop, else x-real-ip, and the user agent; nil when absent.
func (e Entry) WithRequest(r *http.Request) Entry {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if v := strings.TrimSpace(strings.Split(fwd, ",")[0]); v != "" {
			e.IP = &v
		}
	}
	if e.IP == nil {
		if v := r.Header.Get("X-Real-Ip"); v != "" {
			e.IP = &v
		}
	}
	if ua, ok := r.Header["User-Agent"]; ok && len(ua) > 0 {
		e.UserAgent = &ua[0]
	}
	return e
}
