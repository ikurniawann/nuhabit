package storedvalue

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// /api/pos/topup/** (cashier top-up). These routes catch their own errors:
// most answer 500 with the raw error message.

func (h *Handler) topupRoutes() []module.Route {
	const p = "/api/pos/topup"
	return []module.Route{
		{Pattern: "GET " + p, Handler: h.kit.Raw(h.topupHistory)},
		{Pattern: "POST " + p, Handler: h.kit.Raw(h.createTopup)},
		{Pattern: "POST " + p + "/{id}/cancel", Handler: h.kit.Raw(h.cancelTopup)},
		{Pattern: "POST " + p + "/{id}/reconcile", Handler: h.kit.Caught("Gagal mengecek pembayaran ke Xendit", h.reconcileTopup)},
		{Pattern: "POST " + p + "/{id}/send-wa", Handler: h.kit.Caught("Gagal mengirim bukti top-up", h.sendTopupWa)},
		{Pattern: "GET " + p + "/{id}/status", Handler: h.kit.Raw(h.topupStatus)},
	}
}

// historyRow is a select-* row plus the customer embed and order number.
type historyRow struct {
	starRow
	Customer    json.RawMessage `json:"customer"`
	OrderNumber *string         `json:"order_number"`
}

// jsParseInt is Number.parseInt(s, 10): leading integer digits, NaN when
// there are none.
func jsParseInt(s string) (int, bool) {
	t := strings.TrimLeft(s, " \t\n\r\v\f")
	end := 0
	if end < len(t) && (t[end] == '-' || t[end] == '+') {
		end++
	}
	start := end
	for end < len(t) && t[end] >= '0' && t[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	n, err := strconv.Atoi(t[:end])
	if err != nil {
		return 0, false
	}
	return n, true
}

// GET /api/pos/topup?customer_id=&limit= — a member's wallet history, or
// the latest top-ups without customer_id.
func (h *Handler) topupHistory(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.PosUser(r); err != nil {
		return err
	}
	q := r.URL.Query()
	limitRaw := q.Get("limit")
	if limitRaw == "" {
		limitRaw = "50"
	}
	limit, parsed := jsParseInt(limitRaw)
	if !parsed || limit == 0 {
		limit = 50
	}
	limit = min(100, max(1, limit))
	where, arg := "type = $1", any("topup")
	if customerID := q.Get("customer_id"); customerID != "" {
		where, arg = "customer_id = $1", customerID
	}
	rows, err := h.kit.DB.Query(r.Context(),
		`SELECT `+starColumns+`,
		        (SELECT row_to_json(e) FROM (SELECT name, phone FROM pos.pos_customers c WHERE c.id = t.customer_id) e) AS customer
		   FROM pos.pos_wallet_transactions t WHERE `+where+` ORDER BY created_at DESC LIMIT `+strconv.Itoa(limit), arg)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (historyRow, error) {
		var hr historyRow
		var created, expires, processed *time.Time
		d := hr.dest()
		d[12], d[17], d[18] = &created, &expires, &processed
		err := row.Scan(append(d, &hr.Customer)...)
		hr.CreatedAt, hr.ExpiresAt, hr.ExpiryProcessedAt = httpx.NewJSTime(created), httpx.NewJSTime(expires), httpx.NewJSTime(processed)
		if hr.Customer == nil {
			hr.Customer = json.RawMessage("null")
		}
		return hr, err
	})
	if err != nil {
		return err
	}
	var orderIDs []string
	for _, row := range list {
		if row.OrderID != nil {
			orderIDs = append(orderIDs, *row.OrderID)
		}
	}
	numbers := map[string]string{}
	if ids := domain.SortedUnique(orderIDs); len(ids) > 0 {
		if numbers, err = h.kit.Dir.OrderNumbers(r.Context(), h.kit.DB, ids); err != nil {
			return err
		}
	}
	for i := range list {
		if id := list[i].OrderID; id != nil {
			if n, has := numbers[*id]; has && n != "" {
				list[i].OrderNumber = &n
			}
		}
	}
	if list == nil {
		list = []historyRow{}
	}
	return kit.OK(w, 200, list)
}

// errBadJSON stands in for `await request.json()` throwing on a malformed
// body (the TS answers 500 with the parser's message).
var errBadJSON = errors.New("Unexpected end of JSON input")

// jsLessEqZero is `value <= 0` for a JSON value.
func jsLessEqZero(v any) bool {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f <= 0
	case string:
		n := jsNumberFromString(x)
		return !math.IsNaN(n) && n <= 0
	case bool:
		return !x
	case nil:
		return true
	}
	return false
}

// jsonValue converts validate's json.Number values to float64 for the
// domain helpers.
func jsonValue(v any) any {
	if n, isNum := v.(json.Number); isNum {
		f, _ := n.Float64()
		return f
	}
	return v
}

func (h *Handler) arkCoinDisabled(w http.ResponseWriter) error {
	return httpx.JSON(w, http.StatusConflict, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
		Code    string `json:"code"`
	}{false, domain.ArkCoinDisabledMessage, "ARK_COIN_DISABLED"})
}

// supervisorRejection is supervisorPinRejection: 429 when locked, else 403.
func supervisorRejection(a SupervisorApproval) error {
	if a.Reason == "locked" {
		return httpx.TooManyRequests("Terlalu banyak percobaan PIN supervisor. Coba lagi dalam " + strconv.Itoa(a.RetryMinutes) + " menit.")
	}
	return httpx.Forbidden("PIN supervisor tidak valid")
}

// POST /api/pos/topup — cash, card and FOC credit at once; QRIS creates a
// dynamic QR and a pending row.
func (h *Handler) createTopup(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	raw, present := validate.ReadBody(r)
	if !present {
		return errBadJSON
	}
	body, _ := raw.(map[string]any)
	if !h.kit.Dir.ArkCoinEnabled(ctx, h.kit.DB) {
		return h.arkCoinDisabled(w)
	}
	rawMethod, hasMethod := body["payment_method"]
	if !hasMethod {
		rawMethod = "qris"
	}
	method := domain.ResolvePaymentMethod(jsonValue(rawMethod))

	// FOC: free credit for marketing, needs a supervisor PIN, earns no XP
	// and the owner is told on WhatsApp.
	var approver *ApprovedSupervisor
	if method == "foc" {
		pin := strings.TrimSpace(domain.JSOr(jsonValue(body["supervisor_pin"])))
		if pin == "" {
			return httpx.BadRequest("Topup FOC membutuhkan PIN supervisor")
		}
		approval, err := h.wallet.ports.Supervisors.Approve(ctx, u.ID, pin)
		if err != nil {
			return err
		}
		if !approval.OK {
			return supervisorRejection(approval)
		}
		approver = &approval.Supervisor
	}

	customerID := domain.JSOr(jsonValue(body["customer_id"]))
	packageID := domain.JSOr(jsonValue(body["package_id"]))
	amountRaw := jsonValue(body["amount"])
	if customerID == "" || (packageID == "" && (domain.JSOr(amountRaw) == "" || jsLessEqZero(body["amount"]))) {
		return httpx.BadRequest("Customer ID and valid amount are required")
	}
	settings, err := loadLoyaltySettings(ctx, h.kit.DB)
	if err != nil {
		return err
	}
	venue := h.wallet.resolveTopupVenue(ctx, u.ID)
	var pkg *packageTopup
	if packageID != "" {
		p, err := h.wallet.packageForSale(ctx, packageID, venue.BranchID)
		if err != nil {
			return err
		}
		fields := packageTopupFields(p)
		pkg = &fields
	}
	amount := domain.ToNumber(amountRaw)
	if pkg != nil {
		amount = pkg.Amount
	}
	if amount < settings.TopupMinAmount {
		return httpx.BadRequest("Minimum top-up is " + domain.FormatRupiah(settings.TopupMinAmount))
	}
	arkCoins := domain.IdrToArk(amount, settings.ArkRate)
	var balanceStr *string
	if err := h.kit.DB.QueryRow(ctx, `SELECT ark_coin_balance::text FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&balanceStr); err != nil {
		return httpx.NotFound("Customer not found")
	}
	balanceBefore := domain.ToNumber(kit.Deref(balanceStr))

	if method == "qris" {
		if amount < domain.QRISMinAmount {
			return httpx.BadRequest("Minimum QRIS top-up is Rp 1.500")
		}
		var pkgMeta map[string]any
		if pkg != nil {
			pkgMeta = pkg.Metadata
		}
		origin := h.kit.Origin(r)
		pending, err := h.wallet.createPendingQRIS(ctx, customerID, amount, balanceBefore, settings.ArkRate, venue,
			func(configured string) string {
				if configured != "" {
					return configured
				}
				return origin + "/api/payments/xendit/webhook"
			}, pkgMeta)
		if err != nil {
			return err
		}
		return kit.OK(w, 201, struct {
			Status        string     `json:"status"`
			Transaction   *WalletRow `json:"transaction"`
			TopupID       string     `json:"topup_id"`
			BalanceBefore float64    `json:"balance_before"`
			BalanceAfter  float64    `json:"balance_after"`
			ArkCoins      float64    `json:"ark_coins"`
			ArkRate       float64    `json:"ark_rate"`
			XPAwarded     float64    `json:"xp_awarded"`
			QRCodeURL     string     `json:"qr_code_url"`
			QRString      string     `json:"qr_string"`
			XenditQRID    *string    `json:"xendit_qr_id"`
			ReferenceID   string     `json:"reference_id"`
			ExpiresAt     string     `json:"expires_at"`
		}{"pending", pending.Transaction, pending.Transaction.ID, balanceBefore, balanceBefore, arkCoins, settings.ArkRate, 0,
			domain.QRImageURL(pending.QRString), pending.QRString, pending.XenditQRID, pending.ReferenceID, pending.ExpiresAt})
	}

	res, err := h.wallet.creditAtCounter(ctx, counterTopup{
		CustomerID: customerID, Method: method, Amount: amount, ArkCoins: arkCoins, BalanceBefore: balanceBefore,
		Settings: settings, Venue: venue, Package: pkg, Approver: approver,
		XenditTransactionID: domain.JSOr(jsonValue(body["xendit_transaction_id"])),
	})
	if err != nil {
		return err
	}
	return kit.OK(w, 201, struct {
		Status        string   `json:"status"`
		Transaction   *starRow `json:"transaction"`
		BalanceBefore float64  `json:"balance_before"`
		BalanceAfter  float64  `json:"balance_after"`
		ArkCoins      float64  `json:"ark_coins"`
		ArkRate       float64  `json:"ark_rate"`
		XPAwarded     float64  `json:"xp_awarded"`
		CrmXP         CrmXP    `json:"crm_xp"`
		QRCodeURL     *string  `json:"qr_code_url"`
	}{"completed", res.Transaction, balanceBefore, res.BalanceAfter, arkCoins, settings.ArkRate, res.XPAwarded, res.CrmXP, nil})
}

// counterTopup is a cash, card or FOC top-up credited at the counter.
type counterTopup struct {
	CustomerID          string
	Method              string
	Amount              float64
	ArkCoins            float64
	BalanceBefore       float64
	Settings            domain.LoyaltySettings
	Venue               Venue
	Package             *packageTopup
	Approver            *ApprovedSupervisor
	XenditTransactionID string
}

type counterResult struct {
	Transaction  *starRow
	BalanceAfter float64
	XPAwarded    float64
	CrmXP        CrmXP
}

// creditAtCounter mirrors the cash/credit/FOC branch of POST
// /api/pos/topup statement by statement: the balance update (no lock, as
// the TS), the completed row, the package bonus in its own transaction,
// then XP (none for FOC) and the owner's FOC notice.
func (w *Wallet) creditAtCounter(ctx context.Context, in counterTopup) (counterResult, error) {
	after := in.BalanceBefore + in.Amount
	if _, err := w.db.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = $3 WHERE id = $1`,
		in.CustomerID, after, isoString(w.now())); err != nil {
		return counterResult{}, err
	}
	notes := "Card top-up"
	meta := map[string]any{"settled_via": "cashier"}
	switch in.Method {
	case "foc":
		notes = "FOC top-up (marketing) — disetujui " + in.Approver.Name
		meta = map[string]any{"settled_via": "foc", "approved_by_id": in.Approver.ID, "approved_by_name": in.Approver.Name, "xp_awarded": false}
	case "cash":
		notes = "Cash top-up"
	}
	var packageID *string
	var expiresAt *string
	if in.Package != nil {
		for k, v := range in.Package.Metadata {
			meta[k] = v
		}
		id := domain.JSString(in.Package.Metadata["package_id"])
		packageID = &id
		days, _ := in.Package.Metadata["validity_days"].(*float64)
		if t := domain.ExpiresAtFor(days, w.now()); t != nil {
			s := isoString(*t)
			expiresAt = &s
		}
	}
	rawMeta, err := json.Marshal(meta)
	if err != nil {
		return counterResult{}, err
	}
	method := in.Method
	tx, err := scanStar(w.db.QueryRow(ctx,
		`INSERT INTO pos.pos_wallet_transactions
		   (customer_id, type, company_id, branch_id, amount, ark_coins, balance_before, balance_after, payment_method,
		    status, package_id, expires_at, xendit_transaction_id, notes, metadata)
		 VALUES ($1, 'topup', $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10, $11, $12, $13::jsonb)
		 RETURNING `+starColumns,
		in.CustomerID, in.Venue.CompanyID, in.Venue.BranchID, in.Amount, in.ArkCoins, in.BalanceBefore, after, method,
		packageID, expiresAt, kit.NullIfEmpty(in.XenditTransactionID), notes, string(rawMeta)))
	if err != nil {
		return counterResult{}, err
	}
	if in.Package != nil && in.Package.Bonus > 0 {
		var bonusExpiry *time.Time
		if tx.ExpiresAt != nil {
			t := time.Time(*tx.ExpiresAt)
			bonusExpiry = &t
		}
		err := database.WithTx(ctx, w.db, func(q pgx.Tx) error {
			var err error
			after, err = creditTopupBonus(ctx, q, in.CustomerID, tx.ID, in.Package.Bonus, bonusExpiry, in.Package.Metadata,
				in.Settings.ArkRate, in.Venue.CompanyID, in.Venue.BranchID)
			return err
		})
		if err != nil {
			return counterResult{}, err
		}
	}
	res := counterResult{Transaction: tx, BalanceAfter: after}
	if in.Method == "foc" {
		res.CrmXP = CrmXP{Status: "skipped", Reason: "foc_topup"}
		w.notifyFocAsync(FocTopupNotice{TransactionID: tx.ID, AmountIdr: in.Amount, ApprovedName: &in.Approver.Name, CustomerID: in.CustomerID})
		return res, nil
	}
	res.CrmXP = w.ports.Loyalty.AwardTopupXP(ctx, w.db, in.CustomerID, in.Amount, tx.ID)
	res.XPAwarded = res.CrmXP.XPAwarded
	if res.XPAwarded == 0 {
		res.XPAwarded = domain.CalculateTopupXP(in.Amount, in.Settings)
	}
	return res, nil
}

// notifyFocAsync is `void notifyFocTopup(...)`: fire and forget.
func (w *Wallet) notifyFocAsync(n FocTopupNotice) {
	go w.ports.WhatsApp.NotifyFocTopup(context.Background(), n)
}

// loadStarTopup is `select("*").eq("id").eq("type","topup").maybeSingle()`.
func (h *Handler) loadStarTopup(ctx context.Context, id string) (*starRow, error) {
	tx, err := scanStar(h.kit.DB.QueryRow(ctx, `SELECT `+starColumns+` FROM pos.pos_wallet_transactions WHERE id = $1 AND type = 'topup'`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return tx, err
}

// POST /api/pos/topup/{id}/cancel — cancel a pending QRIS top-up.
func (h *Handler) cancelTopup(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	tx, err := h.loadStarTopup(r.Context(), id)
	if err != nil {
		return err
	}
	if tx == nil {
		return httpx.NotFound("Top-up not found")
	}
	if tx.Status != "pending" {
		return httpx.BadRequest("Only pending top-ups can be cancelled")
	}
	meta := decodeMeta(tx.Metadata)
	meta["cancelled_at"] = isoString(h.kit.Now())
	meta["cancelled_by"] = u.ID
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	updated, err := scanStar(h.kit.DB.QueryRow(r.Context(),
		`UPDATE pos.pos_wallet_transactions SET status = 'cancelled', notes = 'Top-up cancelled', metadata = $2::jsonb
		  WHERE id = $1 AND status = 'pending' RETURNING `+starColumns, id, string(raw)))
	if database.IsNoRows(err) {
		return httpx.Conflict("Top-up was already updated")
	}
	if err != nil {
		return err
	}
	return kit.OK(w, 200, struct {
		TopupID     string   `json:"topup_id"`
		Status      string   `json:"status"`
		Transaction *starRow `json:"transaction"`
	}{id, "cancelled", updated})
}

// creditedView is the "completed after reconciliation" data of the status
// and reconcile routes.
type creditedView struct {
	Status        string  `json:"status"`
	TopupID       string  `json:"topup_id"`
	BalanceBefore float64 `json:"balance_before"`
	BalanceAfter  float64 `json:"balance_after"`
	ArkCoins      float64 `json:"ark_coins"`
	ArkRate       float64 `json:"ark_rate"`
	XPAwarded     float64 `json:"xp_awarded"`
	Transaction   any     `json:"transaction"`
	QRCodeURL     *string `json:"qr_code_url"`
}

func creditedFrom(id string, o ReconcileOutcome, qrURL *string) creditedView {
	return creditedView{Status: "completed", TopupID: id, BalanceBefore: o.BalanceBefore, BalanceAfter: o.BalanceAfter,
		ArkCoins: o.ArkCoins, ArkRate: o.ArkRate, XPAwarded: o.XPAwarded, Transaction: o.Transaction, QRCodeURL: qrURL}
}

// POST /api/pos/topup/{id}/reconcile — the cashier's "check payment".
func (h *Handler) reconcileTopup(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.PosUser(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	o, err := h.wallet.ReconcilePendingTopup(r.Context(), id)
	if err != nil {
		return err
	}
	switch o.Status {
	case "credited":
		return kit.MessageData(w, 200, "Pembayaran ditemukan di Xendit — saldo sudah dikredit", creditedFrom(id, o, nil))
	case "already_completed":
		return kit.MessageData(w, 200, "Topup ini sudah selesai sebelumnya", struct {
			Status       string  `json:"status"`
			TopupID      string  `json:"topup_id"`
			Transaction  any     `json:"transaction"`
			BalanceAfter float64 `json:"balance_after"`
		}{"completed", id, o.Transaction, o.BalanceAfter})
	case "pending":
		return kit.MessageData(w, 200, o.Detail, struct {
			Status  string `json:"status"`
			TopupID string `json:"topup_id"`
		}{"pending", id})
	case "not_found":
		return httpx.NotFound("Topup tidak ditemukan")
	case "not_qris":
		return httpx.BadRequest("Hanya topup QRIS pending yang bisa dicek")
	}
	return httpx.Status(http.StatusBadGateway, o.Detail)
}

// GET /api/pos/topup/{id}/status — poll a QRIS top-up; a pending one is
// reconciled with Xendit on every poll.
func (h *Handler) topupStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.PosUser(r); err != nil {
		return err
	}
	id := r.PathValue("id")
	ctx := r.Context()
	tx, err := h.loadStarTopup(ctx, id)
	if err != nil {
		return err
	}
	if tx == nil {
		return httpx.NotFound("Topup not found")
	}
	meta := decodeMeta(tx.Metadata)
	var qrString, qrURL *string
	if s := domain.JSOr(meta["qr_string"]); s != "" {
		u := domain.QRImageURL(s)
		qrString, qrURL = &s, &u
	}
	if tx.Status == "pending" {
		o, err := h.wallet.ReconcilePendingTopup(ctx, id)
		switch {
		case err != nil:
			h.kit.Log.Warn("[topup-status] rekonsiliasi error", "topup", id, "error", err.Error())
		case o.Status == "credited":
			return kit.OK(w, 200, creditedFrom(id, o, qrURL))
		case o.Status == "error":
			h.kit.Log.Warn("[topup-status] rekonsiliasi gagal", "topup", id, "detail", o.Detail)
		}
	}
	var expiresAt *string
	if s := domain.JSOr(meta["expires_at"]); s != "" {
		expiresAt = &s
	}
	return kit.OK(w, 200, struct {
		Status        string   `json:"status"`
		TopupID       string   `json:"topup_id"`
		BalanceBefore float64  `json:"balance_before"`
		BalanceAfter  float64  `json:"balance_after"`
		ArkCoins      float64  `json:"ark_coins"`
		Transaction   *starRow `json:"transaction"`
		QRCodeURL     *string  `json:"qr_code_url"`
		QRString      *string  `json:"qr_string"`
		ExpiresAt     *string  `json:"expires_at"`
	}{tx.Status, id, domain.ToNumber(tx.BalanceBefore), domain.ToNumber(tx.BalanceAfter), domain.ToNumber(tx.ArkCoins),
		tx, qrURL, qrString, expiresAt})
}

// POST /api/pos/topup/{id}/send-wa { phone? } — WhatsApp receipt of a
// successful top-up, to the member's number by default.
func (h *Handler) sendTopupWa(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	body := kit.BodyObject(r)
	var amount, balanceAfter, method string
	var status *string
	var created *time.Time
	var name, phone *string
	err = h.kit.DB.QueryRow(ctx,
		`SELECT t.amount::text, t.balance_after::text, COALESCE(t.payment_method, 'cash'), t.status, t.created_at, c.name, c.phone
		   FROM pos.pos_wallet_transactions t LEFT JOIN pos.pos_customers c ON c.id = t.customer_id
		  WHERE t.id = $1`, id).Scan(&amount, &balanceAfter, &method, &status, &created, &name, &phone)
	if err != nil {
		// The TS ignores the query error: no row means 404.
		return httpx.NotFound("Transaksi top-up tidak ditemukan")
	}
	// pending/failed must never go out as a "receipt".
	switch strings.ToLower(kit.Deref(status)) {
	case "pending", "failed", "cancelled", "expired":
		return httpx.BadRequest("Top-up belum berhasil — bukti tidak dikirim")
	}
	target := phone
	if v, has := body["phone"]; has && v != nil {
		s, isString := v.(string)
		if !isString {
			return errors.New("raw.replace is not a function")
		}
		target = &s
	}
	normalized := domain.NormalizeWaPhone(target)
	if normalized == nil {
		return httpx.BadRequest("Nomor WA tidak valid — periksa kembali")
	}
	outlet, err := h.kit.Dir.FirstCompanyName(ctx, h.kit.DB)
	if err != nil {
		return err
	}
	at := h.kit.Now()
	if created != nil {
		at = *created
	}
	after := domain.ToNumber(balanceAfter)
	message := domain.BuildTopupReceiptMessage(domain.TopupReceipt{
		OutletName: orDefault(outlet, "Kasir"), CustomerName: orDefault(name, "Pelanggan"),
		Amount: domain.ToNumber(amount), Method: method, BalanceAfter: &after, At: at,
	})
	sent := h.wallet.ports.WhatsApp.SendText(ctx, *normalized, message, "notification", &u.ID)
	if !sent.Delivered {
		reason := sent.Reason
		if reason == "" {
			reason = "Gagal mengirim WA"
		}
		return httpx.Status(http.StatusBadGateway, reason)
	}
	return kit.OK(w, 200, struct {
		Phone string `json:"phone"`
	}{*normalized})
}

// orDefault is `value ?? fallback`.
func orDefault(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}
