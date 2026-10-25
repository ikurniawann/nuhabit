package dataroom

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
)

// Housekeeping is the hourly job: purge trash roots older than
// TrashRetentionDays and drop expired upload sessions with their partial
// files.
func (s *Service) Housekeeping(ctx context.Context, now time.Time) error {
	cutoff := now.Add(-time.Duration(domain.TrashRetentionDays) * 24 * time.Hour)
	roots, err := queryNodes(ctx, s.db, fromNodes+`WHERE n.trashed_root AND n.trashed_at < $1 ORDER BY n.trashed_at LIMIT 500`, cutoff)
	if err != nil {
		return err
	}
	for i := range roots {
		if _, err := s.PurgeNode(ctx, &roots[i], "", "Sistem"); err != nil {
			return err
		}
	}
	rows, err := s.db.Query(ctx, `DELETE FROM dataroom.upload_sessions WHERE expires_at < $1 RETURNING storage_path`, now)
	if err != nil {
		return err
	}
	paths, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	s.deleteFiles(paths)
	if len(roots) > 0 || len(paths) > 0 {
		s.log.InfoContext(ctx, "[dataroom] housekeeping", "purged", len(roots), "expired_uploads", len(paths))
	}
	return nil
}
