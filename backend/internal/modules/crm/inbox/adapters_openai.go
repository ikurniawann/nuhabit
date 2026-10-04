package inbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/platform/database"
)

// OpenAIChat is a stopgap adapter: moves to the AI/settings context once
// it is ported. It mirrors resolveOpenAiCall and requestInsightText in
// lib/crm/conversation-insights-server.ts: key, base URL and model from
// configuration.app_settings (env key as fallback), one non-streaming
// chat completion, JSON mode first and retried once without it on HTTP 400.
type OpenAIChat struct {
	Getenv func(string) string
	Client *http.Client
}

var _ InsightModel = OpenAIChat{}

// aiModels are the AI_ASSISTANT_MODELS ids; the last one rejects a custom
// temperature.
var aiModels = []string{"openai:gpt-4o-mini", "openai:gpt-4.1-mini", "openai:gpt-4o", "openai:gpt-5.4-mini", "openai:gpt-5.5"}

const analysisTimeout = 60 * time.Second

// Complete returns the answer text and the model id stored with the insight.
func (o OpenAIChat) Complete(ctx context.Context, q database.Querier, messages []domain.ChatMessage) (string, string, error) {
	stored, err := appSettings(ctx, q, "openai_api_key", "openai_base_url", "openai_model")
	if err != nil {
		return "", "", err
	}
	apiKey := settingOrEnv(stored, "openai_api_key", o.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return "", "", errors.New("API key OpenAI belum tersedia (env OPENAI_API_KEY maupun Settings → Integrasi kosong)")
	}
	// The setting stores a bare id; unknown ids fall back to the default.
	model := "openai:" + strings.TrimPrefix(firstSet(stored["openai_model"], "gpt-4o-mini"), "openai:")
	if !slices.Contains(aiModels, model) {
		model = aiModels[0]
	}
	baseURL := strings.TrimSuffix(firstSet(stored["openai_base_url"], "https://api.openai.com/v1"), "/")

	send := func(jsonMode bool) (response, error) {
		body := map[string]any{"model": strings.TrimPrefix(model, "openai:"), "messages": messages}
		if model != "openai:gpt-5.5" {
			body["temperature"] = 0
		}
		if jsonMode {
			body["response_format"] = map[string]string{"type": "json_object"}
		}
		callCtx, cancel := context.WithTimeout(ctx, analysisTimeout)
		defer cancel()
		res, err := doRequest(callCtx, httpClient(o.Client), http.MethodPost, baseURL+"/chat/completions", body,
			map[string]string{"Content-Type": "application/json", "Authorization": "Bearer " + apiKey})
		if err != nil {
			return res, errors.New(fetchError(callCtx, err))
		}
		return res, nil
	}
	res, err := send(true)
	if err == nil && res.status == http.StatusBadRequest {
		res, err = send(false)
	}
	if err != nil {
		return "", "", err
	}
	if !res.ok() {
		detail := domain.UTF16Slice(string(res.raw), 0, 200)
		if detail != "" {
			detail = ": " + detail
		}
		return "", "", fmt.Errorf("OpenAI HTTP %d%s", res.status, detail)
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(res.raw, &payload); err != nil {
		return "", "", err
	}
	if len(payload.Choices) > 0 {
		if content, ok := payload.Choices[0].Message.Content.(string); ok && domain.JSTrim(content) != "" {
			return content, model, nil
		}
	}
	return "", "", errors.New("Jawaban OpenAI kosong")
}
