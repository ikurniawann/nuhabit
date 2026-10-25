package dataroom

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/imageproc"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
)

// File bytes: every upload lives at private/dataroom/YYYY/MM/<24 hex>.<ext>
// and is served only behind the dashboard guard or a verified share
// session. Chunked uploads grow under private/dataroom/tmp first.

const storagePrefix = "dataroom"

// filePath is the absolute path of a stored file, false unless it stays
// inside private/dataroom/.
func (s *Service) filePath(rel string) (string, bool) {
	root, _ := s.store.PrivatePath(storagePrefix)
	abs, ok := s.store.PrivatePath(rel)
	return abs, ok && strings.HasPrefix(abs, root+string(filepath.Separator))
}

// newStoragePath is a fresh relative path for mime and name.
func (s *Service) newStoragePath(mime, name string) string {
	token := make([]byte, 12)
	_, _ = rand.Read(token)
	now := s.now().Local()
	return fmt.Sprintf("%s/%d/%02d/%s.%s", storagePrefix, now.Year(), int(now.Month()), hex.EncodeToString(token),
		domain.ExtensionForStorage(mime, name))
}

// indexText is the text the search index reads from a file, "" when the
// type or size is out of scope or extraction fails.
func (s *Service) indexText(ctx context.Context, data []byte, mime, name string) *string {
	if !domain.IsExtractable(mime) || len(data) > domain.MaxExtractBytes {
		return nil
	}
	var text string
	var err error
	switch {
	case mime == "application/pdf":
		text, err = extract.PDFText(data)
	case strings.HasSuffix(mime, "wordprocessingml.document"):
		text, err = extract.DOCXText(data)
	case strings.Contains(mime, "sheet") || mime == "application/vnd.ms-excel":
		text, err = extract.SpreadsheetText(data)
	default:
		text = strings.ToValidUTF8(string(data), "")
	}
	if err != nil {
		s.log.InfoContext(ctx, "[dataroom] ekstraksi teks dilewati", "name", name, "error", err)
		return nil
	}
	// Postgres text never holds NUL.
	text = extract.Clean(strings.ReplaceAll(strings.ToValidUTF8(text, ""), "\x00", ""))
	if text == "" {
		return nil
	}
	text = domain.JSSlice(text, extract.MaxChars*10)
	return &text
}

// Upload stores one file and creates its node; the file is removed when
// the insert fails.
func (s *Service) Upload(ctx context.Context, parentID *string, f *storage.File, userID, userName string) (*Node, error) {
	return s.uploadBytes(ctx, parentID, f.Name, f.Type, f.Data, userID, userName, nil)
}

func (s *Service) uploadBytes(ctx context.Context, parentID *string, name, claimed string, data []byte, userID, userName string, tags []string) (*Node, error) {
	mime := domain.ResolveMime(data, name, claimed)
	rel := s.newStoragePath(mime, name)
	if err := s.store.WritePrivate(rel, data); err != nil {
		return nil, err
	}
	node, err := s.insertFile(ctx, parentID, name, mime, int64(len(data)), rel, userID, userName, tags, s.indexText(ctx, data, mime, name))
	if err != nil {
		s.deleteFiles([]string{rel})
		return nil, err
	}
	return node, nil
}

func (s *Service) insertFile(ctx context.Context, parentID *string, name, mime string, size int64, rel, userID, userName string, tags []string, text *string) (*Node, error) {
	if tags == nil {
		tags = []string{}
	}
	node, err := queryNode(ctx, s.db, `WITH n AS (
	   INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path, created_by, created_by_name, tags, search_text)
	   VALUES ($1, 'file', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *) `+selectCTE,
		parentID, domain.SanitizeNodeName(name), mime, size, rel, nullUUID(userID), userName, domain.NormalizeTags(tags), text)
	if err == nil && node != nil {
		s.logActivity(ctx, activity{node: node, action: "upload", actorID: userID, actorName: userName, detail: map[string]any{"size": size}})
	}
	return node, err
}

// deleteFiles removes stored files (best effort).
func (s *Service) deleteFiles(rels []string) {
	for _, rel := range rels {
		if _, ok := s.filePath(rel); ok {
			s.store.DeletePrivate(rel)
		}
	}
}

// readStored reads a node's bytes from disk.
func (s *Service) readStored(rel *string) ([]byte, error) {
	if rel == nil {
		return nil, os.ErrNotExist
	}
	abs, ok := s.filePath(*rel)
	if !ok {
		return nil, os.ErrNotExist
	}
	return os.ReadFile(abs)
}

// quotaCheck refuses incoming bytes over the quota.
func (s *Service) quotaCheck(ctx context.Context, incoming int64) error {
	used, err := s.usedBytes(ctx)
	if err != nil {
		return err
	}
	if !domain.FitsQuota(float64(used), float64(incoming), s.ports.QuotaBytes) {
		return httpx.BadRequest("Kuota Dataroom penuh (" + domain.FormatBytes(float64(used)) + " dari " +
			domain.FormatBytes(s.ports.QuotaBytes) + "). Hapus file lain dulu.")
	}
	return nil
}

/* ── Versions ────────────────────────────────────────────────────────── */

// Version is one dataroom.node_versions row.
type Version struct {
	ID            string       `json:"id"`
	NodeID        string       `json:"node_id"`
	Version       int          `json:"version"`
	Name          string       `json:"name"`
	Mime          *string      `json:"mime"`
	SizeBytes     int64        `json:"size_bytes"`
	StoragePath   string       `json:"-"`
	CreatedBy     *string      `json:"created_by"`
	CreatedByName *string      `json:"created_by_name"`
	CreatedAt     httpx.JSTime `json:"created_at"`
}

const versionCols = `id::text, node_id::text, version, name, mime, size_bytes, storage_path, created_by::text, created_by_name, created_at`

func scanVersion(row pgx.CollectableRow) (Version, error) {
	var v Version
	var created time.Time
	err := row.Scan(&v.ID, &v.NodeID, &v.Version, &v.Name, &v.Mime, &v.SizeBytes, &v.StoragePath, &v.CreatedBy, &v.CreatedByName, &created)
	v.CreatedAt = httpx.JSTime(created)
	return v, err
}

// Versions lists a file's past versions, newest first.
func (s *Service) Versions(ctx context.Context, nodeID string) ([]Version, error) {
	rows, err := s.db.Query(ctx, `SELECT `+versionCols+` FROM dataroom.node_versions WHERE node_id = $1 ORDER BY version DESC`, nodeID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanVersion)
	if out == nil {
		out = []Version{}
	}
	return out, err
}

// VersionOf is one version row of the node, or nil.
func (s *Service) VersionOf(ctx context.Context, nodeID, versionID string) (*Version, error) {
	rows, err := s.db.Query(ctx, `SELECT `+versionCols+` FROM dataroom.node_versions WHERE id = $1 AND node_id = $2`, versionID, nodeID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanVersion)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// archiveCurrent copies the node's live file into a version row.
func (s *Service) archiveCurrent(ctx context.Context, node *Node) error {
	if node.StoragePath == nil {
		return httpx.NotFound("File tidak ditemukan")
	}
	_, err := s.db.Exec(ctx, `INSERT INTO dataroom.node_versions (node_id, version, name, mime, size_bytes, storage_path, created_by, created_by_name)
	 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, node.ID, node.Version, node.Name, node.Mime, node.SizeBytes, *node.StoragePath, node.CreatedBy, node.CreatedByName)
	return err
}

// replaceBytes makes rel the live file of node (one version up).
func (s *Service) replaceBytes(ctx context.Context, node *Node, name, mime string, size int64, rel string, text *string, a *Access, action string) (*Node, error) {
	if err := s.archiveCurrent(ctx, node); err != nil {
		return nil, err
	}
	updated, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET mime = $2, size_bytes = $3, storage_path = $4,
	   search_text = COALESCE($5, search_text), version = version + 1, updated_at = now(), name = $6 WHERE id = $1 RETURNING *) `+selectCTE,
		node.ID, mime, size, rel, text, name)
	if err != nil {
		return nil, err
	}
	s.logActivity(ctx, activity{node: updated, action: action, actorID: a.Actor.UserID, actorName: a.Actor.Name,
		detail: map[string]any{"version": updated.Version, "size": size}})
	return updated, nil
}

// NewVersion stores data as the file's next version; the current bytes
// become a version row. The node keeps its name.
func (s *Service) NewVersion(ctx context.Context, a *Access, node *Node, name, claimed string, data []byte) (*Node, error) {
	if node.Kind != "file" {
		return nil, httpx.BadRequest("Versi hanya untuk file")
	}
	if node.LockedByOther(a.Actor.UserID) {
		return nil, lockedErr(node)
	}
	if err := s.quotaCheck(ctx, int64(len(data))); err != nil {
		return nil, err
	}
	mime := domain.ResolveMime(data, name, claimed)
	rel := s.newStoragePath(mime, name)
	if err := s.store.WritePrivate(rel, data); err != nil {
		return nil, err
	}
	updated, err := s.replaceBytes(ctx, node, node.Name, mime, int64(len(data)), rel, s.indexText(ctx, data, mime, name), a, "new_version")
	if err != nil {
		s.deleteFiles([]string{rel})
	}
	return updated, err
}

// RestoreVersion makes a past version the live file; the current bytes
// are kept as a new version row, so nothing is lost.
func (s *Service) RestoreVersion(ctx context.Context, a *Access, node *Node, v *Version) (*Node, error) {
	if node.LockedByOther(a.Actor.UserID) {
		return nil, lockedErr(node)
	}
	data, err := s.readStored(&v.StoragePath)
	if err != nil {
		return nil, httpx.NotFound("Berkas versi tidak ditemukan di penyimpanan")
	}
	mime := ""
	if v.Mime != nil {
		mime = *v.Mime
	}
	rel := s.newStoragePath(mime, v.Name)
	if err := s.store.WritePrivate(rel, data); err != nil {
		return nil, err
	}
	updated, err := s.replaceBytes(ctx, node, node.Name, mime, v.SizeBytes, rel, s.indexText(ctx, data, mime, v.Name), a, "restore_version")
	if err != nil {
		s.deleteFiles([]string{rel})
		return nil, err
	}
	return updated, nil
}

/* ── Copy ────────────────────────────────────────────────────────────── */

// Copy duplicates a file (bytes included) or a folder subtree into the
// folder parentID (nil is root). A copy next to its source is named
// "Salinan <name>".
func (s *Service) Copy(ctx context.Context, a *Access, node *Node, parentID *string) (*Node, error) {
	name := node.Name
	if sameParent(parentID, node.ParentID) {
		name = "Salinan " + name
	}
	if node.Kind == "folder" {
		inside := false
		if parentID != nil {
			var err error
			if inside, err = s.isSameOrDescendant(ctx, *parentID, node.ID); err != nil {
				return nil, err
			}
		}
		if inside {
			return nil, httpx.BadRequest("Folder tidak bisa disalin ke dalam dirinya sendiri")
		}
		var total int64
		if err := s.db.QueryRow(ctx, `WITH RECURSIVE down AS (
		   SELECT id, kind, size_bytes FROM dataroom.nodes WHERE id = $1
		   UNION ALL SELECT n.id, n.kind, n.size_bytes FROM dataroom.nodes n JOIN down ON n.parent_id = down.id WHERE n.trashed_at IS NULL
		 ) SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM down WHERE kind = 'file'`, node.ID).Scan(&total); err != nil {
			return nil, err
		}
		if err := s.quotaCheck(ctx, total); err != nil {
			return nil, err
		}
		return s.copyFolder(ctx, a, node, parentID, name)
	}
	if err := s.quotaCheck(ctx, node.SizeBytes); err != nil {
		return nil, err
	}
	return s.copyFile(ctx, a, node, parentID, name)
}

func (s *Service) copyFile(ctx context.Context, a *Access, node *Node, parentID *string, name string) (*Node, error) {
	data, err := s.readStored(node.StoragePath)
	if err != nil {
		return nil, httpx.NotFound("Berkas sumber tidak ditemukan di penyimpanan")
	}
	mime := ""
	if node.Mime != nil {
		mime = *node.Mime
	}
	rel := s.newStoragePath(mime, name)
	if err := s.store.WritePrivate(rel, data); err != nil {
		return nil, err
	}
	copied, err := queryNode(ctx, s.db, `WITH n AS (
	   INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path, created_by, created_by_name, description, tags, search_text)
	   SELECT $2, 'file', $3, mime, size_bytes, $4, $5, $6, description, tags, search_text FROM dataroom.nodes WHERE id = $1 RETURNING *) `+selectCTE,
		node.ID, parentID, domain.SanitizeNodeName(name), rel, a.Actor.UserID, a.Actor.Name)
	if err != nil {
		s.deleteFiles([]string{rel})
		return nil, err
	}
	s.logActivity(ctx, activity{node: copied, action: "copy", actorID: a.Actor.UserID, actorName: a.Actor.Name, detail: map[string]any{"from": node.ID}})
	return copied, nil
}

func (s *Service) copyFolder(ctx context.Context, a *Access, node *Node, parentID *string, name string) (*Node, error) {
	folder, err := queryNode(ctx, s.db, `WITH n AS (
	   INSERT INTO dataroom.nodes (parent_id, kind, name, created_by, created_by_name, description, tags)
	   SELECT $2, 'folder', $3, $4, $5, description, tags FROM dataroom.nodes WHERE id = $1 RETURNING *) `+selectCTE,
		node.ID, parentID, domain.SanitizeNodeName(name), a.Actor.UserID, a.Actor.Name)
	if err != nil {
		return nil, err
	}
	s.logActivity(ctx, activity{node: folder, action: "copy", actorID: a.Actor.UserID, actorName: a.Actor.Name, detail: map[string]any{"from": node.ID}})
	children, err := s.Children(ctx, &node.ID)
	if err != nil {
		return nil, err
	}
	for i := range children {
		child := &children[i]
		if child.Kind == "folder" {
			_, err = s.copyFolder(ctx, a, child, &folder.ID, child.Name)
		} else {
			_, err = s.copyFile(ctx, a, child, &folder.ID, child.Name)
		}
		if err != nil {
			return nil, err
		}
	}
	return folder, nil
}

/* ── Chunked uploads ─────────────────────────────────────────────────── */

// UploadSession is one dataroom.upload_sessions row.
type UploadSession struct {
	ID            string       `json:"id"`
	ParentID      *string      `json:"parent_id"`
	ReplaceNodeID *string      `json:"replace_node_id"`
	Name          string       `json:"name"`
	ClaimedMime   *string      `json:"-"`
	SizeBytes     int64        `json:"size_bytes"`
	ReceivedBytes int64        `json:"received_bytes"`
	StoragePath   string       `json:"-"`
	CreatedBy     string       `json:"-"`
	CreatedByName *string      `json:"-"`
	ExpiresAt     httpx.JSTime `json:"expires_at"`
}

// UploadSessionTTL is how long a session may stay open; MaxChunkBytes is
// the body limit of one chunk request.
const (
	UploadSessionTTL = 24 * time.Hour
	MaxChunkBytes    = 8 << 20
)

const sessionColsUp = `id::text, parent_id::text, replace_node_id::text, name, claimed_mime, size_bytes, received_bytes, storage_path, created_by::text, created_by_name, expires_at`

func scanUpload(row pgx.CollectableRow) (UploadSession, error) {
	var u UploadSession
	var expires time.Time
	err := row.Scan(&u.ID, &u.ParentID, &u.ReplaceNodeID, &u.Name, &u.ClaimedMime, &u.SizeBytes, &u.ReceivedBytes, &u.StoragePath, &u.CreatedBy, &u.CreatedByName, &expires)
	u.ExpiresAt = httpx.JSTime(expires)
	return u, err
}

// StartUpload opens a session for a file of size bytes.
func (s *Service) StartUpload(ctx context.Context, a *Access, parentID, replaceNodeID *string, name, claimed string, size int64) (*UploadSession, error) {
	if float64(size) > s.ports.MaxChunkedBytes {
		return nil, httpx.BadRequest("Ukuran file melebihi batas " + domain.FormatBytes(s.ports.MaxChunkedBytes))
	}
	if err := s.quotaCheck(ctx, size); err != nil {
		return nil, err
	}
	token := make([]byte, 12)
	_, _ = rand.Read(token)
	rel := storagePrefix + "/tmp/" + hex.EncodeToString(token) + ".part"
	rows, err := s.db.Query(ctx, `INSERT INTO dataroom.upload_sessions (parent_id, replace_node_id, name, claimed_mime, size_bytes, storage_path, created_by, created_by_name, expires_at)
	 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING `+sessionColsUp,
		parentID, replaceNodeID, domain.SanitizeNodeName(name), orNull(domain.JSSlice(claimed, 150)), size, rel, a.Actor.UserID, a.Actor.Name, s.now().Add(UploadSessionTTL))
	if err != nil {
		return nil, err
	}
	u, err := pgx.CollectOneRow(rows, scanUpload)
	return &u, err
}

// UploadSessionOf is the caller's live session, or nil.
func (s *Service) UploadSessionOf(ctx context.Context, id, userID string) (*UploadSession, error) {
	rows, err := s.db.Query(ctx, `SELECT `+sessionColsUp+` FROM dataroom.upload_sessions WHERE id = $1 AND created_by = $2 AND expires_at > now()`, id, userID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanUpload)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// AppendChunk writes data at offset, which must equal the bytes received
// so far (the client resumes from GET). It returns the new total.
func (s *Service) AppendChunk(ctx context.Context, u *UploadSession, offset int64, data []byte) (int64, error) {
	if offset != u.ReceivedBytes {
		return u.ReceivedBytes, httpx.Coded(http.StatusConflict, "offset_mismatch", "Potongan tidak berurutan; lanjutkan dari "+fmt.Sprint(u.ReceivedBytes), map[string]any{"received_bytes": u.ReceivedBytes})
	}
	if u.ReceivedBytes+int64(len(data)) > u.SizeBytes {
		return u.ReceivedBytes, httpx.BadRequest("Potongan melebihi ukuran file yang didaftarkan")
	}
	abs, ok := s.filePath(u.StoragePath)
	if !ok {
		return 0, storage.ErrInvalidPath
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(abs, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	total := u.ReceivedBytes + int64(len(data))
	_, err = s.db.Exec(ctx, `UPDATE dataroom.upload_sessions SET received_bytes = $2 WHERE id = $1`, u.ID, total)
	return total, err
}

// CompleteUpload turns a fully received session into a node or a new
// version of replace_node_id, sniffing the MIME from the first bytes.
func (s *Service) CompleteUpload(ctx context.Context, a *Access, u *UploadSession) (*Node, error) {
	if u.ReceivedBytes != u.SizeBytes {
		return nil, httpx.BadRequest(fmt.Sprintf("Unggahan belum lengkap (%d dari %d byte)", u.ReceivedBytes, u.SizeBytes))
	}
	abs, ok := s.filePath(u.StoragePath)
	if !ok {
		return nil, storage.ErrInvalidPath
	}
	head, err := readHead(abs, 512)
	if err != nil {
		return nil, httpx.BadRequest("Berkas unggahan tidak ditemukan; mulai ulang")
	}
	claimed := ""
	if u.ClaimedMime != nil {
		claimed = *u.ClaimedMime
	}
	mime := domain.ResolveMime(head, u.Name, claimed)
	rel := s.newStoragePath(mime, u.Name)
	final, _ := s.store.PrivatePath(rel)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(abs, final); err != nil {
		return nil, err
	}
	var text *string
	if u.SizeBytes <= domain.MaxExtractBytes && domain.IsExtractable(mime) {
		if data, err := os.ReadFile(final); err == nil {
			text = s.indexText(ctx, data, mime, u.Name)
		}
	}
	var node *Node
	if u.ReplaceNodeID != nil {
		target, err := s.Node(ctx, *u.ReplaceNodeID)
		if err != nil {
			return nil, err
		}
		if target == nil || target.Kind != "file" || target.TrashedAt != nil {
			err = httpx.NotFound("File yang diganti tidak ditemukan")
		} else if target.LockedByOther(a.Actor.UserID) {
			err = lockedErr(target)
		} else {
			node, err = s.replaceBytes(ctx, target, target.Name, mime, u.SizeBytes, rel, text, a, "new_version")
		}
		if err != nil {
			s.deleteFiles([]string{rel})
			return nil, err
		}
	} else {
		node, err = s.insertFile(ctx, u.ParentID, u.Name, mime, u.SizeBytes, rel, a.Actor.UserID, a.Actor.Name, nil, text)
		if err != nil {
			s.deleteFiles([]string{rel})
			return nil, err
		}
	}
	_, _ = s.db.Exec(ctx, `DELETE FROM dataroom.upload_sessions WHERE id = $1`, u.ID)
	return node, nil
}

func readHead(abs string, n int) ([]byte, error) {
	f, err := os.Open(abs)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	k, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	return buf[:k], nil
}

// AbandonUpload drops a session and its partial file.
func (s *Service) AbandonUpload(ctx context.Context, u *UploadSession) error {
	s.deleteFiles([]string{u.StoragePath})
	_, err := s.db.Exec(ctx, `DELETE FROM dataroom.upload_sessions WHERE id = $1`, u.ID)
	return err
}

/* ── Watermark ───────────────────────────────────────────────────────── */

// watermark stamps images and PDF; a type it does not cover, or a failure,
// sends the original bytes. It returns the bytes and their MIME type.
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
