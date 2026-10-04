package tableorder

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// Static QRIS payment proofs (app/api/table-order/orders/[id]/payment-proof
// and app/api/pos/orders/[id]/payment-proof): the guest uploads a picture of
// the transfer, the cashier checks it before settling the order. Files live
// in storage/private/payment-proofs/<order id>/, never in a public bucket.

const (
	paymentProofFolder   = "payment-proofs"
	paymentProofMaxBytes = 8 * 1024 * 1024
)

var errAlreadyPaid = httpx.Conflict("Order sudah lunas")

// isPaymentProofPathFor is isPaymentProofPathFor: a proof path always sits
// in its own order's folder, so a row can never point at another file.
func isPaymentProofPathFor(orderID string, relPath *string) bool {
	return relPath != nil && strings.HasPrefix(*relPath, paymentProofFolder+"/"+orderID+"/") && !strings.Contains(*relPath, "..")
}

type proofOrder struct {
	Status, PaymentStatus          string
	PaymentMethod, SpecialRequests *string
	PaymentProofPath               *string
}

func loadProofOrder(ctx context.Context, q database.Querier, orderID string) (*proofOrder, error) {
	var o proofOrder
	err := q.QueryRow(ctx, `SELECT status::text, payment_status::text, payment_method::text, special_requests, payment_proof_path
		FROM pos.pos_orders WHERE id = $1 LIMIT 1`, orderID).
		Scan(&o.Status, &o.PaymentStatus, &o.PaymentMethod, &o.SpecialRequests, &o.PaymentProofPath)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &o, err
}

// writeProof serves a proof image with the TS headers.
func writeProof(w http.ResponseWriter, data []byte, mime string) {
	storage.WritePrivateFile(w, data, mime, "private, no-store", "")
}

// uploadPaymentProof is POST /api/table-order/orders/{id}/payment-proof
// (10 per minute per client).
func (h *Handler) uploadPaymentProof() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := domain.JSTrim(r.PathValue("id"))
		if !isUUID(id) {
			_ = kit.Fail(w, http.StatusBadRequest, "Order tidak valid")
			return
		}
		if h.limited(w, r, "table-order:proof:"+clientIdentifier(r), 10, "Terlalu sering mengunggah — tunggu sebentar") {
			return
		}
		uploadedAt, err := h.savePaymentProof(r, id)
		var he *httpx.Error
		switch {
		case errors.As(err, &he):
			_ = kit.Fail(w, he.Status, he.Message)
		case err != nil:
			h.log.ErrorContext(r.Context(), "[table-order] payment proof upload error:", "error", err)
			_ = kit.Fail(w, http.StatusInternalServerError, "Gagal mengunggah bukti bayar")
		default:
			_ = httpx.Data(w, http.StatusOK, struct {
				UploadedAt httpx.JSTime `json:"payment_proof_uploaded_at"`
			}{httpx.JSTime(uploadedAt)})
		}
	})
}

// savePaymentProof runs the upload; an *httpx.Error is the client answer.
func (h *Handler) savePaymentProof(r *http.Request, orderID string) (time.Time, error) {
	ctx, db := r.Context(), h.svc.db
	order, err := loadProofOrder(ctx, db, orderID)
	switch {
	case err != nil:
		return time.Time{}, err
	case order == nil:
		return time.Time{}, httpx.NotFound("Order tidak ditemukan")
	case domain.PaymentFlowFrom(order.SpecialRequests, order.PaymentMethod) != "static_qris":
		return time.Time{}, httpx.Conflict("Order ini tidak memakai pembayaran Static QRIS")
	case order.PaymentStatus == "paid":
		return time.Time{}, errAlreadyPaid
	case order.Status == "cancelled" || order.Status == "voided" || order.Status == "merged":
		return time.Time{}, httpx.Conflict("Order sudah dibatalkan")
	}

	var file *storage.File
	if form, err := storage.ReadForm(r, storage.MaxRequestBytes); err == nil {
		file = form.File("file")
	}
	if file == nil || file.Size() == 0 {
		return time.Time{}, httpx.BadRequest("Pilih foto bukti bayar dulu")
	}
	if file.Size() > paymentProofMaxBytes {
		return time.Time{}, httpx.BadRequest("Foto bukti maksimal 8 MB")
	}
	// The type comes from the bytes: some phone galleries send no MIME.
	sniffed := storage.SniffImage(file.Data)
	if sniffed == "" {
		return time.Time{}, httpx.BadRequest("File harus foto/tangkapan layar JPG, PNG, atau WebP")
	}
	saved, err := h.files.SavePrivateImage(file.Data, sniffed, paymentProofFolder+"/"+orderID)
	if err != nil {
		return time.Time{}, httpx.Status(http.StatusInternalServerError, err.Error())
	}

	var uploadedAt time.Time
	err = db.QueryRow(ctx, `UPDATE pos.pos_orders
		SET payment_proof_path = $2, payment_proof_uploaded_at = now(), updated_at = now()
		WHERE id = $1 AND payment_status::text <> 'paid'
		RETURNING payment_proof_uploaded_at`, orderID, saved).Scan(&uploadedAt)
	if database.IsNoRows(err) {
		// The cashier settled between the check and the update: drop the new file.
		h.files.DeletePrivate(saved)
		return time.Time{}, errAlreadyPaid
	}
	if err != nil {
		return time.Time{}, err
	}
	if isPaymentProofPathFor(orderID, order.PaymentProofPath) && *order.PaymentProofPath != saved {
		h.files.DeletePrivate(*order.PaymentProofPath)
	}
	return uploadedAt, nil
}

// viewPaymentProof is GET /api/table-order/orders/{id}/payment-proof: the
// guest sees what they sent (60 per minute per client).
func (h *Handler) viewPaymentProof() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := domain.JSTrim(r.PathValue("id"))
		if !isUUID(id) {
			_ = kit.Fail(w, http.StatusBadRequest, "Order tidak valid")
			return
		}
		if h.limited(w, r, "table-order:proof-view:"+clientIdentifier(r), 60, "Terlalu sering — tunggu sebentar") {
			return
		}
		order, err := loadProofOrder(r.Context(), h.svc.db, id)
		if err != nil {
			h.log.ErrorContext(r.Context(), "[table-order] payment proof view error:", "error", err)
			_ = kit.Fail(w, http.StatusInternalServerError, "Gagal memuat bukti bayar")
			return
		}
		if order == nil || !isPaymentProofPathFor(id, order.PaymentProofPath) {
			_ = kit.Fail(w, http.StatusNotFound, "Bukti bayar belum ada")
			return
		}
		data, mime, err := h.files.ReadPrivate(*order.PaymentProofPath)
		if err != nil {
			_ = kit.Fail(w, http.StatusNotFound, "Bukti bayar belum ada")
			return
		}
		writeProof(w, data, mime)
	})
}

// posPaymentProof is GET /api/pos/orders/{id}/payment-proof: the cashier
// checks the guest's proof before settling.
func (h *Handler) posPaymentProof() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := kit.PosUser(h.auth, r); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id := domain.JSTrim(r.PathValue("id"))
		if !isUUID(id) {
			_ = kit.Fail(w, http.StatusBadRequest, "Order tidak valid")
			return
		}
		var relPath *string
		err := h.svc.db.QueryRow(r.Context(), `SELECT payment_proof_path FROM pos.pos_orders WHERE id = $1 LIMIT 1`, id).Scan(&relPath)
		if err != nil && !database.IsNoRows(err) {
			h.log.ErrorContext(r.Context(), "[pos/orders/payment-proof] GET failed:", "error", err)
			_ = kit.Fail(w, http.StatusInternalServerError, "Gagal memuat bukti bayar")
			return
		}
		if !isPaymentProofPathFor(id, relPath) {
			_ = kit.Fail(w, http.StatusNotFound, "Bukti bayar belum ada")
			return
		}
		data, mime, err := h.files.ReadPrivate(*relPath)
		if err != nil {
			_ = kit.Fail(w, http.StatusNotFound, "Berkas bukti bayar hilang")
			return
		}
		writeProof(w, data, mime)
	})
}
