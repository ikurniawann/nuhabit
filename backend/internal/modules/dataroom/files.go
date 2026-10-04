package dataroom

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/imageproc"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
)

// File bytes (lib/dataroom/storage.ts): every upload lives at
// private/dataroom/YYYY/MM/<24 hex>.<ext> and is served only behind the
// dashboard guard or a verified share session.

const storagePrefix = "dataroom"

// filePath is absFor: the absolute path of a stored file, false unless it
// stays inside private/dataroom/ (TS only kept it inside private/).
func (s *Service) filePath(rel string) (string, bool) {
	root, _ := s.store.PrivatePath(storagePrefix)
	abs, ok := s.store.PrivatePath(rel)
	return abs, ok && strings.HasPrefix(abs, root+string(filepath.Separator))
}

// Upload is saveDataroomFile then createFileNode; the file is removed when
// the insert fails.
func (s *Service) Upload(ctx context.Context, parentID *string, f *storage.File, userID, userName string) (*Node, error) {
	mime := domain.ResolveMime(f.Data, f.Name, f.Type)
	token := make([]byte, 12)
	_, _ = rand.Read(token)
	now := s.now().Local()
	rel := fmt.Sprintf("%s/%d/%02d/%s.%s", storagePrefix, now.Year(), int(now.Month()), hex.EncodeToString(token),
		domain.ExtensionForStorage(mime, f.Name))
	if err := s.store.WritePrivate(rel, f.Data); err != nil {
		return nil, err
	}
	node, err := queryNode(ctx, s.db, `INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path, created_by, created_by_name)
	 VALUES ($1, 'file', $2, $3, $4, $5, $6, $7) RETURNING `+nodeCols,
		parentID, domain.SanitizeNodeName(f.Name), mime, f.Size(), rel, userID, userName)
	if err != nil {
		s.deleteFiles([]string{rel})
		return nil, err
	}
	return node, nil
}

// DeleteNode is deleteNodeCascade then deleteDataroomFiles: the node goes
// with everything below it (parent_id cascades), then their stored files.
// It returns how many files were removed.
func (s *Service) DeleteNode(ctx context.Context, id string) (int, error) {
	rows, err := s.db.Query(ctx, `WITH RECURSIVE down AS (
	   SELECT id, kind, storage_path FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id, n.kind, n.storage_path FROM dataroom.nodes n JOIN down ON n.parent_id = down.id
	 ), gone AS (DELETE FROM dataroom.nodes WHERE id = $1)
	 SELECT storage_path FROM down WHERE kind = 'file' AND storage_path <> ''`, id)
	if err != nil {
		return 0, err
	}
	paths, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	s.deleteFiles(paths)
	return len(paths), nil
}

// deleteFiles is deleteDataroomFiles (best effort).
func (s *Service) deleteFiles(rels []string) {
	for _, rel := range rels {
		if _, ok := s.filePath(rel); ok {
			s.store.DeletePrivate(rel)
		}
	}
}

// watermark is applyWatermark with serveNodeFile's fallback: a type it does
// not cover, or a failure, sends the original bytes. It returns the bytes
// and their MIME type (a WebP comes out as JPEG, see imageproc).
func (s *Service) watermark(ctx context.Context, data []byte, mime, text string) ([]byte, string) {
	if !domain.IsWatermarkable(mime) {
		return data, mime
	}
	var out []byte
	var err error
	outMime := mime
	if mime == "application/pdf" {
		out, err = pdfgen.Watermark(ctx, data, text)
	} else {
		out, outMime, err = imageproc.Watermark(data, mime, text)
	}
	if err != nil {
		s.log.WarnContext(ctx, "[dataroom] watermark gagal, kirim asli", "error", err)
		return data, mime
	}
	return out, outMime
}
