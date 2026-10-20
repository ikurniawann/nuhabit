package gymcredits

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Saved payment methods on Xendit's Payments API (docs: backend/docs/XENDIT_SAVED_METHODS.md).
// The member links a card or e-wallet on the Xendit hosted page of a
// Payment Session with session_type SAVE; the card number never reaches
// us. Renewals then charge the payment token with a v3 payment request.

var _ SavedMethodGateway = (*XenditGateway)(nil)

// paymentsAPIVersion is the api-version of the /v3 payment request and
// payment token endpoints. /sessions takes none.
const paymentsAPIVersion = "2024-11-11"

// cardRecurringYears is how long a saved card may be charged for renewals.
const cardRecurringYears = 5

// xenditFailure is the error_code of a non-2xx Xendit answer, else its HTTP status.
func xenditFailure(status int, raw any) string {
	payload, _ := raw.(map[string]any)
	if code := jsString(payload["error_code"]); code != "" {
		return code
	}
	return fmt.Sprintf("HTTP_%d", status)
}

// StartLink creates the SAVE session (POST /sessions, mode PAYMENT_LINK).
func (g *XenditGateway) StartLink(ctx context.Context, cfg *XenditConfig, in LinkRequest) (*LinkSession, error) {
	body := map[string]any{
		"reference_id":       in.ReferenceID,
		"session_type":       "SAVE",
		"mode":               "PAYMENT_LINK",
		"amount":             0,
		"currency":           "IDR",
		"country":            "ID",
		"locale":             "id",
		"success_return_url": in.SuccessURL,
		"cancel_return_url":  in.CancelURL,
		"channel_properties": map[string]any{"cards": map[string]any{
			"card_on_file_type": "RECURRING",
			"recurring_configuration": map[string]any{
				"recurring_frequency": 30,
				"recurring_expiry":    time.Now().AddDate(cardRecurringYears, 0, 0).Format(time.DateOnly),
			},
		}},
	}
	if in.XenditCustomerID != "" {
		body["customer_id"] = in.XenditCustomerID
	} else {
		customer := map[string]any{
			"reference_id": in.Customer.ReferenceID, "type": "INDIVIDUAL",
			"individual_detail": map[string]any{"given_names": in.Customer.GivenNames},
		}
		if in.Customer.Email != "" {
			customer["email"] = in.Customer.Email
		}
		if in.Customer.Mobile != "" {
			customer["mobile_number"] = in.Customer.Mobile
		}
		body["customer"] = customer
	}
	if len(in.Channels) > 0 {
		body["allowed_payment_channels"] = in.Channels
	}
	status, raw, err := g.send(ctx, http.MethodPost, "/sessions", cfg.SecretKey, "", nil, body)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("Xendit menolak sesi penautan (%s)", xenditFailure(status, raw))
	}
	session := parseSession(raw)
	if session.ID == "" || session.URL == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	return session, nil
}

// LinkStatus reads a session (GET /sessions/{id}).
func (g *XenditGateway) LinkStatus(ctx context.Context, cfg *XenditConfig, sessionID string) (*LinkSession, error) {
	status, raw, err := g.send(ctx, http.MethodGet, "/sessions/"+url.PathEscape(sessionID), cfg.SecretKey, "", nil, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("Gagal membaca sesi penautan (%s)", xenditFailure(status, raw))
	}
	return parseSession(raw), nil
}

func parseSession(raw any) *LinkSession {
	payload, _ := raw.(map[string]any)
	token := jsString(payload["payment_token_id"])
	if token == "" {
		token = jsString(payload["latest_payment_token_id"])
	}
	return &LinkSession{
		ID: jsString(payload["payment_session_id"]), URL: jsString(payload["payment_link_url"]),
		Status: strings.ToUpper(jsString(payload["status"])), TokenID: token, CustomerID: jsString(payload["customer_id"]),
	}
}

// Token reads a payment token (GET /v3/payment_tokens/{id}) for its label.
func (g *XenditGateway) Token(ctx context.Context, cfg *XenditConfig, tokenID string) (*SavedToken, error) {
	status, raw, err := g.send(ctx, http.MethodGet, "/v3/payment_tokens/"+url.PathEscape(tokenID), cfg.SecretKey, paymentsAPIVersion, nil, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("Gagal membaca token pembayaran (%s)", xenditFailure(status, raw))
	}
	payload, _ := raw.(map[string]any)
	return TokenFromPayload(payload), nil
}

// TokenFromPayload reads a payment token object (API answer or webhook
// data): the channel, its kind and a masked label. Nothing else is kept.
func TokenFromPayload(data map[string]any) *SavedToken {
	channel := strings.ToUpper(jsString(data["channel_code"]))
	t := &SavedToken{ID: jsString(data["payment_token_id"]), Status: strings.ToUpper(jsString(data["status"])), ChannelCode: channel}
	t.Type, t.Label = methodLabel(channel, data)
	return t
}

// ewalletNames are the Indonesian e-wallets Xendit links, by channel code.
var ewalletNames = map[string]string{
	"OVO": "OVO", "DANA": "DANA", "SHOPEEPAY": "ShopeePay", "LINKAJA": "LinkAja",
	"ASTRAPAY": "AstraPay", "JENIUSPAY": "Jenius Pay", "GOPAY": "GoPay",
}

// methodLabel is the masked label of a token: "VISA •••• 1005" for a card
// (last four digits only), the wallet name for an e-wallet.
func methodLabel(channel string, data map[string]any) (kind, label string) {
	if channel == "CARDS" {
		props, _ := data["channel_properties"].(map[string]any)
		card, _ := props["card_details"].(map[string]any)
		network := strings.ToUpper(jsString(card["network"]))
		if network == "" {
			network = "Kartu"
		}
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, jsString(card["masked_card_number"]))
		if len(digits) >= 4 {
			return "card", network + " •••• " + digits[len(digits)-4:]
		}
		return "card", network
	}
	if name, ok := ewalletNames[channel]; ok {
		return "ewallet", name
	}
	if channel == "" {
		return "other", "Metode tersimpan"
	}
	return "other", channel
}

// CancelToken deactivates a token (POST /v3/payment_tokens/{id}/cancel).
func (g *XenditGateway) CancelToken(ctx context.Context, cfg *XenditConfig, tokenID string) error {
	status, raw, err := g.send(ctx, http.MethodPost, "/v3/payment_tokens/"+url.PathEscape(tokenID)+"/cancel", cfg.SecretKey, paymentsAPIVersion, nil, map[string]any{})
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("Gagal melepas token pembayaran (%s)", xenditFailure(status, raw))
	}
	return nil
}

// tokenGone are the charge errors that mean the token cannot be charged
// again until the member links the method anew.
var tokenGone = map[string]bool{"INVALID_TOKEN": true, "ACCOUNT_ACCESS_BLOCKED": true, "TOKEN_NOT_ACTIVE": true}

// Charge pays with a token (POST /v3/payment_requests, type PAY). A 4xx
// answer is a declined charge, not an error: retrying the same request
// would fail the same way. Network and 5xx failures are errors.
func (g *XenditGateway) Charge(ctx context.Context, cfg *XenditConfig, in ChargeRequest) (*Charge, error) {
	body := map[string]any{
		"reference_id":     in.ReferenceID,
		"type":             "PAY",
		"country":          "ID",
		"currency":         "IDR",
		"request_amount":   math.Round(in.Amount),
		"capture_method":   "AUTOMATIC",
		"payment_token_id": in.TokenID,
		"description":      in.Description,
	}
	if in.ChannelCode == "CARDS" {
		body["channel_properties"] = map[string]any{"card_on_file_type": "RECURRING"}
	}
	status, raw, err := g.send(ctx, http.MethodPost, "/v3/payment_requests", cfg.SecretKey, paymentsAPIVersion,
		map[string]string{"idempotency-key": in.ReferenceID}, body)
	if err != nil {
		return nil, err
	}
	if status >= 500 {
		return nil, fmt.Errorf("Xendit tidak bisa memproses pembayaran (%s)", xenditFailure(status, raw))
	}
	if status > 299 {
		code := xenditFailure(status, raw)
		return &Charge{Status: "FAILED", FailureCode: code, TokenInvalid: tokenGone[code]}, nil
	}
	return parseCharge(raw), nil
}

// ChargeStatus reads a payment request (GET /v3/payment_requests/{id}).
func (g *XenditGateway) ChargeStatus(ctx context.Context, cfg *XenditConfig, requestID string) (*Charge, error) {
	status, raw, err := g.send(ctx, http.MethodGet, "/v3/payment_requests/"+url.PathEscape(requestID), cfg.SecretKey, paymentsAPIVersion, nil, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("Gagal membaca status pembayaran (%s)", xenditFailure(status, raw))
	}
	return parseCharge(raw), nil
}

func parseCharge(raw any) *Charge {
	payload, _ := raw.(map[string]any)
	return &Charge{
		ID: jsString(payload["payment_request_id"]), Status: strings.ToUpper(jsString(payload["status"])),
		FailureCode: jsString(payload["failure_code"]),
	}
}

// simulatedSavedMethods is the local-dev rail (no active gateway, dev
// bypass on): linking completes at once with a test card and every charge
// succeeds. It never calls Xendit.
type simulatedSavedMethods struct{}

var _ SavedMethodGateway = simulatedSavedMethods{}

const simulatedLabel = "Kartu simulasi •••• 1111"

func (simulatedSavedMethods) StartLink(_ context.Context, _ *XenditConfig, in LinkRequest) (*LinkSession, error) {
	return &LinkSession{ID: "sim-ps-" + in.ReferenceID, URL: in.SuccessURL, Status: "COMPLETED", TokenID: "sim-pt-" + randomHex(12)}, nil
}

func (simulatedSavedMethods) LinkStatus(_ context.Context, _ *XenditConfig, sessionID string) (*LinkSession, error) {
	return &LinkSession{ID: sessionID, Status: "COMPLETED", TokenID: "sim-pt-" + randomHex(12)}, nil
}

func (simulatedSavedMethods) Token(_ context.Context, _ *XenditConfig, tokenID string) (*SavedToken, error) {
	return &SavedToken{ID: tokenID, Status: "ACTIVE", ChannelCode: "CARDS", Type: "card", Label: simulatedLabel}, nil
}

func (simulatedSavedMethods) CancelToken(context.Context, *XenditConfig, string) error { return nil }

func (simulatedSavedMethods) Charge(_ context.Context, _ *XenditConfig, in ChargeRequest) (*Charge, error) {
	return &Charge{ID: "sim-pr-" + in.ReferenceID, Status: "SUCCEEDED"}, nil
}

func (simulatedSavedMethods) ChargeStatus(_ context.Context, _ *XenditConfig, requestID string) (*Charge, error) {
	return &Charge{ID: requestID, Status: "SUCCEEDED"}, nil
}
