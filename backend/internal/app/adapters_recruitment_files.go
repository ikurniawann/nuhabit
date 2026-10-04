package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/configuration"
	settingsdomain "nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/modules/recruitment"
	"nuhabit/backend/internal/platform/database"
)

// Adapters for recruitment's file and AI routes: app settings from the
// configuration owner, the interview question voice (lib/tts/synthesize.ts
// with the stored provider) and the hired employee of the pipeline report.

var _ recruitment.Settings = configuration.AppSettings{}

// recruitmentSpeech is synthesizeSpeechOrNull for the interview questions.
// The configuration module keeps its synthesis on its preview handler, so
// this ports the same three providers; failures are logged and yield nil.
type recruitmentSpeech struct {
	log *slog.Logger
	// ElevenLabs and Azure are the API roots; tests point them at fakes.
	ElevenLabs string
	Azure      func(region string) string
}

var _ recruitment.Speech = recruitmentSpeech{}

const ttsInstructions = "Bicaralah sepenuhnya dalam bahasa Indonesia dengan pelafalan penutur asli Indonesia " +
	"yang natural (bukan aksen asing). Nada ramah, profesional, dan jelas — seperti seorang " +
	"HR interviewer yang menenangkan kandidat. Tempo sedang, artikulasi rapi."

func (s recruitmentSpeech) Synthesize(ctx context.Context, q database.Querier, text string) []byte {
	audio, err := s.synthesize(ctx, q, text)
	if err != nil {
		s.log.Error("[tts] sintesis gagal, klien akan jatuh ke Web Speech API browser", "error", err)
		return nil
	}
	return audio
}

func (s recruitmentSpeech) synthesize(ctx context.Context, q database.Querier, text string) ([]byte, error) {
	raw, err := configuration.AppSettings{}.GetMany(ctx, q, []string{"tts_provider", "tts_voice", "tts_model",
		"openai_api_key", "openai_base_url", "azure_speech_key", "azure_speech_region", "elevenlabs_api_key"})
	if err != nil {
		return nil, err
	}
	get := func(k string) string {
		if v := raw[k]; v != nil {
			return *v
		}
		return ""
	}
	provider := settingsdomain.TtsDefaultProvider
	if raw["tts_provider"] != nil {
		provider = settingsdomain.GetTtsProvider(*raw["tts_provider"]).ID
	}
	voice := settingsdomain.ResolveTtsVoice(provider, raw["tts_voice"])
	model := settingsdomain.ResolveTtsModel(provider, raw["tts_model"])
	input := settingsdomain.SliceJS(text, settingsdomain.TtsMaxInputChars)

	switch provider {
	case "azure":
		key, region := get("azure_speech_key"), get("azure_speech_region")
		if key == "" || region == "" {
			return nil, fmt.Errorf("Azure Speech key atau region belum diisi")
		}
		parts := strings.Split(voice, "-")
		locale := strings.Join(parts[:min(2, len(parts))], "-")
		if locale == "" {
			locale = "id-ID"
		}
		esc := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace
		ssml := `<speak version="1.0" xml:lang="` + locale + `"><voice name="` + esc(voice) + `">` + esc(input) + `</voice></speak>`
		return postTTS(ctx, "Azure", s.Azure(region)+"/cognitiveservices/v1", []byte(ssml), map[string]string{
			"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
			"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "arkiv-os",
		})
	case "elevenlabs":
		key := get("elevenlabs_api_key")
		if key == "" || voice == "" {
			return nil, fmt.Errorf("ElevenLabs API key atau Voice ID belum diisi")
		}
		body, _ := json.Marshal(map[string]string{"text": input, "model_id": model})
		return postTTS(ctx, "ElevenLabs", s.ElevenLabs+"/v1/text-to-speech/"+strings.ReplaceAll(url.QueryEscape(voice), "+", "%20"), body,
			map[string]string{"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
	}
	key := get("openai_api_key")
	if key == "" {
		return nil, fmt.Errorf("API key OpenAI belum diisi")
	}
	base := get("openai_base_url")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	payload := map[string]string{"model": model, "voice": voice, "input": input, "response_format": "mp3"}
	if model == "gpt-4o-mini-tts" {
		payload["instructions"] = ttsInstructions
	}
	body, _ := json.Marshal(payload)
	return postTTS(ctx, "OpenAI", base+"/audio/speech", body, map[string]string{
		"Content-Type": "application/json", "Authorization": "Bearer " + key,
	})
}

func postTTS(ctx context.Context, label, endpoint string, body []byte, headers map[string]string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fmt.Errorf("%s TTS %d: %s", label, res.StatusCode, settingsdomain.SliceJS(string(data), 300))
	}
	return data, err
}

// recruitmentHired reads the employee a candidate was promoted to, with
// department, job title, manager and onboarding progress (hris tables).
type recruitmentHired struct{}

var _ recruitment.HiredEmployees = recruitmentHired{}

func (recruitmentHired) Hired(ctx context.Context, q database.Querier, candidateID string) (*recruitment.Row, error) {
	return recruitment.CollectRow(q.Query(ctx, `SELECT c.promotion_date, e.nip, e.join_date, e.employment_status,
              e.is_active, (e.user_id IS NOT NULL) AS has_account,
              d.name AS department_name, p.title AS job_title,
              m.full_name AS reporting_to_name,
              coalesce(ob.total, 0) AS onboarding_total,
              coalesce(ob.completed, 0) AS onboarding_completed
       FROM recruitment.candidates c
       JOIN hris.employees e ON e.id = c.promoted_to_employee_id
       LEFT JOIN hris.departments d ON d.id = e.department_id
       LEFT JOIN hris.positions p ON p.id = e.job_title_id
       LEFT JOIN hris.employees m ON m.id = e.reporting_to
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE completed)::int AS completed
         FROM hris.onboarding_checklists oc
         WHERE oc.employee_id = e.id
       ) ob ON true
       WHERE c.id = $1`, candidateID))
}
