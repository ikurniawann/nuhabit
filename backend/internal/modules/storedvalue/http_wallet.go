package storedvalue

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// /api/wallet/** (POS → Dompet admin): lib/wallet/route.ts guards every
// route with the posWallet menu and answers parse failures with the first
// zod issue message.

func (h *Handler) walletRoutes() []module.Route {
	const p = "/api/wallet"
	return []module.Route{
		{Pattern: "GET " + p + "/branches", Handler: kit.API(h.walletBranches)},
		{Pattern: "POST " + p + "/entries/{id}/refund", Handler: kit.API(h.walletRefund)},
		{Pattern: "POST " + p + "/entries/{id}/reverse", Handler: kit.API(h.walletReverse)},
		{Pattern: "POST " + p + "/members/{id}/adjust", Handler: kit.API(h.walletAdjust)},
		{Pattern: "GET " + p + "/members/{id}", Handler: kit.API(h.walletMember)},
		{Pattern: "GET " + p + "/members", Handler: kit.API(h.walletMembers)},
		{Pattern: "GET " + p + "/packages", Handler: kit.API(h.walletPackages)},
		{Pattern: "POST " + p + "/packages", Handler: kit.API(h.walletCreatePackage)},
		{Pattern: "PUT " + p + "/packages/{id}", Handler: kit.API(h.walletUpdatePackage)},
		{Pattern: "DELETE " + p + "/packages/{id}", Handler: kit.API(h.walletDeletePackage)},
		{Pattern: "GET " + p + "/payments", Handler: kit.API(h.walletPayments)},
		{Pattern: "GET " + p + "/payments/{id}", Handler: kit.API(h.walletPayment)},
		{Pattern: "POST " + p + "/payments/{id}/reconcile", Handler: kit.API(h.walletReconcile)},
		{Pattern: "GET " + p + "/settings", Handler: kit.API(h.walletSettings)},
		{Pattern: "PUT " + p + "/settings", Handler: kit.API(h.walletSaveSettings)},
		{Pattern: "GET " + p + "/sweep", Handler: kit.API(h.walletSweepRuns)},
		{Pattern: "POST " + p + "/sweep", Handler: kit.API(h.walletRunSweep)},
	}
}

func (h *Handler) walletAdmin(r *http.Request) (*auth.User, error) {
	return h.kit.Auth.RequireMenuPrefix(r, iam.PosWallet...)
}

func actorOf(u *auth.User) Actor {
	name := u.FullName
	if name == "" {
		name = "Staf"
	}
	return Actor{ID: u.ID, Name: name}
}

// errMalformedJSON is `await request.json()` throwing: apiHandler turns it
// into the generic 500.
var errMalformedJSON = errors.New("request body is not valid JSON")

// jsonForm reads a required JSON body for parseInput.
func jsonForm(r *http.Request) (*validate.Form, error) {
	v, present := validate.ReadBody(r)
	if !present {
		return nil, errMalformedJSON
	}
	return validate.New(v, true), nil
}

// firstIssue is parseInput's 400: the first zod issue message.
func firstIssue(f *validate.Form) error {
	if f.Valid() {
		return nil
	}
	return httpx.BadRequest(f.Issues()[0].Message)
}

func (h *Handler) walletBranches(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	branches, err := h.kit.Dir.ActiveBranches(r.Context(), h.kit.DB)
	if err != nil {
		return err
	}
	if branches == nil {
		branches = []Branch{}
	}
	return kit.OK(w, 200, branches)
}

func (h *Handler) walletRefund(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	in := RefundInput{
		Method:    kit.Deref(f.Enum("method", validate.Rule{}, domain.RefundMethods)),
		Reference: f.StrDefault("reference", "", validate.StrOpts{Max: 100}),
		Reason:    kit.Deref(f.Str("reason", validate.Rule{}, validate.StrOpts{Max: 300})),
	}
	if err := firstIssue(f); err != nil {
		return err
	}
	row, err := h.wallet.RefundTopup(r.Context(), id, in, actorOf(u))
	if err != nil {
		return err
	}
	return kit.OK(w, 201, row)
}

func (h *Handler) walletReverse(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	reason := kit.Deref(f.Str("reason", validate.Rule{}, validate.StrOpts{Max: 300}))
	if err := firstIssue(f); err != nil {
		return err
	}
	row, err := h.wallet.ReverseEntry(r.Context(), id, reason, actorOf(u))
	if err != nil {
		return err
	}
	return kit.OK(w, 201, row)
}

func (h *Handler) walletAdjust(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	amount := f.Num("amount", validate.Rule{}, validate.NumOpts{})
	reason := f.Str("reason", validate.Rule{}, validate.StrOpts{Max: 300})
	if err := firstIssue(f); err != nil {
		return err
	}
	row, err := h.wallet.ApplyAdjustment(r.Context(), id, *amount, *reason, actorOf(u))
	if err != nil {
		return err
	}
	return kit.OK(w, 201, row)
}

func (h *Handler) walletMember(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	out, err := h.wallet.MemberWallet(r.Context(), id)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) walletMembers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	out, err := h.wallet.SearchMembers(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

// walletPackages: ?scope=cashier is the POS menu's active packages for the
// cashier's branch; otherwise the wallet admin's full list.
func (h *Handler) walletPackages(w http.ResponseWriter, r *http.Request) error {
	if r.URL.Query().Get("scope") == "cashier" {
		u, err := h.kit.Auth.RequireMenuPrefix(r, iam.Pos...)
		if err != nil {
			return err
		}
		venue := h.wallet.resolveTopupVenue(r.Context(), u.ID)
		out, err := h.wallet.ListPackages(r.Context(), true, venue.BranchID)
		if err != nil {
			return err
		}
		return kit.OK(w, 200, out)
	}
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	out, err := h.wallet.ListPackages(r.Context(), false, nil)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

// parsePackageInput mirrors packageInputSchema.
func parsePackageInput(f *validate.Form) PackageInput {
	in := PackageInput{
		Name:        kit.Deref(f.Str("name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 80})),
		Description: f.StrDefault("description", "", validate.StrOpts{Trim: true, Max: 300}),
	}
	if v := f.Int("price_idr", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1_000), Max: validate.Bound(100_000_000)}); v != nil {
		in.PriceIdr = *v
	}
	if v := f.Int("credit_idr", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1_000), Max: validate.Bound(200_000_000)}); v != nil {
		in.CreditIdr = *v
	}
	in.ValidityDays = f.Int("validity_days", validate.Rule{Nullable: true, HasDefault: true},
		validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3_650)})
	in.IsActive = f.BoolDefault("is_active", true)
	in.AvailableOnline = f.BoolDefault("available_online", true)
	in.BranchIDs = f.Strings("branch_ids", validate.Rule{Nullable: true, HasDefault: true}, 100, validate.StrOpts{Check: validate.UUIDCheck})
	if v := f.Int("sort", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10_000)}); v != nil {
		in.Sort = *v
	}
	if f.Valid() && in.CreditIdr < in.PriceIdr {
		f.Fail("credit_idr", "custom", "Saldo yang diterima tidak boleh lebih kecil dari harga")
	}
	return in
}

func (h *Handler) walletCreatePackage(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	in := parsePackageInput(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	p, err := h.wallet.SavePackage(r.Context(), "", in, u.ID)
	if err != nil {
		return err
	}
	return kit.OK(w, 201, p)
}

func (h *Handler) walletUpdatePackage(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	in := parsePackageInput(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	p, err := h.wallet.SavePackage(r.Context(), id, in, u.ID)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, p)
}

func (h *Handler) walletDeletePackage(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	if err := h.wallet.DeactivatePackage(r.Context(), id, u.ID); err != nil {
		return err
	}
	return kit.OK(w, 200, struct {
		ID string `json:"id"`
	}{id})
}

// isoDate is zod v4's z.string().date().
var isoDate = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))$`)

// parsePaymentFilters mirrors paymentFiltersSchema over the non-empty query
// parameters (the last value of a repeated key wins, like
// Object.fromEntries).
func parsePaymentFilters(r *http.Request) (PaymentFilters, error) {
	params := map[string]string{}
	for key, values := range r.URL.Query() {
		if v := values[len(values)-1]; v != "" {
			params[key] = v
		}
	}
	f := PaymentFilters{Limit: 100}
	enum := func(key string, options []string) (string, error) {
		v, has := params[key]
		if !has {
			return "", nil
		}
		if code, msg, good := validate.EnumCheck(options)(v); !good {
			_ = code
			return "", httpx.BadRequest(msg)
		}
		return v, nil
	}
	var err error
	if f.Status, err = enum("status", []string{"pending", "completed", "expired", "failed", "cancelled"}); err != nil {
		return f, err
	}
	if f.Source, err = enum("source", []string{"cashier", "member"}); err != nil {
		return f, err
	}
	if q, has := params["q"]; has {
		f.Q = validate.JSTrim(q)
		if validate.UTF16Len(f.Q) > 80 {
			return f, httpx.BadRequest("Too big: expected string to have <=80 characters")
		}
	}
	for _, key := range []string{"from", "to"} {
		if v, has := params[key]; has {
			if !isoDate.MatchString(v) {
				return f, httpx.BadRequest("Invalid ISO date")
			}
			if key == "from" {
				f.From = v
			} else {
				f.To = v
			}
		}
	}
	if raw, has := params["limit"]; has {
		n := jsNumberFromString(raw)
		switch {
		case math.IsNaN(n):
			return f, httpx.BadRequest("Invalid input: expected number, received NaN")
		case math.IsInf(n, 0) || n != math.Trunc(n):
			return f, httpx.BadRequest("Invalid input: expected int, received number")
		case n < 1:
			return f, httpx.BadRequest("Too small: expected number to be >=1")
		case n > 500:
			return f, httpx.BadRequest("Too big: expected number to be <=500")
		}
		f.Limit = int(n)
	}
	return f, nil
}

// jsNumberFromString is Number(s) for a non-empty string.
func jsNumberFromString(s string) float64 {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0
	}
	if strings.HasPrefix(t, "0x") || strings.HasPrefix(t, "0X") {
		if n, err := strconv.ParseInt(t[2:], 16, 64); err == nil {
			return float64(n)
		}
		return math.NaN()
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	n, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return math.NaN()
	}
	return n
}

func (h *Handler) walletPayments(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	f, err := parsePaymentFilters(r)
	if err != nil {
		return err
	}
	out, err := h.wallet.ListOnlinePayments(r.Context(), f)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) walletPayment(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	out, err := h.wallet.OnlinePayment(r.Context(), id)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) walletReconcile(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	id, err := kit.UUIDParam(r, "id")
	if err != nil {
		return err
	}
	out, err := h.wallet.ReconcilePendingTopup(r.Context(), id)
	if err != nil {
		return err
	}
	if out.Status == "not_found" {
		return httpx.NotFound("Pembayaran tidak ditemukan")
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) walletSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	s, err := loadWalletSettings(r.Context(), h.kit.DB)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, s)
}

func (h *Handler) walletSaveSettings(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	f, err := jsonForm(r)
	if err != nil {
		return err
	}
	var in SettingsInput
	if v := f.Num("topup_max_amount", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)}); v != nil {
		in.TopupMaxAmount = *v
	}
	if v := f.Num("low_balance_threshold_idr", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100_000_000)}); v != nil {
		in.LowBalanceThresholdIdr = *v
	}
	in.WalletDefaultValidityDays = f.Int("wallet_default_validity_days", validate.Rule{Nullable: true},
		validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3_650)})
	if v := f.Int("wallet_expiry_reminder_days", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(90)}); v != nil {
		in.WalletExpiryReminderDays = *v
	}
	if err := firstIssue(f); err != nil {
		return err
	}
	s, err := h.wallet.SaveSettings(r.Context(), in, u.ID)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, s)
}

func (h *Handler) walletSweepRuns(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.walletAdmin(r); err != nil {
		return err
	}
	out, err := h.wallet.SweepRuns(r.Context())
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) walletRunSweep(w http.ResponseWriter, r *http.Request) error {
	u, err := h.walletAdmin(r)
	if err != nil {
		return err
	}
	out, err := h.wallet.RunSweep(r.Context(), "manual", &u.ID)
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}
