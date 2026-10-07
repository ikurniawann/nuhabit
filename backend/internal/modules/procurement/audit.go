package procurement

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// actorAudit starts an audit entry for user; a blank name is stored as NULL.
func actorAudit(user *auth.User) audit.Entry {
	return audit.Entry{ActorID: user.ID, ActorName: nonEmpty(&user.FullName)}
}

// recordAuditAfterCommit is the TS helper of the same name: a failure is
// logged and never fails the response.
func (s *Service) recordAuditAfterCommit(ctx context.Context, e audit.Entry) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return audit.Write(ctx, tx, e) })
	if err != nil {
		s.log.ErrorContext(ctx, "[audit] gagal mencatat", "action", e.Action, "entity_id", e.EntityID, "error", err)
	}
}
