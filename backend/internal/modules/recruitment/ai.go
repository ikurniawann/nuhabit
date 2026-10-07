package recruitment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// The recruitment AI calls (lib/recruitment/deepseek.ts, cv-ocr.ts,
// interview-ai.ts, psikotes-ai.ts): DeepSeek and OpenAI chat completions
// and Whisper over net/http, with keys from configuration.app_settings.

// notConfigured is a missing API key; the routes answer it with 400.
type notConfigured string

func (e notConfigured) Error() string { return string(e) }

const (
	deepseekNotConfigured = notConfigured("DeepSeek API key belum dikonfigurasi. Atur di Dashboard → Settings → Integrasi.")
	// cv-ocr.ts
	openAIOCRNotConfigured = notConfigured("API key OpenAI belum diatur. Isi di Settings → Integrasi terlebih dahulu.")
	// psikotes-ai.ts
	openAIVisionNotConfigured = notConfigured("OpenAI API key belum dikonfigurasi (dipakai untuk membaca gambar otomatis). " +
		"Atur di Dashboard → Settings → Integrasi, atau tulis observasi gambar secara manual.")
	// interview-ai.ts
	openAIAudioNotConfigured = notConfigured("OpenAI API key belum dikonfigurasi (dipakai untuk transkrip suara & text-to-speech). " +
		"Atur di Dashboard → Settings → Integrasi.")
)

// DEEPSEEK_DEFAULTS and OPENAI_DEFAULTS.
const (
	deepseekModel   = "deepseek-chat"
	deepseekBaseURL = "https://api.deepseek.com"
	openAIModel     = "gpt-4o-mini"
	openAIBaseURL   = "https://api.openai.com/v1"
)

type aiConfig struct{ apiKey, model, baseURL string }

type aiClient struct {
	settings Settings
	http     *http.Client
	getenv   func(string) string
	// retryDelay is the pause between network retries (cv-ocr.ts).
	retryDelay time.Duration
}

func (c aiClient) read(ctx context.Context, q database.Querier, keys ...string) (map[string]string, error) {
	raw, err := c.settings.GetMany(ctx, q, keys)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(keys))
	for _, k := range keys {
		if v := raw[k]; v != nil {
			out[k] = *v
		}
	}
	return out, nil
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// deepseek is getDeepseekConfig.
func (c aiClient) deepseek(ctx context.Context, q database.Querier) (aiConfig, error) {
	s, err := c.read(ctx, q, "deepseek_api_key", "deepseek_model", "deepseek_base_url")
	if err != nil {
		return aiConfig{}, err
	}
	if s["deepseek_api_key"] == "" {
		return aiConfig{}, deepseekNotConfigured
	}
	return aiConfig{s["deepseek_api_key"], orDefault(s["deepseek_model"], deepseekModel),
		orDefault(s["deepseek_base_url"], deepseekBaseURL)}, nil
}

// openAI is getOpenAiConfig of psikotes-ai.ts and interview-ai.ts: the
// stored key only, missing is the caller's error.
func (c aiClient) openAI(ctx context.Context, q database.Querier, missing notConfigured) (aiConfig, error) {
	s, err := c.read(ctx, q, "openai_api_key", "openai_model", "openai_base_url")
	if err != nil {
		return aiConfig{}, err
	}
	if s["openai_api_key"] == "" {
		return aiConfig{}, missing
	}
	return aiConfig{s["openai_api_key"], orDefault(s["openai_model"], openAIModel),
		orDefault(s["openai_base_url"], openAIBaseURL)}, nil
}

// openAIForOCR is resolveOpenAi in cv-ocr.ts: the stored key wins over
// OPENAI_API_KEY, and the base URL loses a trailing slash.
func (c aiClient) openAIForOCR(ctx context.Context, q database.Querier) (aiConfig, error) {
	s, err := c.read(ctx, q, "openai_api_key", "openai_base_url")
	if err != nil {
		return aiConfig{}, err
	}
	key := s["openai_api_key"]
	if key == "" {
		key = strings.TrimSpace(c.getenv("OPENAI_API_KEY"))
	}
	if key == "" {
		return aiConfig{}, openAIOCRNotConfigured
	}
	base := orDefault(s["openai_base_url"], openAIBaseURL)
	return aiConfig{apiKey: key, model: openAIModel, baseURL: strings.TrimSuffix(base, "/")}, nil
}

type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// chatRequest is one chat completion; label names the provider in errors
// ("DeepSeek API error 401: …").
type chatRequest struct {
	label    string
	timeout  time.Duration
	attempts int // network attempts (cv-ocr retries transport failures)
	body     map[string]any
}

func jsonObjectFormat() map[string]string { return map[string]string{"type": "json_object"} }

// chat posts a completion and returns choices[0].message.content.
func (c aiClient) chat(ctx context.Context, cfg aiConfig, req chatRequest) (string, error) {
	req.body["model"] = cfg.model
	payload, err := json.Marshal(req.body)
	if err != nil {
		return "", err
	}
	res, err := c.post(ctx, req, cfg.baseURL+"/chat/completions", payload, map[string]string{
		"Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey,
	})
	if err != nil {
		return "", err
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content *string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(res, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == nil || *parsed.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("%s tidak mengembalikan jawaban", req.label)
	}
	return *parsed.Choices[0].Message.Content, nil
}

// post sends the request, retrying transport failures (never HTTP errors),
// and returns the body of a 2xx answer.
func (c aiClient) post(ctx context.Context, req chatRequest, endpoint string, payload []byte, headers map[string]string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, req.timeout)
	defer cancel()
	var res *http.Response
	var err error
	for attempt := 1; attempt <= max(1, req.attempts); attempt++ {
		var r *http.Request
		r, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		if res, err = c.http.Do(r); err == nil {
			break
		}
		if attempt < req.attempts {
			select {
			case <-ctx.Done():
				return nil, err
			case <-time.After(c.retryDelay):
			}
		}
	}
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("%s API error %d: %s", req.label, res.StatusCode, domain.JSSlice(string(data), 300))
	}
	return data, err
}

// deepseekJSON is deepseekJson in interview-ai.ts: a JSON-object completion
// at temperature 0.4, decoded.
func (c aiClient) deepseekJSON(ctx context.Context, q database.Querier, system, user string) (any, string, error) {
	cfg, err := c.deepseek(ctx, q)
	if err != nil {
		return nil, "", err
	}
	content, err := c.chat(ctx, cfg, chatRequest{label: "DeepSeek", timeout: 60 * time.Second, body: map[string]any{
		"messages":        []chatMessage{{"system", system}, {"user", user}},
		"temperature":     0.4,
		"response_format": jsonObjectFormat(),
	}})
	if err != nil {
		return nil, "", err
	}
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, "", err
	}
	return parsed, cfg.model, nil
}

const whisperModel = "whisper-1"

// transcribe is transcribeInterviewAudio: Whisper in Indonesian.
func (c aiClient) transcribe(ctx context.Context, q database.Querier, audio []byte, mime string) (string, error) {
	cfg, err := c.openAI(ctx, q, openAIAudioNotConfigured)
	if err != nil {
		return "", err
	}
	ext := "webm"
	switch {
	case strings.Contains(mime, "ogg"):
		ext = "ogg"
	case strings.Contains(mime, "mp4"):
		ext = "m4a"
	case strings.Contains(mime, "mpeg"):
		ext = "mp3"
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="file"; filename="answer.`+ext+`"`)
	h.Set("Content-Type", mime)
	part, err := mw.CreatePart(h)
	if err != nil {
		return "", err
	}
	_, _ = part.Write(audio)
	for _, kv := range [][2]string{{"model", whisperModel}, {"language", "id"}, {"response_format", "json"}} {
		_ = mw.WriteField(kv[0], kv[1])
	}
	if err := mw.Close(); err != nil {
		return "", err
	}
	res, err := c.post(ctx, chatRequest{label: "Whisper", timeout: 120 * time.Second}, cfg.baseURL+"/audio/transcriptions",
		body.Bytes(), map[string]string{"Authorization": "Bearer " + cfg.apiKey, "Content-Type": mw.FormDataContentType()})
	if err != nil {
		return "", err
	}
	var parsed struct {
		Text any `json:"text"`
	}
	if err := json.Unmarshal(res, &parsed); err != nil {
		return "", err
	}
	if parsed.Text == nil {
		return "", nil
	}
	return validate.JSTrim(jsString(parsed.Text)), nil
}
