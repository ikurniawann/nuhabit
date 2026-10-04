package procurement

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf16"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/ocr"
	pscope "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// Port of frontend/src/app/api/purchasing/{receipts/[...path],receipt-scan,
// import/suppliers,export/suppliers}/route.ts.
func (h *Handler) fileRoutes(add addRoute) {
	add("GET /api/purchasing/receipts/{path...}", h.receiptFile)
	add("POST /api/purchasing/receipt-scan", h.receiptScan)
	add("POST /api/purchasing/import/suppliers", h.importSuppliers)
	add("GET /api/purchasing/export/suppliers", h.exportSuppliers)
}

const (
	receiptsFolder   = "purchasing-receipts"
	receiptsPrefix   = "/api/purchasing/receipts/"
	receiptNotFound  = "File tidak ditemukan"
	receiptTooLarge  = "File terlalu besar — maksimal 10 MB"
	receiptMissing   = "Pilih file nota dulu"
	receiptBadFormat = "Format tidak didukung — gunakan foto (JPG/PNG) atau PDF"
)

// receiptExt is ALLOWED_EXT: a receipt is a photo or a PDF.
var receiptExt = regexp.MustCompile(`(?i)\.(jpe?g|png|webp|pdf)$`)

// receiptFile serves the vendor receipt archive (private storage); unlike
// /api/files these finance documents need a session.
func (h *Handler) receiptFile(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	// The segments as Next hands them over: still percent-encoded, so an
	// encoded "..%2F" is decoded and rejected here.
	segments := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), receiptsPrefix), "/")
	for i, s := range segments {
		decoded, err := storage.DecodeURIComponent(s)
		if err != nil {
			return err
		}
		if strings.Contains(decoded, "..") || strings.HasPrefix(decoded, ".") || strings.Contains(decoded, `\`) {
			return notFound(receiptNotFound)
		}
		segments[i] = decoded
	}
	data, mime, err := h.files.ReadPrivate(receiptsFolder + "/" + strings.Join(segments, "/"))
	if err != nil {
		return notFound(receiptNotFound)
	}
	storage.WritePrivateFile(w, data, mime, "private, max-age=3600", "inline")
	return nil
}

// receiptScan archives a vendor receipt under purchasing-receipts/YYYY/MM,
// then maps its text (OCR for photos and scans) to the payment form. The
// file stays archived when extraction fails; the user fills the form in.
func (h *Handler) receiptScan(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return badRequest(receiptTooLarge)
	}
	var file *storage.File
	if err == nil {
		file = form.File("file")
	}
	if file == nil || file.Size() == 0 {
		return badRequest(receiptMissing)
	}
	if file.Size() > extract.MaxAttachmentBytes {
		return badRequest(receiptTooLarge)
	}
	name := file.Name
	if name == "" {
		name = "nota"
	}
	if units := utf16.Encode([]rune(name)); len(units) > 150 {
		name = string(utf16.Decode(units[:150]))
	}
	if !receiptExt.MatchString(name) {
		return badRequest(receiptBadFormat)
	}

	now := h.svc.now().In(h.svc.loc)
	saved, err := h.files.SavePrivateDocument(file.Data, fmt.Sprintf("%s/%d/%02d", receiptsFolder, now.Year(), int(now.Month())))
	if err != nil {
		return badRequest(err.Error())
	}

	var fields domain.ReceiptFields
	if text, err := extract.Attachment(r.Context(), file.Data, name, ocr.New()); err != nil {
		h.svc.log.Warn("[purchasing:receipt-scan] ekstraksi gagal", "error", err)
	} else {
		fields = domain.ParseReceiptText(text.Text)
	}
	return writeOK(w, http.StatusOK, map[string]any{"receipt_path": saved, "receipt_name": name, "fields": fields})
}

func (h *Handler) importSuppliers(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	companyID, branchID := pscope.ImportBusinessIDs(scope)
	rows, err := readUploadedSheet(r, supplierHeader)
	if err != nil {
		return err
	}
	summary, err := h.svc.ImportSuppliers(r.Context(), rows, user.ID, companyID, branchID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, summary)
}

func (h *Handler) exportSuppliers(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	book, err := h.svc.ExportSuppliers(r.Context(), scope)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", xlsx.ContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="suppliers-`+h.svc.now().UTC().Format("2006-01-02")+`.xlsx"`)
	_, err = w.Write(book)
	return err
}

// readUploadedSheet is readUploadedSheet in lib/purchasing/import-lookups.ts:
// the `file` part (CSV or XLSX) as rows keyed by normalized header. A body
// that is not multipart fails like the unguarded request.formData().
func readUploadedSheet(r *http.Request, normalize func(string) string) ([]xlsx.ImportRow, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return nil, err
	}
	file := form.File("file")
	if file == nil {
		return nil, badRequest("File not found")
	}
	matrix, err := xlsx.SpreadsheetMatrix(file.Data, file.Name)
	if err != nil {
		return nil, err
	}
	if len(matrix) < 2 {
		return nil, badRequest("File must include a header row and at least one data row")
	}
	return xlsx.MatrixToRows(matrix, normalize), nil
}
