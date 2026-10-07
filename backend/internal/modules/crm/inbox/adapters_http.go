package inbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Helpers shared by the stopgap adapters below: app settings (owned by the
// settings context, not in any migration wave) and fetch-like HTTP calls.

// appSettings reads configuration.app_settings values (getSettings),
// trimmed, keeping only non-empty ones.
func appSettings(ctx context.Context, q database.Querier, keys ...string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key string
		var value *string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		if value != nil {
			if v := strings.TrimSpace(*value); v != "" {
				out[key] = v
			}
		}
	}
	return out, rows.Err()
}

func firstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// settingOrEnv is `stored[key]?.trim() || env?.trim() || ""`.
func settingOrEnv(stored map[string]string, key, env string) string {
	if v := stored[key]; v != "" {
		return v
	}
	return strings.TrimSpace(env)
}

// fetchError is the error.message fetch reports: a timeout through
// AbortSignal.timeout, otherwise undici's "fetch failed".
func fetchError(ctx context.Context, err error) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return "The operation was aborted due to timeout"
	}
	return "fetch failed"
}

// response is a fetched HTTP response: status, raw body, and the body as
// JSON (nil when it is not JSON, like `response.json().catch(() => null)`).
type response struct {
	status int
	raw    []byte
	data   map[string]any
}

func (r response) ok() bool { return r.status >= 200 && r.status <= 299 }

// apiError reads data.error.message.
func (r response) apiError() string {
	e, _ := r.data["error"].(map[string]any)
	msg, _ := e["message"].(string)
	return msg
}

func doRequest(ctx context.Context, client *http.Client, method, url string, body any, headers map[string]string) (response, error) {
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return response{}, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return response{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return response{}, err
	}
	out := response{status: resp.StatusCode, raw: raw}
	_ = json.Unmarshal(raw, &out.data)
	return out, nil
}

func httpClient(c *http.Client) *http.Client {
	if c == nil {
		return http.DefaultClient
	}
	return c
}
