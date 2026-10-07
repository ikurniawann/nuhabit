package hris

import (
	"context"

	"nuhabit/backend/internal/modules/hris/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Company announcements (lib/hris/announcements-repo). Cover uploads stay in
// TS: they write the Next server's private storage.

// AnnouncementRepo is the announcements storage.
type AnnouncementRepo interface {
	ListAnnouncements(ctx context.Context, status *string) ([]*Row, error)
	InsertAnnouncement(ctx context.Context, in announcementInput, provider, videoID *string, createdBy *string) (*Row, error)
	AnnouncementExists(ctx context.Context, id string) (bool, error)
	UpdateAnnouncement(ctx context.Context, id string, in announcementInput, provider, videoID *string) (*Row, error)
	ReplaceAnnouncementDepartments(ctx context.Context, id string, in announcementInput, clear bool) error
	DeleteAnnouncement(ctx context.Context, id string) error
	AnnouncementDetail(ctx context.Context, id string) (*Row, error)
	AnnouncementVisible(ctx context.Context, id string, employeeID *string) (bool, error)
	AnnouncementFeed(ctx context.Context, employeeID string) ([]*Row, error)
	MarkAnnouncementRead(ctx context.Context, id, employeeID string) error
}

// announcementInput is announcementUpsertSchema (defaults applied).
type announcementInput struct {
	Title, BodyHTML, Status, TargetScope string
	CoverImageURL, VideoURL              *string
	Tags, DepartmentIDs                  []string
	IsPinned                             bool
	PublishAt, ExpiresAt                 *string
}

// canManageAnnouncements is ANNOUNCEMENT_MANAGE_ROLES.
func canManageAnnouncements(role string) bool {
	return role == "super_admin" || role == "admin" || role == "hrd"
}

// prepare checks the target and parses the optional YouTube/Vimeo URL.
func (in announcementInput) prepare() (provider, id *string, err error) {
	if in.TargetScope == "department" && len(in.DepartmentIDs) == 0 {
		return nil, nil, httpx.BadRequest("Pilih minimal satu departemen atau ubah target ke global")
	}
	if in.VideoURL == nil || *in.VideoURL == "" {
		return nil, nil, nil
	}
	p, v, ok := domain.ParseVideoURL(*in.VideoURL)
	if !ok {
		return nil, nil, httpx.BadRequest("URL video harus YouTube atau Vimeo yang valid")
	}
	return &p, &v, nil
}

func (s *Service) Announcements(ctx context.Context, status *string) ([]*Row, error) {
	return s.repo.ListAnnouncements(ctx, status)
}

func (s *Service) CreateAnnouncement(ctx context.Context, in announcementInput, createdBy *string) (*Row, error) {
	provider, videoID, err := in.prepare()
	if err != nil {
		return nil, err
	}
	var row *Row
	err = s.repo.InTx(ctx, func(r Repository) error {
		var err error
		if row, err = r.InsertAnnouncement(ctx, in, provider, videoID, createdBy); err != nil {
			return err
		}
		return r.ReplaceAnnouncementDepartments(ctx, row.Str("id"), in, false)
	})
	return row, err
}

func (s *Service) UpdateAnnouncement(ctx context.Context, id string, in announcementInput) (*Row, error) {
	exists, err := s.repo.AnnouncementExists(ctx, id)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, httpx.NotFound("Pengumuman tidak ditemukan")
	}
	provider, videoID, err := in.prepare()
	if err != nil {
		return nil, err
	}
	var row *Row
	err = s.repo.InTx(ctx, func(r Repository) error {
		var err error
		if row, err = r.UpdateAnnouncement(ctx, id, in, provider, videoID); err != nil {
			return err
		}
		return r.ReplaceAnnouncementDepartments(ctx, id, in, true)
	})
	return row, err
}

func (s *Service) DeleteAnnouncement(ctx context.Context, id string) error {
	return s.repo.DeleteAnnouncement(ctx, id)
}

// Announcement is getAnnouncement: managers see any, employees only a
// published one targeting them (404 otherwise).
func (s *Service) Announcement(ctx context.Context, id string, canManage bool, employeeID *string) (*Row, error) {
	row, err := s.repo.AnnouncementDetail(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound("Pengumuman tidak ditemukan")
	}
	if !canManage {
		visible, err := s.repo.AnnouncementVisible(ctx, id, employeeID)
		if err != nil {
			return nil, err
		}
		if !visible {
			return nil, httpx.NotFound("Pengumuman tidak ditemukan")
		}
	}
	return row, nil
}

func (s *Service) AnnouncementFeed(ctx context.Context, employeeID string) ([]*Row, int, error) {
	rows, err := s.repo.AnnouncementFeed(ctx, employeeID)
	unread := 0
	for _, r := range rows {
		if r.Get("is_read") == false {
			unread++
		}
	}
	return rows, unread, err
}

func (s *Service) MarkAnnouncementRead(ctx context.Context, id, employeeID string) error {
	return s.repo.MarkAnnouncementRead(ctx, id, employeeID)
}

/* ── SQL ─────────────────────────────────────────────────────────────── */

const announcementAggregates = `creator.full_name AS created_by_name,
  COALESCE(
    (SELECT array_agg(ad.department_id) FROM hris.announcement_departments ad
     WHERE ad.announcement_id = a.id), '{}'
  ) AS department_ids`

func (s *store) ListAnnouncements(ctx context.Context, status *string) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT a.*, `+announcementAggregates+`,
		(SELECT count(*) FROM hris.announcement_reads r WHERE r.announcement_id = a.id) AS read_count
		FROM hris.announcements a
		LEFT JOIN hris.employees creator ON creator.id = a.created_by
		WHERE ($1::text IS NULL OR a.status = $1)
		ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC`, status)
}

func (s *store) InsertAnnouncement(ctx context.Context, in announcementInput, provider, videoID, createdBy *string) (*Row, error) {
	return queryRow(ctx, s.db, `INSERT INTO hris.announcements
		(title, body_html, cover_image_url, video_provider, video_id, tags,
		 status, is_pinned, target_scope, publish_at, expires_at, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING *`,
		in.Title, in.BodyHTML, in.CoverImageURL, provider, videoID, in.Tags,
		in.Status, in.IsPinned, in.TargetScope, in.PublishAt, in.ExpiresAt, createdBy)
}

func (s *store) AnnouncementExists(ctx context.Context, id string) (bool, error) {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM hris.announcements WHERE id = $1)`, id).Scan(&ok)
	return ok, err
}

func (s *store) UpdateAnnouncement(ctx context.Context, id string, in announcementInput, provider, videoID *string) (*Row, error) {
	return queryRow(ctx, s.db, `UPDATE hris.announcements SET
		title = $2, body_html = $3, cover_image_url = $4,
		video_provider = $5, video_id = $6, tags = $7, status = $8,
		is_pinned = $9, target_scope = $10, publish_at = $11,
		expires_at = $12, updated_at = now()
		WHERE id = $1
		RETURNING *`,
		id, in.Title, in.BodyHTML, in.CoverImageURL, provider, videoID, in.Tags,
		in.Status, in.IsPinned, in.TargetScope, in.PublishAt, in.ExpiresAt)
}

// ReplaceAnnouncementDepartments writes the department targets (clear first
// on update).
func (s *store) ReplaceAnnouncementDepartments(ctx context.Context, id string, in announcementInput, clear bool) error {
	if clear {
		if _, err := s.db.Exec(ctx, `DELETE FROM hris.announcement_departments WHERE announcement_id = $1`, id); err != nil {
			return err
		}
	}
	if in.TargetScope != "department" || len(in.DepartmentIDs) == 0 {
		return nil
	}
	_, err := s.db.Exec(ctx, `INSERT INTO hris.announcement_departments (announcement_id, department_id)
		SELECT $1, unnest($2::uuid[])`, id, in.DepartmentIDs)
	return err
}

func (s *store) DeleteAnnouncement(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM hris.announcements WHERE id = $1`, id)
	return err
}

func (s *store) AnnouncementDetail(ctx context.Context, id string) (*Row, error) {
	return queryRow(ctx, s.db, `SELECT a.*, `+announcementAggregates+`
		FROM hris.announcements a
		LEFT JOIN hris.employees creator ON creator.id = a.created_by
		WHERE a.id = $1`, id)
}

func (s *store) AnnouncementVisible(ctx context.Context, id string, employeeID *string) (bool, error) {
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1
		FROM hris.announcements a
		WHERE a.id = $1
		  AND a.status = 'published'
		  AND (a.publish_at IS NULL OR a.publish_at <= now())
		  AND (a.expires_at IS NULL OR a.expires_at > now())
		  AND (
		    a.target_scope = 'global'
		    OR EXISTS (
		      SELECT 1 FROM hris.announcement_departments ad
		      JOIN hris.employees e ON e.id = $2
		      WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
		    )
		  ))`, id, employeeID).Scan(&ok)
	return ok, err
}

func (s *store) AnnouncementFeed(ctx context.Context, employeeID string) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT a.id, a.title, a.cover_image_url, a.video_provider, a.tags,
		a.is_pinned, a.publish_at, a.created_at,
		(r.employee_id IS NOT NULL) AS is_read
		FROM hris.announcements a
		JOIN hris.employees e ON e.id = $1
		LEFT JOIN hris.announcement_reads r ON r.announcement_id = a.id AND r.employee_id = $1
		WHERE `+visibleTo+`
		ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
		LIMIT 100`, employeeID)
}

func (s *store) MarkAnnouncementRead(ctx context.Context, id, employeeID string) error {
	_, err := s.db.Exec(ctx, `INSERT INTO hris.announcement_reads (announcement_id, employee_id)
		SELECT a.id, $2
		FROM hris.announcements a
		JOIN hris.employees e ON e.id = $2
		WHERE a.id = $1
		  AND a.status = 'published'
		  AND (
		    a.target_scope = 'global'
		    OR EXISTS (
		      SELECT 1 FROM hris.announcement_departments ad
		      WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
		    )
		  )
		ON CONFLICT (announcement_id, employee_id) DO NOTHING`, id, employeeID)
	return err
}
