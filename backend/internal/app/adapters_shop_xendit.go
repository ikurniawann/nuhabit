package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// xenditInvoices is lib/xendit/client.ts (the invoice half) for the shop
// storefront and the public ticket booking: XENDIT_SECRET_KEY, the dev-only
// XENDIT_MOCK=1 mode, and the XENDIT_WEBHOOK_TOKEN callback check. The
// modules adapt it to their own Payments ports.
type xenditInvoices struct {
	getenv func(string) string
	log    *slog.Logger
	url    string
	client *http.Client
}

const xenditInvoiceExpiryHours = 2

func newXenditInvoices(getenv func(string) string, log *slog.Logger) xenditInvoices {
	return xenditInvoices{getenv: getenv, log: log, url: "https://api.xendit.co/v2/invoices", client: &http.Client{Timeout: 15 * time.Second}}
}

// mock is isXenditMock; mock mode left on in production is shouted about.
func (x xenditInvoices) mock() bool {
	on := x.getenv("XENDIT_MOCK") == "1"
	if on && (x.getenv("NODE_ENV") == "production" || x.getenv("APP_ENV") == "production") {
		x.log.Error("[xendit] PERINGATAN: XENDIT_MOCK=1 aktif di production — invoice palsu, pembayaran nyata TIDAK berjalan")
	}
	return on
}

// configured is isXenditConfigured.
func (x xenditInvoices) configured() bool { return x.getenv("XENDIT_SECRET_KEY") != "" || x.mock() }

// validWebhookToken is isValidWebhookToken: safeEqual with
// XENDIT_WEBHOOK_TOKEN (SHA-256 both sides, constant time, empty never
// matches).
func (x xenditInvoices) validWebhookToken(token string) bool {
	expected := x.getenv("XENDIT_WEBHOOK_TOKEN")
	if token == "" || expected == "" {
		return false
	}
	a, b := sha256.Sum256([]byte(token)), sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

type xenditInvoice struct {
	id, url   string
	expiresAt time.Time
}

// create is createInvoice.
func (x xenditInvoices) create(ctx context.Context, externalID string, amount float64, payerName, description, redirectURL string) (xenditInvoice, error) {
	expiresAt := time.Now().Add(xenditInvoiceExpiryHours * time.Hour)
	if x.mock() {
		return xenditInvoice{id: "mock-" + externalID, url: redirectURL, expiresAt: expiresAt}, nil
	}
	secret := x.getenv("XENDIT_SECRET_KEY")
	if secret == "" {
		return xenditInvoice{}, errors.New("XENDIT_SECRET_KEY belum dikonfigurasi")
	}
	body, _ := json.Marshal(map[string]any{
		"external_id":          externalID,
		"amount":               amount,
		"description":          description,
		"invoice_duration":     xenditInvoiceExpiryHours * 60 * 60,
		"success_redirect_url": redirectURL,
		"failure_redirect_url": redirectURL,
		"currency":             "IDR",
		"customer":             map[string]string{"given_names": payerName},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, x.url, bytes.NewReader(body))
	if err != nil {
		return xenditInvoice{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret+":")))
	res, err := x.client.Do(req)
	if err != nil {
		return xenditInvoice{}, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		if len(raw) > 300 {
			raw = raw[:300]
		}
		return xenditInvoice{}, fmt.Errorf("Xendit menolak pembuatan invoice (HTTP %d): %s", res.StatusCode, raw)
	}
	var data struct {
		ID         string `json:"id"`
		InvoiceURL string `json:"invoice_url"`
		ExpiryDate string `json:"expiry_date"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return xenditInvoice{}, err
	}
	inv := xenditInvoice{id: data.ID, url: data.InvoiceURL, expiresAt: expiresAt}
	if data.ExpiryDate != "" {
		if t, err := time.Parse(time.RFC3339Nano, data.ExpiryDate); err == nil {
			inv.expiresAt = t
		}
	}
	return inv, nil
}
