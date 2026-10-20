package gymcredits

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Saved payment methods: a member links a card or e-wallet on the Xendit
// hosted page, and pass renewals with renew_with 'saved_method' charge it
// without the member. We store the Xendit token id, the channel and a
// masked label; card numbers never reach this server. The feature is off
// unless XENDIT_SAVED_METHODS_ENABLED is set and the Xendit gateway is
// active (local dev with the dev bypass gets a simulated rail instead).

// SavedMethodsFlag is the env flag that turns saved methods on.
const SavedMethodsFlag = "XENDIT_SAVED_METHODS_ENABLED"

// SavedMethodChannelsEnv optionally limits the channels the hosted page
// offers (comma separated Xendit channel codes, e.g. CARDS,OVO,DANA).
const SavedMethodChannelsEnv = "XENDIT_SAVED_METHOD_CHANNELS"

// PaymentMethodRefPrefix prefixes the reference_id of SAVE sessions.
const PaymentMethodRefPrefix = "gympm_"

// PaySavedMethod is the payment_method of a purchase charged to a saved method.
const PaySavedMethod = "saved_method"

// Saved method statuses (gym.member_payment_methods.status).
const (
	MethodPending  = "pending"
	MethodActive   = "active"
	MethodCanceled = "canceled"
	MethodExpired  = "expired"
	MethodFailed   = "failed"
)

const (
	// linkTimeout: a link still pending this long after it started failed
	// (the hosted session expires after 30 minutes).
	linkTimeout = 2 * time.Hour
	// savedChargeTTL: a renewal charge still pending this long is closed as
	// expired and the retry rules take over.
	savedChargeTTL = 24 * time.Hour
)

// LinkCustomer is the member as the Xendit customer object names them.
type LinkCustomer struct {
	ReferenceID string
	GivenNames  string
	Email       string
	Mobile      string // E.164, "" when unknown
}

// LinkRequest opens a SAVE session on the hosted page.
type LinkRequest struct {
	ReferenceID string
	// XenditCustomerID reuses the Xendit customer of an earlier link;
	// Customer is sent when it is "".
	XenditCustomerID string
	Customer         LinkCustomer
	SuccessURL       string
	CancelURL        string
	Channels         []string
}

// LinkSession is a SAVE session: URL is the hosted page, TokenID is set
// once the member completed it.
type LinkSession struct {
	ID         string
	URL        string
	Status     string // ACTIVE | COMPLETED | EXPIRED | CANCELED
	TokenID    string
	CustomerID string
}

// SavedToken is a payment token as we keep it: no card or account numbers.
type SavedToken struct {
	ID          string
	Status      string
	ChannelCode string
	Type        string // card | ewallet | other
	Label       string
}

// ChargeRequest charges a token for a purchase.
type ChargeRequest struct {
	ReferenceID string
	TokenID     string
	ChannelCode string
	Amount      float64
	Description string
}

// Charge is a payment request. Status: SUCCEEDED, FAILED, PENDING,
// REQUIRES_ACTION, ACCEPTING_PAYMENTS, CANCELED, EXPIRED. TokenInvalid
// means the token can no longer be charged.
type Charge struct {
	ID           string
	Status       string
	FailureCode  string
	TokenInvalid bool
}

// SavedMethodGateway is the provider of saved methods (Xendit Payments API).
type SavedMethodGateway interface {
	StartLink(ctx context.Context, cfg *XenditConfig, in LinkRequest) (*LinkSession, error)
	LinkStatus(ctx context.Context, cfg *XenditConfig, sessionID string) (*LinkSession, error)
	Token(ctx context.Context, cfg *XenditConfig, tokenID string) (*SavedToken, error)
	CancelToken(ctx context.Context, cfg *XenditConfig, tokenID string) error
	Charge(ctx context.Context, cfg *XenditConfig, in ChargeRequest) (*Charge, error)
	ChargeStatus(ctx context.Context, cfg *XenditConfig, requestID string) (*Charge, error)
	// CancelCharge stops a pending charge so it can no longer be paid.
	CancelCharge(ctx context.Context, cfg *XenditConfig, requestID string) error
}

// SavedMethod is a gym.member_payment_methods row.
type SavedMethod struct {
	ID               string
	CustomerID       string
	LinkReference    string
	SessionID        *string
	XenditCustomerID *string
	TokenID          *string
	ChannelCode      *string
	MethodType       *string
	Label            *string
	Status           string
	FailureCode      *string
	Simulated        bool
	LinkedAt         *time.Time
	CreatedAt        time.Time
}

// SavedMethodStore is the repository part for saved methods and renewal
// retries (postgres_saved_methods.go).
type SavedMethodStore interface {
	InsertSavedMethod(ctx context.Context, q database.Querier, customerID, reference string, simulated bool) (string, error)
	// SavedMethod finds one row by column (id, link_reference or token_id);
	// nil when none. lock holds it FOR UPDATE.
	SavedMethod(ctx context.Context, q database.Querier, column, value string, lock bool) (*SavedMethod, error)
	// SavedMethodsOf lists the member's active and pending methods, newest first.
	SavedMethodsOf(ctx context.Context, q database.Querier, customerID string) ([]SavedMethod, error)
	// LastXenditCustomer is the Xendit customer id of the member's latest link, "" when none.
	LastXenditCustomer(ctx context.Context, q database.Querier, customerID string) (string, error)
	SetLinkSession(ctx context.Context, q database.Querier, id, sessionID, xenditCustomerID string) error
	ActivateSavedMethod(ctx context.Context, q database.Querier, id string, t SavedToken) error
	SetSavedMethodDetails(ctx context.Context, q database.Querier, id string, t SavedToken) error
	CloseSavedMethod(ctx context.Context, q database.Querier, id, status, failureCode string) error
	// SwitchSavedRenewals moves the member's live passes renewing with a
	// saved method to invoice and returns their ids.
	SwitchSavedRenewals(ctx context.Context, q database.Querier, customerID string) ([]string, error)

	// FailedRenewals lists auto-renewing passes whose renewal purchase
	// failed or expired and that have no retry planned.
	FailedRenewals(ctx context.Context, q database.Querier) ([]RenewalState, error)
	// DueRenewalRetries lists auto-renewing passes whose retry is due at now.
	DueRenewalRetries(ctx context.Context, q database.Querier, now time.Time) ([]RenewalState, error)
	// ScheduleRenewalRetry plans the retry at `at` while purchaseID is still
	// the failed renewal purchase; false when another run changed the pass.
	ScheduleRenewalRetry(ctx context.Context, q database.Querier, id, purchaseID string, at time.Time) (bool, error)
	// ClaimRenewalRetry takes a due retry and returns the attempt number it
	// becomes; ok=false when it is gone or a renewal purchase is still live.
	ClaimRenewalRetry(ctx context.Context, q database.Querier, id string, now time.Time) (attempt int, ok bool, err error)
	// ReleaseRenewalRetry gives the attempt back and plans it at `at`.
	ReleaseRenewalRetry(ctx context.Context, q database.Querier, id string, at time.Time) error
	// StopAutoRenew turns auto-renew off with a reason; false when it was
	// already off.
	StopAutoRenew(ctx context.Context, q database.Querier, id, reason string) (bool, error)
	ClearRenewalPurchase(ctx context.Context, q database.Querier, id string) error
	// AutoRenewingPasses counts live passes with auto-renew on.
	AutoRenewingPasses(ctx context.Context, q database.Querier) (int, error)
}

// RenewalState is a pass with its renewal bookkeeping.
type RenewalState struct {
	PassRow
	Attempts          int
	RenewalPurchaseID string // the latest renewal purchase, "" when none
	RenewalStatus     string
}

/* ── Feature gate ────────────────────────────────────────────────────── */

// savedRail is the gateway and config saved methods run on.
type savedRail struct {
	cfg       *XenditConfig
	gw        SavedMethodGateway
	simulated bool
}

func savedMethodsFlagOn() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(SavedMethodsFlag))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// savedRail returns the rail for real (simulated=false) or simulated
// methods; ok=false when the gateway is inactive, or a simulated method is
// met outside local dev. It ignores the flag: methods and charges made
// before the flag went off still settle and cancel.
func (s *Service) savedRail(ctx context.Context, simulated bool) (savedRail, bool) {
	if s.ports.SavedMethods == nil {
		return savedRail{}, false
	}
	if simulated {
		return savedRail{gw: simulatedSavedMethods{}, simulated: true}, s.canSimulate()
	}
	cfg, err := s.ports.Gateway.ActiveConfig(ctx, s.db)
	if err != nil {
		return savedRail{}, false
	}
	return savedRail{cfg: cfg, gw: s.ports.SavedMethods}, true
}

// linkRail is the rail new links use while the flag is on: the real
// gateway, else the simulated one in local dev.
func (s *Service) linkRail(ctx context.Context) (savedRail, bool) {
	if !savedMethodsFlagOn() {
		return savedRail{}, false
	}
	if rail, ok := s.savedRail(ctx, false); ok {
		return rail, true
	}
	return s.savedRail(ctx, true)
}

// SavedMethodsEnabled reports whether members can link and renew with a saved method.
func (s *Service) SavedMethodsEnabled(ctx context.Context) bool {
	_, ok := s.linkRail(ctx)
	return ok
}

/* ── Member: list, link, unlink ──────────────────────────────────────── */

// SavedMethodView is a saved method as the member app shows it.
type SavedMethodView struct {
	ID        string  `json:"id"`
	Status    string  `json:"status"`
	Type      *string `json:"type"`
	Channel   *string `json:"channel"`
	Label     *string `json:"label"`
	Simulated bool    `json:"simulated"`
	LinkedAt  *JSTime `json:"linked_at"`
	CreatedAt JSTime  `json:"created_at"`
}

func savedMethodView(m SavedMethod) SavedMethodView {
	return SavedMethodView{
		ID: m.ID, Status: m.Status, Type: m.MethodType, Channel: m.ChannelCode, Label: m.Label,
		Simulated: m.Simulated, LinkedAt: jsTimePtr(m.LinkedAt), CreatedAt: JSTime(m.CreatedAt),
	}
}

// SavedMethodsView is the "Metode pembayaran" screen.
type SavedMethodsView struct {
	Enabled bool              `json:"enabled"`
	Methods []SavedMethodView `json:"methods"`
}

// SavedMethods lists the member's methods. Links still pending are asked
// about at Xendit first (the webhook can be late or lost) and closed once
// they ran out.
func (s *Service) SavedMethods(ctx context.Context, customerID string) (*SavedMethodsView, error) {
	rows, err := s.repo.SavedMethodsOf(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	out := &SavedMethodsView{Enabled: s.SavedMethodsEnabled(ctx), Methods: []SavedMethodView{}}
	for _, m := range rows {
		if m.Status == MethodPending {
			if err := s.refreshLink(ctx, m); err != nil {
				s.log.WarnContext(ctx, "[gym-credits] cek penautan gagal", "method_id", m.ID, "error", err)
			}
			current, err := s.repo.SavedMethod(ctx, s.db, "id", m.ID, false)
			if err != nil {
				return nil, err
			}
			m = *current
		}
		if m.Status == MethodActive || m.Status == MethodPending {
			out.Methods = append(out.Methods, savedMethodView(m))
		}
	}
	return out, nil
}

// refreshLink settles a pending link from the session status, or fails it
// once linkTimeout has passed.
func (s *Service) refreshLink(ctx context.Context, m SavedMethod) error {
	if s.clock().Sub(m.CreatedAt) > linkTimeout {
		return s.failLink(ctx, m.ID, "SESSION_EXPIRED")
	}
	rail, ok := s.savedRail(ctx, m.Simulated)
	if !ok || m.SessionID == nil {
		return nil
	}
	session, err := rail.gw.LinkStatus(ctx, rail.cfg, *m.SessionID)
	if err != nil {
		return err
	}
	return s.applyLinkStatus(ctx, m.ID, rail, session)
}

// applyLinkStatus activates a completed link or fails an expired one.
func (s *Service) applyLinkStatus(ctx context.Context, id string, rail savedRail, session *LinkSession) error {
	switch session.Status {
	case "COMPLETED":
		if session.TokenID == "" {
			return nil
		}
		return s.activateLink(ctx, id, rail, session.TokenID)
	case "EXPIRED", "CANCELED":
		return s.failLink(ctx, id, "SESSION_"+session.Status)
	}
	return nil
}

// activateLink stores the token of a completed link with its masked label.
// A member with another active method keeps that one: the newer token is
// canceled at Xendit.
func (s *Service) activateLink(ctx context.Context, id string, rail savedRail, tokenID string) error {
	token, err := rail.gw.Token(ctx, rail.cfg, tokenID)
	if err != nil {
		s.log.WarnContext(ctx, "[gym-credits] detail token gagal dibaca", "token", maskID(tokenID), "error", err)
		token = &SavedToken{}
	}
	token.ID = tokenID
	if token.Label == "" {
		token.Type, token.Label = methodLabel(token.ChannelCode, nil)
	}
	var duplicate bool
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := s.repo.SavedMethod(ctx, tx, "id", id, true)
		if err != nil || m == nil || m.Status != MethodPending {
			return err
		}
		if _, _, err := s.ports.Members.LockForPurchase(ctx, tx, m.CustomerID); err != nil {
			return err
		}
		active, err := s.repo.SavedMethodsOf(ctx, tx, m.CustomerID)
		if err != nil {
			return err
		}
		for _, other := range active {
			if other.Status == MethodActive {
				duplicate = true
				return s.repo.CloseSavedMethod(ctx, tx, id, MethodFailed, "ALREADY_LINKED")
			}
		}
		if err := s.repo.ActivateSavedMethod(ctx, tx, id, *token); err != nil {
			return err
		}
		return s.ports.Notifier.NotifyMember(ctx, tx, m.CustomerID, Notice{
			Type: "gym_payment_method", Title: "Metode pembayaran tersimpan",
			Body: token.Label + " siap dipakai untuk perpanjangan otomatis.",
		})
	})
	if err == nil && duplicate {
		if cancelErr := rail.gw.CancelToken(ctx, rail.cfg, tokenID); cancelErr != nil {
			s.log.WarnContext(ctx, "[gym-credits] token ganda gagal dilepas", "token", maskID(tokenID), "error", cancelErr)
		}
	}
	return err
}

func (s *Service) failLink(ctx context.Context, id, code string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := s.repo.SavedMethod(ctx, tx, "id", id, true)
		if err != nil || m == nil || m.Status != MethodPending {
			return err
		}
		return s.repo.CloseSavedMethod(ctx, tx, id, MethodFailed, code)
	})
}

// LinkStartView is where the member goes to link a method.
type LinkStartView struct {
	Method      SavedMethodView `json:"method"`
	RedirectURL string          `json:"redirect_url"`
}

// StartLink opens the Xendit hosted page for the member to save a card or
// e-wallet. returnURL(id, outcome) is the member app page Xendit sends
// them back to. The simulated rail links a test card at once.
func (s *Service) StartLink(ctx context.Context, customerID string, returnURL func(id, outcome string) string) (*LinkStartView, error) {
	rail, ok := s.linkRail(ctx)
	if !ok {
		return nil, fail(http.StatusServiceUnavailable, "Metode pembayaran tersimpan belum tersedia")
	}
	reference := PaymentMethodRefPrefix + randomHex(12)
	var id, xenditCustomer string
	var customer LinkCustomer
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		active, found, err := s.ports.Members.LockForPurchase(ctx, tx, customerID)
		if err != nil {
			return err
		}
		if !found || !active {
			return fail(http.StatusConflict, "Akun member tidak aktif")
		}
		methods, err := s.repo.SavedMethodsOf(ctx, tx, customerID)
		if err != nil {
			return err
		}
		for _, m := range methods {
			if m.Status == MethodActive {
				return fail(http.StatusConflict, "Hapus metode pembayaran yang tersimpan dulu sebelum menautkan yang baru")
			}
		}
		if xenditCustomer, err = s.repo.LastXenditCustomer(ctx, tx, customerID); err != nil {
			return err
		}
		if id, err = s.repo.InsertSavedMethod(ctx, tx, customerID, reference, rail.simulated); err != nil {
			return err
		}
		profile, err := s.ports.Members.Profile(ctx, tx, customerID)
		if err != nil {
			return err
		}
		customer = linkCustomer(customerID, profile)
		return nil
	})
	if err != nil {
		return nil, err
	}
	session, err := rail.gw.StartLink(ctx, rail.cfg, LinkRequest{
		ReferenceID: reference, XenditCustomerID: xenditCustomer, Customer: customer,
		SuccessURL: returnURL(id, "linked"), CancelURL: returnURL(id, "canceled"), Channels: savedMethodChannels(),
	})
	if err != nil {
		if failErr := s.failLink(ctx, id, "SESSION_NOT_CREATED"); failErr != nil {
			s.log.ErrorContext(ctx, "[gym-credits] tutup penautan gagal", "method_id", id, "error", failErr)
		}
		return nil, fail(http.StatusBadGateway, "Gagal membuka halaman penautan: "+err.Error())
	}
	if err := s.repo.SetLinkSession(ctx, s.db, id, session.ID, session.CustomerID); err != nil {
		return nil, err
	}
	if rail.simulated {
		if err := s.activateLink(ctx, id, rail, session.TokenID); err != nil {
			return nil, err
		}
	}
	m, err := s.repo.SavedMethod(ctx, s.db, "id", id, false)
	if err != nil {
		return nil, err
	}
	return &LinkStartView{Method: savedMethodView(*m), RedirectURL: session.URL}, nil
}

// linkCustomer names the member for Xendit: our customer id as the
// reference, and the email and phone only when Xendit accepts their form.
func linkCustomer(customerID string, p *MemberProfile) LinkCustomer {
	c := LinkCustomer{ReferenceID: customerID, GivenNames: "Member"}
	if p == nil {
		return c
	}
	if p.Name != nil && strings.TrimSpace(*p.Name) != "" {
		c.GivenNames = strings.TrimSpace(*p.Name)
	}
	if p.Email != nil && len(*p.Email) <= 50 && strings.Contains(*p.Email, "@") {
		c.Email = strings.TrimSpace(*p.Email)
	}
	c.Mobile = e164(p.Phone)
	return c
}

// e164 turns an Indonesian phone (08…, 628…, +628…) into +62…; "" when
// it is anything else.
func e164(phone string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		if r == ' ' || r == '-' || r == '+' {
			return -1
		}
		return 'x'
	}, strings.TrimSpace(phone))
	switch {
	case strings.Contains(digits, "x"):
		return ""
	case strings.HasPrefix(digits, "0"):
		digits = "62" + digits[1:]
	case !strings.HasPrefix(digits, "62"):
		return ""
	}
	if len(digits) < 9 || len(digits) > 15 {
		return ""
	}
	return "+" + digits
}

func savedMethodChannels() []string {
	var out []string
	for _, c := range strings.Split(os.Getenv(SavedMethodChannelsEnv), ",") {
		if c = strings.ToUpper(strings.TrimSpace(c)); c != "" {
			out = append(out, c)
		}
	}
	return out
}

// UnlinkSavedMethod removes the member's method: the token is canceled at
// Xendit and the passes renewing with it switch to invoice.
func (s *Service) UnlinkSavedMethod(ctx context.Context, customerID, id string) (*SavedMethodView, error) {
	m, err := s.repo.SavedMethod(ctx, s.db, "id", id, false)
	if err != nil {
		return nil, err
	}
	if m == nil || m.CustomerID != customerID || (m.Status != MethodActive && m.Status != MethodPending) {
		return nil, fail(http.StatusNotFound, "Metode pembayaran tidak ditemukan")
	}
	if m.TokenID != nil {
		if rail, ok := s.savedRail(ctx, m.Simulated); ok {
			if err := rail.gw.CancelToken(ctx, rail.cfg, *m.TokenID); err != nil {
				// The row closes anyway: a canceled method is never charged.
				s.log.WarnContext(ctx, "[gym-credits] token gagal dilepas di Xendit", "method_id", m.ID, "error", err)
			}
		}
	}
	if err := s.closeSavedMethod(ctx, m.ID, MethodCanceled, "", ""); err != nil {
		return nil, err
	}
	if m, err = s.repo.SavedMethod(ctx, s.db, "id", id, false); err != nil {
		return nil, err
	}
	view := savedMethodView(*m)
	return &view, nil
}

// closeSavedMethod ends a method and moves the passes renewing with it to
// invoice, logged on each pass; notice (non-empty) tells the member why.
func (s *Service) closeSavedMethod(ctx context.Context, id, status, failureCode, notice string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		m, err := s.repo.SavedMethod(ctx, tx, "id", id, true)
		if err != nil || m == nil || (m.Status != MethodActive && m.Status != MethodPending) {
			return err
		}
		if err := s.repo.CloseSavedMethod(ctx, tx, id, status, failureCode); err != nil {
			return err
		}
		if m.Status != MethodActive {
			return nil
		}
		passes, err := s.repo.SwitchSavedRenewals(ctx, tx, m.CustomerID)
		if err != nil {
			return err
		}
		for _, passID := range passes {
			if err := s.repo.InsertPassEvent(ctx, tx, PassEvent{
				PassID: passID, CustomerID: m.CustomerID, Kind: EventAutoRenew,
				Meta: map[string]any{"auto_renew": true, "renew_with": RenewWithInvoice, "reason": "saved_method_" + status},
			}); err != nil {
				return err
			}
		}
		if notice == "" {
			return nil
		}
		return s.ports.Notifier.NotifyMember(ctx, tx, m.CustomerID, Notice{
			Type: "gym_payment_method", Title: "Metode pembayaran tidak aktif", Body: notice,
		})
	})
}

// activeSavedMethod is the member's method a renewal can charge, with its
// rail; ok=false when there is none or saved methods are off.
func (s *Service) activeSavedMethod(ctx context.Context, q database.Querier, customerID string) (*SavedMethod, savedRail, bool, error) {
	if !savedMethodsFlagOn() {
		return nil, savedRail{}, false, nil
	}
	methods, err := s.repo.SavedMethodsOf(ctx, q, customerID)
	if err != nil {
		return nil, savedRail{}, false, err
	}
	for i := range methods {
		m := &methods[i]
		if m.Status != MethodActive || m.TokenID == nil {
			continue
		}
		rail, ok := s.savedRail(ctx, m.Simulated)
		return m, rail, ok, nil
	}
	return nil, savedRail{}, false, nil
}

/* ── Charging ────────────────────────────────────────────────────────── */

// BuyWithSavedMethod buys a package by charging the member's saved method
// (the renewal sweep does this without the member). A declined charge
// returns the purchase closed as failed, not an error; gateway outages are
// errors.
func (s *Service) BuyWithSavedMethod(ctx context.Context, in MemberPurchase, m *SavedMethod, rail savedRail) (*MemberPurchaseView, error) {
	var charge *Charge
	view, err := s.startPendingPurchase(ctx, in, PaySavedMethod, func(purchase *Purchase, referenceID string) (map[string]any, error) {
		c, err := rail.gw.Charge(ctx, rail.cfg, ChargeRequest{
			ReferenceID: referenceID, TokenID: *m.TokenID, ChannelCode: deref(m.ChannelCode),
			Amount: purchase.TotalIdr, Description: "Paket " + purchase.PackageName,
		})
		if err != nil {
			return nil, err
		}
		charge = c
		meta := map[string]any{
			"provider": "xendit_payment_request", "payment_request_id": nil, "payment_method_id": m.ID,
			"payment_method_label": deref(m.Label), "charge_status": c.Status,
			"expires_at": isoString(s.clock().Add(savedChargeTTL)), "simulated": rail.simulated,
		}
		if c.ID != "" {
			meta["payment_request_id"] = c.ID
		}
		if c.FailureCode != "" {
			meta["failure_code"] = c.FailureCode
		}
		return meta, nil
	})
	if err != nil || charge == nil {
		return view, err
	}
	if charge.TokenInvalid {
		if err := s.closeSavedMethod(ctx, m.ID, MethodExpired, charge.FailureCode,
			deref(m.Label)+" tidak bisa ditagih lagi. Tautkan ulang di menu Metode pembayaran, perpanjangan berikutnya memakai invoice."); err != nil {
			return nil, err
		}
	}
	settled, err := s.applyCharge(ctx, view.ID, charge, false)
	if err != nil || settled == nil {
		return view, err
	}
	return memberPurchaseView(settled), nil
}

// applyCharge settles a succeeded charge or closes a failed one; nil while
// it is still pending.
func (s *Service) applyCharge(ctx context.Context, purchaseID string, c *Charge, reconciled bool) (*Purchase, error) {
	switch c.Status {
	case "SUCCEEDED":
		var settled *Purchase
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			var err error
			_, settled, err = s.markPaid(ctx, tx, purchaseID, map[string]any{"charge_status": c.Status, "reconciled": reconciled})
			return err
		})
		return settled, err
	case "FAILED", "CANCELED", "EXPIRED":
		if err := s.closePurchase(ctx, purchaseID, "failed"); err != nil {
			return nil, err
		}
		return s.repo.Purchase(ctx, s.db, purchaseID, false)
	}
	return nil, nil
}

// reconcileCharge asks Xendit about a pending saved-method charge. One
// still pending past its expires_at is canceled at Xendit first and only
// then closed as expired; nil means it stays pending.
func (s *Service) reconcileCharge(ctx context.Context, row *Purchase, requestID string) (*Purchase, error) {
	meta := row.meta()
	simulated, _ := meta["simulated"].(bool)
	rail, ok := s.savedRail(ctx, simulated)
	if !ok {
		return nil, errors.New("no Xendit gateway for the saved-method charge")
	}
	c, err := rail.gw.ChargeStatus(ctx, rail.cfg, requestID)
	if err != nil {
		return nil, err
	}
	expiresAt, _ := time.Parse(time.RFC3339Nano, jsString(meta["expires_at"]))
	if settled, err := s.applyCharge(ctx, row.ID, c, true); err != nil || settled != nil || expiresAt.IsZero() || expiresAt.After(s.clock()) {
		return settled, err
	}
	if err := rail.gw.CancelCharge(ctx, rail.cfg, requestID); err != nil {
		return nil, err
	}
	if err := s.closePurchase(ctx, row.ID, "expired"); err != nil {
		return nil, err
	}
	return s.repo.Purchase(ctx, s.db, row.ID, false)
}

/* ── Gateway events (Xendit webhook) ─────────────────────────────────── */

// GatewayEvent is a Xendit Payments API webhook the integrations webhook
// verified (callback token) and handed over: payment_session.*,
// payment_token.* or payment.failure. Data is the event's data object.
type GatewayEvent struct {
	Event       string
	Status      string
	ReferenceID string
	SessionID   string
	TokenID     string
	FailureCode string
	Data        map[string]any
}

// GatewayEventResult is what the webhook answers.
type GatewayEventResult struct {
	Status string `json:"status"` // linked | link_failed | token_updated | token_closed | payment_failed | ignored | not_found
	ID     string `json:"id,omitempty"`
}

// HandleGatewayEvent applies a Payments API webhook. A completed SAVE
// session is confirmed with Xendit (GET /sessions/{id}) before the token is
// stored, so a replayed or forged body cannot attach a token.
func (s *Service) HandleGatewayEvent(ctx context.Context, ev GatewayEvent) (*GatewayEventResult, error) {
	switch {
	case strings.HasPrefix(ev.Event, "payment_session."):
		return s.sessionEvent(ctx, ev)
	case strings.HasPrefix(ev.Event, "payment_token."):
		return s.tokenEvent(ctx, ev)
	case ev.Event == "payment.failure" || (strings.HasPrefix(ev.Event, "payment.") && ev.Status == "FAILED"):
		return s.paymentFailed(ctx, ev)
	}
	return &GatewayEventResult{Status: "ignored"}, nil
}

func (s *Service) sessionEvent(ctx context.Context, ev GatewayEvent) (*GatewayEventResult, error) {
	if !strings.HasPrefix(ev.ReferenceID, PaymentMethodRefPrefix) {
		return &GatewayEventResult{Status: "ignored"}, nil
	}
	m, err := s.repo.SavedMethod(ctx, s.db, "link_reference", ev.ReferenceID, false)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return &GatewayEventResult{Status: "not_found"}, nil
	}
	if ev.Event == "payment_session.expired" {
		return &GatewayEventResult{Status: "link_failed", ID: m.ID}, s.failLink(ctx, m.ID, "SESSION_EXPIRED")
	}
	rail, ok := s.savedRail(ctx, m.Simulated)
	if !ok || m.SessionID == nil || *m.SessionID != ev.SessionID {
		return &GatewayEventResult{Status: "ignored", ID: m.ID}, nil
	}
	session, err := rail.gw.LinkStatus(ctx, rail.cfg, ev.SessionID)
	if err != nil {
		return nil, err
	}
	if err := s.applyLinkStatus(ctx, m.ID, rail, session); err != nil {
		return nil, err
	}
	return &GatewayEventResult{Status: "linked", ID: m.ID}, nil
}

func (s *Service) tokenEvent(ctx context.Context, ev GatewayEvent) (*GatewayEventResult, error) {
	if ev.TokenID == "" {
		return &GatewayEventResult{Status: "ignored"}, nil
	}
	m, err := s.repo.SavedMethod(ctx, s.db, "token_id", ev.TokenID, false)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return &GatewayEventResult{Status: "not_found"}, nil
	}
	switch ev.Event {
	case "payment_token.activation":
		token := TokenFromPayload(ev.Data)
		if token.ChannelCode == "" || m.Status != MethodActive {
			return &GatewayEventResult{Status: "ignored", ID: m.ID}, nil
		}
		return &GatewayEventResult{Status: "token_updated", ID: m.ID}, s.repo.SetSavedMethodDetails(ctx, s.db, m.ID, *token)
	case "payment_token.expiry", "payment_token.failure":
		status := MethodExpired
		if ev.Event == "payment_token.failure" {
			status = MethodFailed
		}
		err := s.closeSavedMethod(ctx, m.ID, status, ev.FailureCode,
			deref(m.Label)+" tidak aktif lagi. Tautkan ulang di menu Metode pembayaran, perpanjangan berikutnya memakai invoice.")
		return &GatewayEventResult{Status: "token_closed", ID: m.ID}, err
	}
	return &GatewayEventResult{Status: "ignored", ID: m.ID}, nil
}

// paymentFailed closes the pending saved-method purchase of a failed
// charge; the renewal sweep then plans the retry.
func (s *Service) paymentFailed(ctx context.Context, ev GatewayEvent) (*GatewayEventResult, error) {
	if !IsGymPurchaseReference(ev.ReferenceID) {
		return &GatewayEventResult{Status: "ignored"}, nil
	}
	id, err := s.repo.PurchaseIDByReference(ctx, s.db, ev.ReferenceID)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return &GatewayEventResult{Status: "not_found"}, nil
	}
	p, err := s.repo.Purchase(ctx, s.db, id, false)
	if err != nil {
		return nil, err
	}
	if p.Status != "pending" || deref(p.PaymentMethod) != PaySavedMethod {
		return &GatewayEventResult{Status: "ignored", ID: id}, nil
	}
	if err := s.closePurchase(ctx, id, "failed"); err != nil {
		return nil, err
	}
	return &GatewayEventResult{Status: "payment_failed", ID: id}, nil
}

// maskID shortens a gateway id for logs: tokens and payment ids are never
// logged in full.
func maskID(id string) string {
	if len(id) <= 8 {
		return "…"
	}
	return id[:8] + "…"
}
