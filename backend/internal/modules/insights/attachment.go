package insights

import (
	"errors"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// POST /api/ai/assistant/attachment (app/api/ai/assistant/attachment/route.ts):
// one upload in, its extracted text out. The file is never stored, so HR and
// finance documents dropped into the chat leave nothing on disk.

const (
	fileNotFound = "File tidak ditemukan"
	fileTooLarge = "Ukuran file melebihi 10 MB"
	// attachmentDeadline is the route's maxDuration: OCR of a dense scan
	// can take up to its own 120 s timeout, past the server's WriteTimeout.
	attachmentDeadline = 180 * time.Second
)

type attachmentData struct {
	Name      string         `json:"name"`
	Size      int64          `json:"size"`
	Method    extract.Method `json:"method"`
	Truncated bool           `json:"truncated"`
	Chars     int            `json:"chars"`
	Text      string         `json:"text"`
}

func (s *Service) assistantAttachment(w http.ResponseWriter, r *http.Request) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(attachmentDeadline))
	if s.sessionUser(w, r, "Gagal membaca lampiran") == nil {
		return
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		writeError(w, http.StatusBadRequest, fileTooLarge)
		return
	}
	var file *storage.File
	if err == nil {
		file = form.File("file")
	}
	switch {
	case file == nil:
		writeError(w, http.StatusBadRequest, fileNotFound)
		return
	case file.Size() == 0:
		writeError(w, http.StatusBadRequest, "File kosong")
		return
	case file.Size() > extract.MaxAttachmentBytes:
		writeError(w, http.StatusBadRequest, fileTooLarge)
		return
	case !extract.IsSupportedAttachment(file.Name):
		// The extension picks the extractor; the browser's MIME is easy to fake.
		writeError(w, http.StatusBadRequest, "Format tidak didukung. Pakai PDF, DOCX, gambar, XLSX, atau CSV.")
		return
	}

	res, err := extract.Attachment(r.Context(), file.Data, file.Name, s.ocr)
	if err != nil {
		// The message goes back as is: "OCR timeout" tells the user more than a generic failure.
		s.log.WarnContext(r.Context(), "[do:attachment] gagal", "error", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = httpx.JSON(w, http.StatusOK, map[string]attachmentData{"data": {
		Name: file.Name, Size: file.Size(), Method: res.Method, Truncated: res.Truncated,
		Chars: domain.Len(res.Text), Text: res.Text,
	}})
}
