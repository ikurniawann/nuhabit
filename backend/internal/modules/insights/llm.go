package insights

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/database"
)

// OpenAI Chat Completions for Do (lib/assistant/llm.ts) over plain net/http.
// Credentials: the openai_api_key setting wins over env OPENAI_API_KEY;
// base URL from the openai_base_url setting; OPENAI_TIMEOUT in ms (120000).

type openAI struct {
	getenv func(string) string
	client *http.Client
	// settings reads configuration.app_settings (getSettings); tests swap it.
	settings func(ctx context.Context, q database.Querier, keys ...string) (map[string]string, error)
}

func newOpenAI(getenv func(string) string, client *http.Client) *openAI {
	return &openAI{getenv: getenv, client: client, settings: appSettings}
}

func appSettings(ctx context.Context, q database.Querier, keys ...string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k string
		var v *string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if v != nil {
			out[k] = *v
		}
	}
	return out, rows.Err()
}

type openAICall struct {
	apiKey, baseURL string
	timeout         time.Duration
}

func (o *openAI) resolve(ctx context.Context, q database.Querier) (openAICall, error) {
	s, err := o.settings(ctx, q, "openai_api_key", "openai_base_url")
	if err != nil {
		return openAICall{}, err
	}
	key := s["openai_api_key"]
	if key == "" {
		key = domain.Trim(o.getenv("OPENAI_API_KEY"))
	}
	if key == "" {
		return openAICall{}, errors.New("API key OpenAI belum tersedia (env OPENAI_API_KEY maupun Settings → Integrasi kosong)")
	}
	base := s["openai_base_url"]
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	raw := o.getenv("OPENAI_TIMEOUT")
	if raw == "" {
		raw = "120000"
	}
	ms, err := strconv.ParseFloat(domain.Trim(raw), 64)
	if err != nil || ms < 0 {
		return openAICall{}, fmt.Errorf("OPENAI_TIMEOUT tidak valid: %q", raw)
	}
	return openAICall{apiKey: key, baseURL: strings.TrimSuffix(base, "/"), timeout: time.Duration(ms * float64(time.Millisecond))}, nil
}

// chatBody is the request body: model, temperature (when the model takes
// it), the extra fields, then messages, in the TS key order.
func chatBody(model string, extra domain.Object, messages []domain.Object) domain.Object {
	body := domain.Object{{Key: "model", Value: domain.StripOpenAIPrefix(model)}}
	if domain.ModelSupportsTemperature(model) {
		body = append(body, domain.Field{Key: "temperature", Value: 0.7})
	}
	body = append(body, extra...)
	return append(body, domain.Field{Key: "messages", Value: messages})
}

// post sends one completion request; the caller closes the body.
func (o *openAI) post(ctx context.Context, call openAICall, body domain.Object) (*http.Response, error) {
	raw, err := domain.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, call.baseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+call.apiKey)
	res, err := o.client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		text, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return nil, fmt.Errorf("OpenAI %d: %s", res.StatusCode, domain.Slice(string(text), 300))
	}
	return res, nil
}

type completion struct {
	Choices []struct {
		Message *struct {
			Content   json.RawMessage `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
}

func (o *openAI) complete(ctx context.Context, call openAICall, body domain.Object) (completion, error) {
	ctx, cancel := context.WithTimeout(ctx, call.timeout)
	defer cancel()
	res, err := o.post(ctx, call, body)
	if err != nil {
		return completion{}, err
	}
	defer res.Body.Close()
	var c completion
	err = json.NewDecoder(res.Body).Decode(&c)
	return c, err
}

func (c completion) message() (content json.RawMessage, toolCalls json.RawMessage) {
	if len(c.Choices) == 0 || c.Choices[0].Message == nil {
		return nil, nil
	}
	return c.Choices[0].Message.Content, c.Choices[0].Message.ToolCalls
}

// chat is callOpenAiChat: one non-streaming answer, markdown stripped.
func (o *openAI) chat(ctx context.Context, q database.Querier, model string, messages []domain.Object) (string, error) {
	call, err := o.resolve(ctx, q)
	if err != nil {
		return "", err
	}
	c, err := o.complete(ctx, call, chatBody(model, nil, messages))
	if err != nil {
		return "", err
	}
	content, _ := c.message()
	var text string
	_ = json.Unmarshal(content, &text)
	answer := domain.NormalizePlainTextAnswer(text)
	if answer == "" {
		return "", errors.New("OpenAI mengembalikan jawaban kosong")
	}
	return answer, nil
}

// chatStream is callOpenAiChatStream: deltas go to onDelta as they arrive,
// the whole answer is returned when the stream ends.
func (o *openAI) chatStream(ctx context.Context, q database.Querier, model string, messages []domain.Object, onDelta func(string)) (string, error) {
	call, err := o.resolve(ctx, q)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, call.timeout)
	defer cancel()
	res, err := o.post(ctx, call, chatBody(model, domain.Object{{Key: "stream", Value: true}}, messages))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var buffer, full strings.Builder
	chunk := make([]byte, 32*1024)
	for {
		n, readErr := res.Body.Read(chunk)
		if n > 0 {
			buffer.Write(chunk[:n])
			events, rest := domain.SplitSSEEvents(buffer.String())
			buffer.Reset()
			buffer.WriteString(rest)
			for _, event := range events {
				for _, payload := range domain.ExtractSSEData(event) {
					if piece, ok := domain.ReadOpenAIDelta(payload); ok && piece != "" {
						full.WriteString(piece)
						onDelta(piece)
					}
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	answer := domain.NormalizePlainTextAnswer(full.String())
	if answer == "" {
		return "", errors.New("OpenAI mengembalikan jawaban kosong")
	}
	return answer, nil
}

// providerError is formatProviderError for the logs and the audit row.
func providerError(err error, endpoint string) string {
	return endpoint + ": Error: " + err.Error()
}
