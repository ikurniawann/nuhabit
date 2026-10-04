package storedvalue

import (
	"net/http"
	"regexp"
	"time"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// /api/pos/member-bills/** (POS → Tagihan Member).

func (h *Handler) memberBillRoutes() []module.Route {
	const p = "/api/pos/member-bills"
	return []module.Route{
		{Pattern: "GET " + p, Handler: h.kit.Caught("Gagal memuat tagihan", h.listMemberBills)},
		{Pattern: "GET " + p + "/{customerId}", Handler: h.kit.Caught("Gagal memuat tagihan", h.memberBillDetail)},
		{Pattern: "POST " + p + "/{customerId}/payments", Handler: h.kit.Caught("Gagal mencatat pembayaran", h.memberBillPayment)},
		{Pattern: "POST " + p + "/{customerId}/settle", Handler: h.kit.Caught("Gagal menutup tagihan", h.settleMemberBill)},
		{Pattern: "POST " + p + "/{customerId}/send-wa", Handler: h.kit.Caught("Gagal mengirim tagihan", h.sendMemberBillWa)},
	}
}

// tableOrderUUID is isUuid in lib/table-order/server.ts (versions 1-5).
var tableOrderUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func billCustomerParam(r *http.Request) (string, error) {
	id := r.PathValue("customerId")
	if !tableOrderUUID.MatchString(id) {
		return "", httpx.BadRequest("Member tidak valid")
	}
	return id, nil
}

func billUser(u *auth.User) BillUser {
	name := u.FullName
	if name == "" {
		name = "Kasir"
	}
	return BillUser{ID: u.ID, Name: name}
}

func (h *Handler) listMemberBills(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.Auth.RequireMenuPrefix(r, iam.PosMemberBills...); err != nil {
		return err
	}
	out, err := h.bills.List(r.Context(), jsSlice(r.URL.Query().Get("search"), 80))
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) memberBillDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.Auth.RequireMenuPrefix(r, iam.PosMemberBills...); err != nil {
		return err
	}
	id, err := billCustomerParam(r)
	if err != nil {
		return err
	}
	out, err := h.bills.Detail(r.Context(), id)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

// memberBillPayment: POST /payments { amount, payment_method_code,
// reference_number?, notes?, shift_id? } — 201 with the new balance.
func (h *Handler) memberBillPayment(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.Auth.RequireMenuAction(r, "create", iam.PosMemberBills...)
	if err != nil {
		return err
	}
	id, err := billCustomerParam(r)
	if err != nil {
		return err
	}
	if err := h.kit.RateLimit("pos-member-bill:"+u.ID, 30, "Terlalu banyak percobaan, coba lagi sebentar"); err != nil {
		return err
	}
	v, present := validate.ReadBody(r)
	f := validate.New(v, present)
	in := PaymentInput{}
	if n := f.Int("amount", validate.Rule{}, validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)}); n != nil {
		in.Amount = float64(*n)
	}
	in.PaymentMethodCode = kit.Deref(f.Str("payment_method_code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 60}))
	in.ReferenceNumber = f.Str("reference_number", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 80})
	in.Notes = f.Str("notes", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 300})
	in.ShiftID = f.UUID("shift_id", validate.Rule{Optional: true, Nullable: true})
	if !f.Valid() {
		return httpx.BadRequest("Data pembayaran tidak valid")
	}
	out, err := h.bills.RecordPayment(r.Context(), id, in, billUser(u))
	if err != nil {
		return err
	}
	return kit.OK(w, 201, out)
}

func (h *Handler) settleMemberBill(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.Auth.RequireMenuAction(r, "create", iam.PosMemberBills...)
	if err != nil {
		return err
	}
	id, err := billCustomerParam(r)
	if err != nil {
		return err
	}
	out, err := h.bills.SettleFromCredit(r.Context(), id, billUser(u))
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

// sendMemberBillWa: POST /send-wa { preview? } — the bill reminder, rebuilt
// from the database and sent to the member's own number.
func (h *Handler) sendMemberBillWa(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.Auth.RequireMenuAction(r, "create", iam.PosMemberBills...)
	if err != nil {
		return err
	}
	id, err := billCustomerParam(r)
	if err != nil {
		return err
	}
	body := kit.BodyObject(r)
	ctx := r.Context()
	detail, err := h.bills.Detail(ctx, id)
	if err != nil {
		return err
	}
	if detail.Balance.Outstanding <= 0 {
		return httpx.BadRequest("Tidak ada sisa tagihan untuk dikirim")
	}
	phone := domain.NormalizeWaPhone(detail.Customer.Phone)
	if phone == nil {
		return httpx.BadRequest("Nomor WA member tidak valid — perbarui di data member")
	}
	outlet, err := h.kit.Dir.FirstCompanyName(ctx, h.kit.DB)
	if err != nil {
		return err
	}
	orders := make([]domain.BillReminderOrder, len(detail.OpenOrders))
	for i, o := range detail.OpenOrders {
		number := kit.Deref(o.OrderNumber)
		if number == "" {
			number = o.ID[:8]
		}
		orders[i] = domain.BillReminderOrder{OrderNumber: number, OrderedAt: time.Time(o.OrderedAt), Total: o.TotalAmount}
	}
	message := domain.BuildMemberBillReminderMessage(domain.MemberBillReminder{
		OutletName: orDefault(outlet, "Kasir"), CustomerName: detail.Customer.Name, At: h.kit.Now(), Orders: orders,
		OpenTotal: detail.Balance.OpenTotal, Paid: detail.Balance.Credit, Outstanding: detail.Balance.Outstanding,
	})
	type sendView struct {
		Phone   string `json:"phone"`
		Message string `json:"message"`
		Sent    bool   `json:"sent"`
	}
	if truthy(jsonValue(body["preview"])) {
		return kit.OK(w, 200, sendView{*phone, message, false})
	}
	// No double send (double click or spam), per member and per cashier.
	busy := "Tagihan baru saja dikirim — tunggu sebentar sebelum kirim lagi"
	if err := h.kit.RateLimit("pos-member-bill-wa:"+id, 3, busy); err != nil {
		return err
	}
	if err := h.kit.RateLimit("pos-member-bill-wa-user:"+u.ID, 20, busy); err != nil {
		return err
	}
	sent := h.wallet.ports.WhatsApp.SendText(ctx, *phone, message, "notification", &u.ID)
	if !sent.Delivered {
		reason := sent.Reason
		if reason == "" {
			reason = "Gagal mengirim WA"
		}
		return httpx.Status(http.StatusBadGateway, reason)
	}
	return kit.OK(w, 200, sendView{*phone, message, true})
}
