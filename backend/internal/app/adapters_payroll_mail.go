package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/payroll"
)

type resendPayslipMailer struct {
	apiKey string
	client *http.Client
	url    string
}

type resendAttachment struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

var _ payroll.PayslipMailer = (*resendPayslipMailer)(nil)

func (m *resendPayslipMailer) SendPayslip(ctx context.Context, to, from, subject, html, filename string, pdf []byte) (string, error) {
	if strings.TrimSpace(m.apiKey) == "" {
		return "", fmt.Errorf("RESEND_API_KEY is missing")
	}
	payload, err := json.Marshal(struct {
		From        string             `json:"from"`
		To          []string           `json:"to"`
		Subject     string             `json:"subject"`
		HTML        string             `json:"html"`
		Attachments []resendAttachment `json:"attachments"`
	}{From: from, To: []string{to}, Subject: subject, HTML: html, Attachments: []resendAttachment{{Filename: filename, Content: base64.StdEncoding.EncodeToString(pdf)}}})
	if err != nil {
		return "", err
	}
	url := m.url
	if url == "" {
		url = "https://api.resend.com/emails"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := m.client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return "", fmt.Errorf("resend returned status %d", res.StatusCode)
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil {
		return "", err
	}
	if response.ID == "" {
		return "", fmt.Errorf("resend response has no email id")
	}
	return response.ID, nil
}
