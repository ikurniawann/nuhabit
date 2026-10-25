package dataroom

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// formOverhead is room for the multipart framing and parent_id on top of
// the largest file a request may carry.
const formOverhead = 1 << 20

// readUpload reads the one-file multipart form of upload and uploadVersion.
func (h *handler) readUpload(r *http.Request) (*storage.Form, *storage.File, error) {
	maxFile := h.svc.ports.MaxFileBytes
	tooLarge := httpx.BadRequest("Ukuran file melebihi batas " + domain.FormatBytes(maxFile))
	form, err := storage.ReadForm(r, int64(maxFile)+formOverhead)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return nil, nil, tooLarge
	}
	if err != nil {
		// request.formData() throwing reaches apiHandler as a 500.
		return nil, nil, err
	}
	file := form.File("file")
	if file == nil {
		return nil, nil, httpx.BadRequest("File wajib diisi")
	}
	if float64(file.Size()) > maxFile {
		return nil, nil, tooLarge
	}
	return form, file, nil
}

// upload is POST /api/dataroom/upload (multipart: file, parent_id?, tags?):
// one file per request, refused over the per-file limit or the quota.
func (h *handler) upload(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return err
	}
	form, file, err := h.readUpload(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var parentID *string
	if v := form.Value("parent_id"); v != "" {
		parentID = &v
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	if err := h.parentFolder(r, a, parentID); err != nil {
		return err
	}
	if err := h.svc.quotaCheck(ctx, file.Size()); err != nil {
		return err
	}
	var tags []string
	if v := form.Value("tags"); v != "" {
		tags = strings.Split(v, ",")
	}
	node, err := h.svc.uploadBytes(ctx, parentID, file.Name, file.Type, file.Data, u.ID, u.FullName, tags)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

// uploadVersion is POST /api/dataroom/nodes/{id}/versions (multipart file).
func (h *handler) uploadVersion(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "update", iam.Dataroom...); err != nil {
		return err
	}
	_, file, err := h.readUpload(r)
	if err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelEditor, false)
	if err != nil {
		return err
	}
	node, err := h.svc.NewVersion(r.Context(), c.a, c.node, file.Name, file.Type, file.Data)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

func (h *handler) listVersions(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, true)
	if err != nil {
		return err
	}
	list, err := h.svc.Versions(r.Context(), c.node.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *handler) versionAt(r *http.Request, need Level) (*nodeCtx, *Version, error) {
	c, err := h.nodeAt(r, need, false)
	if err != nil {
		return nil, nil, err
	}
	vid, err := validate.PathUUID(r, "versionId")
	if err != nil {
		return nil, nil, httpx.NotFound("Versi tidak ditemukan")
	}
	v, err := h.svc.VersionOf(r.Context(), c.node.ID, vid)
	if err != nil {
		return nil, nil, err
	}
	if v == nil {
		return nil, nil, httpx.NotFound("Versi tidak ditemukan")
	}
	return c, v, nil
}

func (h *handler) downloadVersion(w http.ResponseWriter, r *http.Request) error {
	c, v, err := h.versionAt(r, LevelViewer)
	if err != nil {
		return err
	}
	h.svc.logActivity(r.Context(), activity{node: c.node, action: "download", actorID: c.u.ID, actorName: c.u.FullName,
		detail: map[string]any{"version": v.Version}, ip: clientIP(r.Header)})
	return h.serveStored(w, r, v.StoragePath, v.Name, strOr(v.Mime), false, "")
}

func (h *handler) restoreVersion(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "update", iam.Dataroom...); err != nil {
		return err
	}
	c, v, err := h.versionAt(r, LevelEditor)
	if err != nil {
		return err
	}
	node, err := h.svc.RestoreVersion(r.Context(), c.a, c.node, v)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

// download is GET /api/dataroom/nodes/{id}/download?inline=1.
func (h *handler) download(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, true)
	if err != nil {
		if errors.Is(err, errNodeNotFound) {
			return httpx.NotFound("File tidak ditemukan")
		}
		if errors.Is(err, errNoAccess) {
			return httpx.Forbidden("File ini tidak dibuka untuk departemen Anda")
		}
		return err
	}
	if c.node.Kind != "file" {
		return httpx.NotFound("File tidak ditemukan")
	}
	inline := r.URL.Query().Get("inline") == "1"
	action := "download"
	if inline {
		action = "view"
	}
	// Media players re-request ranges; log the first request only.
	if r.Header.Get("Range") == "" {
		h.svc.touchRecent(r.Context(), c.u.ID, c.node.ID)
		h.svc.logActivity(r.Context(), activity{node: c.node, action: action, actorID: c.u.ID, actorName: c.u.FullName, ip: clientIP(r.Header)})
	}
	return h.serveNode(w, r, c.node, inline, "")
}

// nodeText is GET /api/dataroom/nodes/{id}/text: the extracted text of an
// office document or PDF for the preview dialog (no LibreOffice in the
// container, so no PDF conversion).
func (h *handler) nodeText(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, true)
	if err != nil {
		return err
	}
	if c.node.Kind != "file" {
		return httpx.NotFound("File tidak ditemukan")
	}
	mime := strOr(c.node.Mime)
	if !domain.IsExtractable(mime) && !domain.IsOfficeDocument(mime) {
		return httpx.BadRequest("Tidak ada teks untuk jenis file ini")
	}
	if c.node.SizeBytes > domain.MaxExtractBytes {
		return httpx.BadRequest("File terlalu besar untuk pratinjau teks (maks " + domain.FormatBytes(domain.MaxExtractBytes) + ")")
	}
	data, err := h.svc.readStored(c.node.StoragePath)
	if err != nil {
		return httpx.NotFound("File tidak ditemukan")
	}
	text := h.svc.indexText(r.Context(), data, mime, c.node.Name)
	if text == nil {
		return httpx.BadRequest("Tidak ada teks yang bisa dibaca dari file ini")
	}
	out, truncated := *text, false
	if validate.UTF16Len(out) > extract.MaxChars*5 {
		out, truncated = domain.JSSlice(out, extract.MaxChars*5), true
	}
	return httpx.Data(w, http.StatusOK, struct {
		Text      string `json:"text"`
		Truncated bool   `json:"truncated"`
		Converted bool   `json:"converted"`
	}{out, truncated, false})
}

/* ── Chunked uploads ─────────────────────────────────────────────────── */

type startUploadInput struct {
	Name, Mime              string
	Size                    int64
	ParentID, ReplaceNodeID *string
}

func startUploadSchema(f *validate.Form) startUploadInput {
	in := startUploadInput{
		Name:          strOr(f.Str("name", required, validate.StrOpts{Trim: true, Min: 1, Max: 255})),
		Mime:          strOr(f.Str("mime", nullish, validate.StrOpts{Max: 150})),
		ParentID:      f.UUID("parent_id", nullish),
		ReplaceNodeID: f.UUID("replace_node_id", nullish),
	}
	if n := f.Num("size", required, validate.NumOpts{Min: validate.Bound(1)}); n != nil {
		in.Size = int64(*n)
	}
	return in
}

// startUpload is POST /api/dataroom/uploads.
func (h *handler) startUpload(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return err
	}
	in, err := parse(r, startUploadSchema)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	if in.ReplaceNodeID != nil {
		target, err := h.svc.Node(r.Context(), *in.ReplaceNodeID)
		if err != nil {
			return err
		}
		if target == nil || target.Kind != "file" || target.TrashedAt != nil {
			return httpx.NotFound("File yang diganti tidak ditemukan")
		}
		if a.Level(target) < LevelEditor {
			return httpx.Forbidden(needMessage(LevelEditor))
		}
		if target.LockedByOther(u.ID) {
			return lockedErr(target)
		}
		in.ParentID = target.ParentID
	} else if err := h.parentFolder(r, a, in.ParentID); err != nil {
		return err
	}
	session, err := h.svc.StartUpload(r.Context(), a, in.ParentID, in.ReplaceNodeID, in.Name, in.Mime, in.Size)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, struct {
		*UploadSession
		ChunkBytes int `json:"chunk_bytes"`
	}{session, MaxChunkBytes})
}

func (h *handler) uploadSession(r *http.Request) (*UploadSession, *nodeCtx, error) {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return nil, nil, err
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return nil, nil, httpx.NotFound("Sesi unggah tidak ditemukan")
	}
	session, err := h.svc.UploadSessionOf(r.Context(), id, u.ID)
	if err != nil {
		return nil, nil, err
	}
	if session == nil {
		return nil, nil, httpx.NotFound("Sesi unggah tidak ditemukan")
	}
	return session, &nodeCtx{u: u}, nil
}

func (h *handler) uploadStatus(w http.ResponseWriter, r *http.Request) error {
	session, _, err := h.uploadSession(r)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, session)
}

// uploadChunk is PUT /api/dataroom/uploads/{id}/chunk with the raw bytes
// and X-Upload-Offset.
func (h *handler) uploadChunk(w http.ResponseWriter, r *http.Request) error {
	session, _, err := h.uploadSession(r)
	if err != nil {
		return err
	}
	offset := headerInt(r, "X-Upload-Offset")
	if offset < 0 {
		return httpx.BadRequest("Header X-Upload-Offset wajib diisi")
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxChunkBytes))
	if err != nil {
		return httpx.BadRequest("Potongan melebihi " + domain.FormatBytes(MaxChunkBytes))
	}
	if len(data) == 0 {
		return httpx.BadRequest("Potongan kosong")
	}
	total, err := h.svc.AppendChunk(r.Context(), session, offset, data)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		ReceivedBytes int64 `json:"received_bytes"`
		SizeBytes     int64 `json:"size_bytes"`
	}{total, session.SizeBytes})
}

func (h *handler) completeUpload(w http.ResponseWriter, r *http.Request) error {
	session, c, err := h.uploadSession(r)
	if err != nil {
		return err
	}
	a, err := h.access(r, c.u)
	if err != nil {
		return err
	}
	node, err := h.svc.CompleteUpload(r.Context(), a, session)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

func (h *handler) abandonUpload(w http.ResponseWriter, r *http.Request) error {
	session, _, err := h.uploadSession(r)
	if err != nil {
		return err
	}
	if err := h.svc.AbandonUpload(r.Context(), session); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Deleted string `json:"deleted"`
	}{session.ID})
}

/* ── Serving bytes ───────────────────────────────────────────────────── */

// shareFile is GET /api/share/{token}/files/{nodeId}?download=1: a file of
// the shared subtree for a verified recipient, logged, watermarked when the
// link asks for it, and never downloaded when the link forbids it.
func (h *handler) shareFile(w http.ResponseWriter, r *http.Request) error {
	sc, err := h.resolveShare(r, r.PathValue("token"))
	if err != nil {
		return err
	}
	if !sc.steps.Verified() {
		return httpx.Unauthorized("Verifikasi dulu")
	}
	ctx := r.Context()
	node, err := h.svc.Node(ctx, r.PathValue("nodeId"))
	if err != nil {
		return err
	}
	if node != nil && node.TrashedAt == nil {
		within, err := h.svc.isSameOrDescendant(ctx, node.ID, sc.share.NodeID)
		if err != nil {
			return err
		}
		if !within {
			node = nil
		}
	} else {
		node = nil
	}
	if node == nil || node.Kind != "file" {
		return httpx.NotFound("File tidak ditemukan")
	}
	download := r.URL.Query().Get("download") == "1"
	mime := strOr(node.Mime)
	if !sc.share.AllowDownload && (download || !domain.IsPreviewable(mime) || storage.MustForceAttachment(mime)) {
		return httpx.Forbidden("Link ini hanya untuk melihat; unduhan dimatikan oleh pemilik")
	}
	action := "view"
	if download {
		action = "download"
	}
	email := sessionEmail(sc.session)
	if r.Header.Get("Range") == "" {
		h.svc.logAccess(ctx, accessEvent{shareID: sc.share.ID, action: action, nodeID: &node.ID, fileName: &node.Name,
			email: email, ip: clientIP(r.Header), userAgent: r.Header.Get("User-Agent")})
	}
	text := ""
	if sc.share.Watermark {
		label := ""
		if email != nil {
			label = *email
		}
		if label == "" {
			by := "NüHabit"
			if sc.share.CreatedByName != nil {
				by = *sc.share.CreatedByName
			}
			label = "Dibagikan oleh " + by
		}
		text = pdfgen.WatermarkText(label, h.svc.ports.Brand, h.now())
	}
	return h.serveNode(w, r, node, !download, text)
}

// serveNode serves a node's live bytes.
func (h *handler) serveNode(w http.ResponseWriter, r *http.Request, node *Node, inline bool, watermark string) error {
	if node.StoragePath == nil {
		return httpx.NotFound("File tidak ditemukan")
	}
	return h.serveStored(w, r, *node.StoragePath, node.Name, strOr(node.Mime), inline, watermark)
}

// serveStored streams a stored file: inline only for types that preview
// and are not forced to download; text types go out as text/plain. With a
// watermark the file is read whole and stamped, otherwise it streams with
// Range support (video and audio).
func (h *handler) serveStored(w http.ResponseWriter, r *http.Request, rel, name, mime string, inline bool, watermark string) error {
	notFound := httpx.NotFound("File tidak ditemukan")
	abs, ok := h.svc.filePath(rel)
	if !ok {
		return notFound
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	inline = inline && domain.IsPreviewable(mime) && !storage.MustForceAttachment(mime)
	if inline && domain.IsTextPreview(mime) {
		mime = "text/plain; charset=utf-8"
	}
	disposition := storage.ContentDisposition(name, inline)
	const cache = "private, no-store"

	if watermark != "" {
		raw, err := os.ReadFile(abs)
		if err != nil {
			return notFound
		}
		out, outMime := h.svc.watermark(r.Context(), raw, mime, watermark)
		storage.WritePrivateFile(w, out, outMime, cache, disposition)
		return nil
	}

	f, err := os.Open(abs)
	if err != nil {
		return notFound
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return notFound
	}
	hd := w.Header()
	hd.Set("Content-Type", mime)
	hd.Set("Content-Disposition", disposition)
	hd.Set("Cache-Control", cache)
	hd.Set("X-Content-Type-Options", "nosniff")
	if inline && domain.IsMediaPreview(strOr(&mime)) {
		// ServeContent answers Range requests for players.
		http.ServeContent(w, r, "", st.ModTime(), f)
		return nil
	}
	hd.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
	return nil
}
