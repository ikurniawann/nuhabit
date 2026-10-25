package dataroom

import (
	"context"
	"errors"
	"io"
	"strings"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Filer is the port other modules use to file a document into the Data
// Room (payroll payslips today; HRIS employee documents and investor
// updates can take the same interface in their Ports).
type Filer struct{ svc *Service }

// NewFiler wraps the service for internal/app.
func NewFiler(svc *Service) *Filer { return &Filer{svc: svc} }

// FileDocument stores the bytes of r as name under folderPath (folders
// separated by "/", created when missing and matched case-insensitively).
// The first folder it has to create is restricted, so only ownerUserID,
// explicit grants and super admin see the chain. The owner also gets an
// owner grant on that folder. It returns the new node's id.
func (f *Filer) FileDocument(ctx context.Context, ownerUserID, folderPath, name, contentType string, r io.Reader, tags []string) (string, error) {
	s := f.svc
	segments := domain.FolderPathSegments(folderPath)
	if len(segments) == 0 {
		return "", errors.New("dataroom: folderPath kosong")
	}
	data, err := io.ReadAll(io.LimitReader(r, int64(s.ports.MaxChunkedBytes)+1))
	if err != nil {
		return "", err
	}
	if float64(len(data)) > s.ports.MaxChunkedBytes {
		return "", httpx.BadRequest("Ukuran file melebihi batas " + domain.FormatBytes(s.ports.MaxChunkedBytes))
	}
	if err := s.quotaCheck(ctx, int64(len(data))); err != nil {
		return "", err
	}
	ownerName := s.ownerName(ctx, ownerUserID)
	var parent *string
	created := false
	for _, seg := range segments {
		folder, err := s.childFolder(ctx, parent, seg)
		if err != nil {
			return "", err
		}
		if folder == nil {
			restricted := !created
			if folder, err = s.insertFolder(ctx, parent, seg, ownerUserID, ownerName, restricted); err != nil {
				return "", err
			}
			if restricted && ownerUserID != "" {
				if _, err := s.db.Exec(ctx, `INSERT INTO dataroom.permissions (node_id, subject_type, subject_id, role, created_by)
				 VALUES ($1, 'user', $2, 'owner', $3::uuid) ON CONFLICT DO NOTHING`, folder.ID, ownerUserID, ownerUserID); err != nil {
					return "", err
				}
			}
			created = true
		}
		parent = &folder.ID
	}
	node, err := s.uploadBytes(ctx, parent, name, contentType, data, ownerUserID, ownerName, tags)
	if err != nil {
		return "", err
	}
	return node.ID, nil
}

// childFolder is the live folder named name under parent (case-insensitive),
// or nil.
func (s *Service) childFolder(ctx context.Context, parent *string, name string) (*Node, error) {
	if parent == nil {
		return queryNode(ctx, s.db, fromNodes+`WHERE n.parent_id IS NULL AND n.kind = 'folder' AND n.trashed_at IS NULL AND lower(n.name) = lower($1)
		 ORDER BY n.created_at LIMIT 1`, name)
	}
	return queryNode(ctx, s.db, fromNodes+`WHERE n.parent_id = $1 AND n.kind = 'folder' AND n.trashed_at IS NULL AND lower(n.name) = lower($2)
	 ORDER BY n.created_at LIMIT 1`, *parent, name)
}

// ownerName is the account's name through the People port, "Sistem" when
// unknown.
func (s *Service) ownerName(ctx context.Context, userID string) string {
	if userID != "" {
		if list, err := s.ports.People.ByIDs(ctx, []string{userID}); err == nil && len(list) == 1 && strings.TrimSpace(list[0].FullName) != "" {
			return list[0].FullName
		}
	}
	return "Sistem"
}
