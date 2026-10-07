package dataroom

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
)

// formOverhead is room for the multipart framing and parent_id on top of
// the largest file a request may carry.
const formOverhead = 1 << 20

// upload is POST /api/dataroom/upload (multipart: file, parent_id?): one
// file per request, refused over the per-file limit or the quota.
func (h *handler) upload(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return err
	}
	maxFile, quota := h.svc.ports.MaxFileBytes, h.svc.ports.QuotaBytes
	tooLarge := httpx.BadRequest("Ukuran file melebihi batas " + domain.FormatBytes(maxFile))
	form, err := storage.ReadForm(r, int64(maxFile)+formOverhead)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return tooLarge
	}
	if err != nil {
		// request.formData() throwing reaches apiHandler as a 500.
		return err
	}
	file := form.File("file")
	if file == nil {
		return httpx.BadRequest("File wajib diisi")
	}
	ctx := r.Context()
	var parentID *string
	if v := form.Value("parent_id"); v != "" {
		parentID = &v
		parent, err := h.svc.Node(ctx, v)
		if err != nil {
			return err
		}
		if parent == nil || parent.Kind != "folder" {
			return httpx.NotFound("Folder tujuan tidak ditemukan")
		}
		a, err := h.svc.access(ctx, u)
		if err != nil {
			return err
		}
		if !a.AllowsFolder(parentID) {
			return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
		}
	}
	if float64(file.Size()) > maxFile {
		return tooLarge
	}
	used, err := h.svc.usedBytes(ctx)
	if err != nil {
		return err
	}
	if !domain.FitsQuota(float64(used), float64(file.Size()), quota) {
		return httpx.BadRequest("Kuota Dataroom penuh (" + domain.FormatBytes(float64(used)) + " dari " +
			domain.FormatBytes(quota) + "). Hapus file lain dulu.")
	}
	node, err := h.svc.Upload(ctx, parentID, file, u.ID, u.FullName)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

// download is GET /api/dataroom/nodes/{id}/download?inline=1.
func (h *handler) download(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	ctx := r.Context()
	node, err := h.svc.Node(ctx, r.PathValue("id"))
	if err != nil {
		return err
	}
	if node == nil || node.Kind != "file" {
		return httpx.NotFound("File tidak ditemukan")
	}
	a, err := h.svc.access(ctx, u)
	if err != nil {
		return err
	}
	if !a.AllowsNode(node) {
		return httpx.Forbidden("File ini tidak dibuka untuk departemen Anda")
	}
	return h.serveNode(w, r, node, r.URL.Query().Get("inline") == "1", "")
}

// deleteNode is DELETE /api/dataroom/nodes/{id}: a folder goes with
// everything inside it.
func (h *handler) deleteNode(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "delete", iam.Dataroom...)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	node, err := h.svc.Node(ctx, id)
	if err != nil {
		return err
	}
	if node == nil {
		return httpx.NotFound("Item tidak ditemukan")
	}
	a, err := h.svc.access(ctx, u)
	if err != nil {
		return err
	}
	if !a.AllowsNode(node) {
		return httpx.Forbidden("Item ini tidak dibuka untuk departemen Anda")
	}
	removed, err := h.svc.DeleteNode(ctx, id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Deleted      string `json:"deleted"`
		FilesRemoved int    `json:"files_removed"`
	}{id, removed})
}

// shareFile is GET /api/share/{token}/files/{nodeId}?download=1: a file of
// the shared subtree for a verified recipient, logged, and watermarked
// when the link asks for it.
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
	if node != nil {
		within, err := h.svc.isSameOrDescendant(ctx, node.ID, sc.share.NodeID)
		if err != nil {
			return err
		}
		if !within {
			node = nil
		}
	}
	if node == nil || node.Kind != "file" {
		return httpx.NotFound("File tidak ditemukan")
	}
	download := r.URL.Query().Get("download") == "1"
	action := "view"
	if download {
		action = "download"
	}
	email := sessionEmail(sc.session)
	h.svc.logAccess(ctx, accessEvent{shareID: sc.share.ID, action: action, nodeID: &node.ID, fileName: &node.Name,
		email: email, ip: clientIP(r.Header), userAgent: r.Header.Get("User-Agent")})
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

// serveNode is serveNodeFile: inline only for images and PDF that are not
// forced to download; with a watermark the file is read whole and stamped,
// otherwise streamed.
func (h *handler) serveNode(w http.ResponseWriter, r *http.Request, node *Node, inline bool, watermark string) error {
	notFound := httpx.NotFound("File tidak ditemukan")
	if node.StoragePath == nil {
		return notFound
	}
	abs, ok := h.svc.filePath(*node.StoragePath)
	if !ok {
		return notFound
	}
	mime := "application/octet-stream"
	if node.Mime != nil && *node.Mime != "" {
		mime = *node.Mime
	}
	inline = inline && domain.IsPreviewable(mime) && !storage.MustForceAttachment(mime)
	disposition := storage.ContentDisposition(node.Name, inline)
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
	hd.Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
	return nil
}
