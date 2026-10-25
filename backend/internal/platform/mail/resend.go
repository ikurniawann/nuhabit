package mail

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// DefaultResendURL is Resend's send endpoint.
const DefaultResendURL = "https://api.resend.com/emails"

// Resend sends through Resend's HTTP API (POST /emails with a Bearer key).
type Resend struct {
	APIKey string
	// URL overrides the endpoint (tests).
	URL    string
	Client *http.Client
}

func (r *Resend) Name() string { return ProviderResend }

type resendAttachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

func (r *Resend) Send(ctx context.Context, m Message) (string, error) {
	if r.APIKey == "" {
		return "", errors.New("Resend: API key kosong")
	}
	body := struct {
		From        string             `json:"from"`
		To          []string           `json:"to"`
		Subject     string             `json:"subject"`
		HTML        string             `json:"html"`
		Attachments []resendAttachment `json:"attachments,omitempty"`
	}{From: formatAddress(m.From, m.FromName), To: []string{m.To}, Subject: m.Subject, HTML: m.HTML}
	for _, a := range m.Attachments {
		body.Attachments = append(body.Attachments, resendAttachment{Filename: a.Filename, Content: base64.StdEncoding.EncodeToString(a.Content)})
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := r.URL
	if url == "" {
		url = DefaultResendURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := httpClient(r.Client).Do(req)
	if err != nil {
		return "", Transient(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode/100 != 2 {
		var e struct {
			Message string `json:"message"`
			Name    string `json:"name"`
		}
		_ = json.Unmarshal(raw, &e)
		detail := e.Message
		if e.Name != "" {
			detail = e.Name + ": " + e.Message
		}
		if detail == "" {
			detail = http.StatusText(res.StatusCode)
		}
		return "", httpError("Resend", res.StatusCode, detail)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.ID == "" {
		return "", errors.New("Resend: respons tanpa id email")
	}
	return out.ID, nil
}
