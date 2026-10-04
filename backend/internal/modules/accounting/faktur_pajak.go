package accounting

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/storage"
)

// /api/finance/invoices/{id}/faktur-pajak (EPIC-025): one tax invoice
// attachment per B2B invoice, kept in private storage under
// invoice-faktur-pajak/<deal id>. A re-upload replaces the old file.
// Finance uploads and deletes; sales may only view.

const (
	fakturMaxBytes = 10 * 1024 * 1024
	noFakturPajak  = "Invoice ini belum punya lampiran faktur pajak"
)

// FakturPajakInvoice is the invoice row the attachment routes read.
type FakturPajakInvoice struct {
	ID             string
	DealID         string
	InvoiceNumber  string
	FakturPajakURL *string
}

// fakturPajakInvoice is loadInvoice: the live invoice behind assertInvoiceAccess.
func (s *Service) fakturPajakInvoice(ctx context.Context, id string, u FinanceUser) (*FakturPajakInvoice, error) {
	inv, err := s.ports.Sales.FakturPajakInvoice(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	dealID := ""
	if inv != nil {
		dealID = inv.DealID
	}
	if err := s.assertInvoiceAccess(ctx, inv != nil, dealID, u); err != nil {
		return nil, err
	}
	return inv, nil
}

// financeViewer is requireFinanceUser(INVOICE_VIEWER_ROLES): an accounting or
// a sales-funnel menu grant.
func (h *Handler) financeViewer(fn financeFunc) http.Handler {
	return h.financeFor(slices.Concat(iam.Accounting, iam.SalesFunnel), fn)
}

type successMessage struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func (h *Handler) uploadFakturPajak(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	inv, err := h.svc.fakturPajakInvoice(r.Context(), r.PathValue("id"), u)
	if err != nil {
		return err
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	switch {
	case errors.Is(err, storage.ErrBodyTooLarge):
		return badRequest("Ukuran dokumen maksimal 10 MB")
	case err != nil:
		return badRequest("Form data tidak valid")
	}
	file := form.File("file")
	if file == nil {
		return badRequest("File tidak ditemukan")
	}
	if file.Size() > fakturMaxBytes {
		return badRequest("Ukuran dokumen maksimal 10 MB")
	}
	path, err := h.files.SavePrivateDocument(file.Data, "invoice-faktur-pajak/"+inv.DealID)
	if err != nil {
		return badRequest(err.Error())
	}
	if err := h.svc.ports.Sales.SetFakturPajak(r.Context(), h.svc.db, inv.ID, &path); err != nil {
		return err
	}
	if inv.FakturPajakURL != nil && *inv.FakturPajakURL != "" {
		h.files.DeletePrivate(*inv.FakturPajakURL)
	}
	return httpx.JSON(w, http.StatusOK, successMessage{true, "Faktur pajak " + inv.InvoiceNumber + " tersimpan"})
}

func (h *Handler) downloadFakturPajak(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	inv, err := h.svc.fakturPajakInvoice(r.Context(), r.PathValue("id"), u)
	if err != nil {
		return err
	}
	if inv.FakturPajakURL == nil || *inv.FakturPajakURL == "" {
		return httpx.NotFound(noFakturPajak)
	}
	data, mime, err := h.files.ReadPrivate(*inv.FakturPajakURL)
	if err != nil {
		return httpx.NotFound("File tidak ditemukan")
	}
	storage.WritePrivateFile(w, data, mime, "private, max-age=3600",
		`inline; filename="faktur-pajak-`+fakturFileName(inv.InvoiceNumber)+`"`)
	return nil
}

func (h *Handler) deleteFakturPajak(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	inv, err := h.svc.fakturPajakInvoice(r.Context(), r.PathValue("id"), u)
	if err != nil {
		return err
	}
	if inv.FakturPajakURL == nil || *inv.FakturPajakURL == "" {
		return httpx.Conflict(noFakturPajak)
	}
	if err := h.svc.ports.Sales.SetFakturPajak(r.Context(), h.svc.db, inv.ID, nil); err != nil {
		return err
	}
	h.files.DeletePrivate(*inv.FakturPajakURL)
	return httpx.JSON(w, http.StatusOK, successMessage{true, "Lampiran faktur pajak dihapus"})
}

// fakturFileName is invoice_number.replace(/[^a-zA-Z0-9.-]/g, "_"), per
// UTF-16 code unit as JavaScript counts them.
func fakturFileName(number string) string {
	var b strings.Builder
	for _, c := range number {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '.', c == '-':
			b.WriteRune(c)
		case c > 0xFFFF:
			b.WriteString("__")
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
