package advance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// Gateway is the self-hosted WhatsApp gateway (services/wa-gateway), as
// lib/whatsapp/gateway.ts calls it.
type Gateway struct {
	BaseURL, Token string
	Timeout        time.Duration
	Client         *http.Client
}

// SendText mirrors sendGatewayText: POST {baseUrl}/send. It never fails;
// the reason says why a message was not sent.
func (g *Gateway) SendText(ctx context.Context, target, message string) (bool, string) {
	ctx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	body, _ := json.Marshal(struct {
		Target  string `json:"target"`
		Message string `json:"message"`
	}{target, message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.BaseURL+"/send", bytes.NewReader(body))
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", g.Token)
	client := g.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return false, "Gateway tidak merespons (timeout)"
		}
		return false, "fetch failed"
	}
	defer resp.Body.Close()
	var data struct {
		Error *string `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if data.Error != nil {
			return false, *data.Error
		}
		return false, "Gateway menolak permintaan kirim"
	}
	return true, ""
}
