package settings

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

/* ── GET / PUT /api/settings/tts ─────────────────────────────────────── */

type ttsView struct {
	Provider    string            `json:"provider"`
	Voice       string            `json:"voice"`
	Model       string            `json:"model"`
	Catalog     domain.TtsCatalog `json:"catalog"`
	Credentials struct {
		OpenAI struct {
			Configured bool `json:"configured"`
		} `json:"openai"`
		Azure struct {
			Configured bool    `json:"configured"`
			KeyMasked  *string `json:"key_masked"`
			Region     string  `json:"region"`
		} `json:"azure"`
		ElevenLabs struct {
			Configured bool    `json:"configured"`
			KeyMasked  *string `json:"key_masked"`
		} `json:"elevenlabs"`
	} `json:"credentials"`
}

func filled(p *string) bool { return p != nil && *p != "" }

func (h *handler) getTts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	s, err := h.settings.GetMany(r.Context(), h.db, []string{"tts_provider", "tts_voice", "tts_model",
		"openai_api_key", "azure_speech_key", "azure_speech_region", "elevenlabs_api_key"})
	if err != nil {
		return err
	}
	var v ttsView
	v.Provider = storedProvider(s["tts_provider"])
	v.Voice = domain.ResolveTtsVoice(v.Provider, s["tts_voice"])
	v.Model = domain.ResolveTtsModel(v.Provider, s["tts_model"])
	v.Catalog = domain.TtsProviders
	v.Credentials.OpenAI.Configured = filled(s["openai_api_key"])
	v.Credentials.Azure.Configured = filled(s["azure_speech_key"]) && filled(s["azure_speech_region"])
	v.Credentials.Azure.KeyMasked = kit.MaskSecret(s["azure_speech_key"])
	v.Credentials.Azure.Region = kit.Deref(s["azure_speech_region"])
	v.Credentials.ElevenLabs.Configured = filled(s["elevenlabs_api_key"])
	v.Credentials.ElevenLabs.KeyMasked = kit.MaskSecret(s["elevenlabs_api_key"])
	return httpx.JSON(w, http.StatusOK, dataBody{v})
}

// storedProvider is getTtsProvider(stored ?? TTS_DEFAULT_PROVIDER).id.
func storedProvider(stored *string) string {
	if stored == nil {
		return domain.TtsDefaultProvider
	}
	return domain.GetTtsProvider(*stored).ID
}

// ttsCredentials are the PUT body credential fields and their keys.
var ttsCredentials = [][2]string{
	{"azure_key", "azure_speech_key"},
	{"azure_region", "azure_speech_region"},
	{"elevenlabs_key", "elevenlabs_api_key"},
}

// customString is z.string({ message }).optional(): every failure of a
// sent value carries the custom message.
func customString(f *validate.Form, key, msg string) *string {
	v, sent := f.Fields()[key]
	if !sent {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		f.Fail(key, "invalid_type", msg)
		return nil
	}
	return &s
}

func (h *handler) putTts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	provider, providerSent := f.Fields()["provider"]
	voice := customString(f, "voice", "Voice tidak valid")
	model := customString(f, "model", "Model tidak valid")
	creds := make([]*string, len(ttsCredentials))
	credSent := make([]bool, len(ttsCredentials))
	for i, c := range ttsCredentials {
		_, credSent[i] = f.Fields()[c[0]]
		creds[i] = f.Str(c[0], validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{})
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}

	ctx := r.Context()
	if providerSent {
		if !domain.IsTtsProviderID(provider) {
			return httpx.BadRequest("Provider tidak dikenal")
		}
		if err := h.settings.Set(ctx, h.db, "tts_provider", provider.(string)); err != nil {
			return err
		}
	}
	// Voice and model are checked against the provider stored now, so an
	// Azure voice never lands on the OpenAI provider.
	stored, err := h.settings.Get(ctx, h.db, "tts_provider")
	if err != nil {
		return err
	}
	active := domain.GetTtsProvider(kit.Deref(stored)).ID
	if voice != nil {
		var value *string
		if v := domain.ResolveTtsVoice(active, *voice); v != "" {
			value = &v
		}
		if err := h.settings.Put(ctx, h.db, "tts_voice", value); err != nil {
			return err
		}
	}
	if model != nil {
		if err := h.settings.Set(ctx, h.db, "tts_model", domain.ResolveTtsModel(active, *model)); err != nil {
			return err
		}
	}
	for i, c := range ttsCredentials {
		if !credSent[i] {
			continue
		}
		// Empty or null deletes, a value is stored trimmed.
		var value *string
		if v := creds[i]; v != nil && *v != "" {
			t := validate.JSTrim(*v)
			value = &t
		}
		if err := h.settings.Put(ctx, h.db, c[1], value); err != nil {
			return err
		}
	}
	return httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

/* ── POST /api/settings/tts/preview ──────────────────────────────────── */

// maxPreviewChars keeps the preview button from becoming a free TTS pipe.
const maxPreviewChars = 300

type ttsPreview struct {
	AudioBase64 string `json:"audio_base64"`
	Provider    string `json:"provider"`
	Voice       string `json:"voice"`
	Model       string `json:"model"`
	Text        string `json:"text"`
}

func (h *handler) previewTts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	body, err := bodyObject(r)
	if err != nil {
		return err
	}
	provider, providerSent := body["provider"]
	if providerSent && !domain.IsTtsProviderID(provider) {
		return httpx.BadRequest("Provider tidak dikenal")
	}
	raw, _ := body["text"].(string)
	text := domain.TrimJS(raw)
	if text == "" {
		text = domain.TtsPreviewText
	}
	text = domain.SliceJS(text, maxPreviewChars)

	var override ttsOverride
	override.provider, _ = provider.(string)
	if v, ok := body["voice"].(string); ok {
		override.voice = &v
	}
	if v, ok := body["model"].(string); ok {
		override.model = &v
	}
	res, err := synthesize(r.Context(), h.db, h.urls, text, override)
	var notConfigured ttsNotConfigured
	switch {
	case errors.As(err, &notConfigured):
		return httpx.BadRequest(string(notConfigured))
	case errors.Is(err, errSettingsRead):
		return err
	case err != nil:
		// The provider's message is the point of a preview: a wrong key or a
		// missing voice must reach the admin as is.
		h.d.Log.ErrorContext(r.Context(), "[settings/tts/preview] gagal", "error", err.Error())
		return httpx.Status(http.StatusBadGateway, err.Error())
	}
	return httpx.JSON(w, http.StatusOK, dataBody{ttsPreview{
		AudioBase64: base64.StdEncoding.EncodeToString(res.audio),
		Provider:    res.provider, Voice: res.voice, Model: res.model, Text: text,
	}})
}

/* ── synthesis (lib/tts/synthesize.ts) ───────────────────────────────── */

// ttsNotConfigured is TtsNotConfiguredError, a 400 in the preview route.
type ttsNotConfigured string

func (e ttsNotConfigured) Error() string { return string(e) }

// errSettingsRead marks a settings read failure, which stays a 500.
var errSettingsRead = errors.New("tts: settings read failed")

type ttsOverride struct {
	provider     string
	voice, model *string
}

type ttsResult struct {
	audio                  []byte
	provider, voice, model string
}

type ttsConfig struct {
	provider, voice, model string
	openAIKey, openAIBase  string
	azureKey, azureRegion  string
	elevenLabsKey          string
}

const (
	ttsTimeout         = 60 * time.Second
	openAIInstructions = "Bicaralah sepenuhnya dalam bahasa Indonesia dengan pelafalan penutur asli Indonesia " +
		"yang natural (bukan aksen asing). Nada ramah, profesional, dan jelas — seperti seorang " +
		"HR interviewer yang menenangkan kandidat. Tempo sedang, artikulasi rapi."
)

// Synthesize is synthesizeSpeech: text as mp3 in the provider, voice and
// model stored in configuration.app_settings, read on q. Zero Endpoints
// use the production API roots.
func Synthesize(ctx context.Context, q database.Querier, urls Endpoints, text string) ([]byte, error) {
	res, err := synthesize(ctx, q, urls.withDefaults(), text, ttsOverride{})
	return res.audio, err
}

// synthesize is synthesizeSpeech with the preview's override: stored voice
// and model apply only while the provider stays the same.
func synthesize(ctx context.Context, q database.Querier, urls Endpoints, text string, o ttsOverride) (ttsResult, error) {
	s, err := kit.AppSettings{}.GetMany(ctx, q, []string{"tts_provider", "tts_voice", "tts_model", "openai_api_key",
		"openai_base_url", "azure_speech_key", "azure_speech_region", "elevenlabs_api_key"})
	if err != nil {
		return ttsResult{}, fmt.Errorf("%w: %w", errSettingsRead, err)
	}
	base := storedProvider(s["tts_provider"])
	cfg := ttsConfig{
		provider:      base,
		openAIKey:     kit.Deref(s["openai_api_key"]),
		openAIBase:    kit.Deref(s["openai_base_url"]),
		azureKey:      kit.Deref(s["azure_speech_key"]),
		azureRegion:   kit.Deref(s["azure_speech_region"]),
		elevenLabsKey: kit.Deref(s["elevenlabs_api_key"]),
	}
	if cfg.openAIBase == "" {
		cfg.openAIBase = "https://api.openai.com/v1"
	}
	if o.provider != "" {
		cfg.provider = o.provider
	}
	var voice, model any = o.voice, o.model
	if o.voice == nil && cfg.provider == base {
		voice = domain.ResolveTtsVoice(base, s["tts_voice"])
	}
	if o.model == nil && cfg.provider == base {
		model = domain.ResolveTtsModel(base, s["tts_model"])
	}
	cfg.voice = domain.ResolveTtsVoice(cfg.provider, voice)
	cfg.model = domain.ResolveTtsModel(cfg.provider, model)

	input := domain.SliceJS(text, domain.TtsMaxInputChars)
	var audio []byte
	switch cfg.provider {
	case "azure":
		audio, err = synthesizeAzure(ctx, urls, input, cfg)
	case "elevenlabs":
		audio, err = synthesizeElevenLabs(ctx, urls, input, cfg)
	default:
		audio, err = synthesizeOpenAI(ctx, input, cfg)
	}
	return ttsResult{audio: audio, provider: cfg.provider, voice: cfg.voice, model: cfg.model}, err
}

func synthesizeOpenAI(ctx context.Context, text string, cfg ttsConfig) ([]byte, error) {
	if cfg.openAIKey == "" {
		return nil, ttsNotConfigured("API key OpenAI belum diisi. Atur di Settings → Integrasi.")
	}
	payload := struct {
		Model          string `json:"model"`
		Voice          string `json:"voice"`
		Input          string `json:"input"`
		ResponseFormat string `json:"response_format"`
		Instructions   string `json:"instructions,omitempty"`
	}{cfg.model, cfg.voice, text, "mp3", ""}
	if cfg.model == "gpt-4o-mini-tts" {
		payload.Instructions = openAIInstructions
	}
	body, err := kit.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return postAudio(ctx, "OpenAI", cfg.openAIBase+"/audio/speech", body, map[string]string{
		"Content-Type": "application/json", "Authorization": "Bearer " + cfg.openAIKey,
	})
}

var ssmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")

func synthesizeAzure(ctx context.Context, urls Endpoints, text string, cfg ttsConfig) ([]byte, error) {
	if cfg.azureKey == "" || cfg.azureRegion == "" {
		return nil, ttsNotConfigured("Azure Speech key atau region belum diisi. Atur di Settings → Suara AI.")
	}
	// The locale comes from the voice name (id-ID-GadisNeural → id-ID).
	parts := strings.Split(cfg.voice, "-")
	locale := strings.Join(parts[:min(2, len(parts))], "-")
	if locale == "" {
		locale = "id-ID"
	}
	ssml := `<speak version="1.0" xml:lang="` + locale + `">` +
		`<voice name="` + ssmlEscaper.Replace(cfg.voice) + `">` + ssmlEscaper.Replace(text) + `</voice>` +
		`</speak>`
	return postAudio(ctx, "Azure", urls.Azure(cfg.azureRegion)+"/cognitiveservices/v1", []byte(ssml), map[string]string{
		"Ocp-Apim-Subscription-Key": cfg.azureKey,
		"Content-Type":              "application/ssml+xml",
		"X-Microsoft-OutputFormat":  "audio-24khz-48kbitrate-mono-mp3",
		"User-Agent":                "arkiv-os",
	})
}

func synthesizeElevenLabs(ctx context.Context, urls Endpoints, text string, cfg ttsConfig) ([]byte, error) {
	if cfg.elevenLabsKey == "" {
		return nil, ttsNotConfigured("ElevenLabs API key belum diisi. Atur di Settings → Suara AI.")
	}
	if cfg.voice == "" {
		return nil, ttsNotConfigured("Voice ID ElevenLabs belum diisi. Salin dari dashboard ElevenLabs.")
	}
	body, err := kit.Marshal(struct {
		Text    string `json:"text"`
		ModelID string `json:"model_id"`
	}{text, cfg.model})
	if err != nil {
		return nil, err
	}
	return postAudio(ctx, "ElevenLabs", urls.ElevenLabs+"/v1/text-to-speech/"+encodeURIComponent(cfg.voice), body,
		map[string]string{"xi-api-key": cfg.elevenLabsKey, "Content-Type": "application/json", "Accept": "audio/mpeg"})
}

// postAudio POSTs body and returns the response bytes. A non-2xx answer is
// "<label> TTS <status>: <first 300 characters of the body>"; transport
// failures carry fetch's messages.
func postAudio(ctx context.Context, label, endpoint string, body []byte, headers map[string]string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, ttsTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("fetch failed")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("The operation was aborted due to timeout")
		}
		return nil, errors.New("fetch failed")
	}
	defer res.Body.Close()
	data, readErr := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode > 299 {
		detail := "(body tidak terbaca)"
		if readErr == nil {
			detail = domain.SliceJS(string(data), 300)
		}
		return nil, fmt.Errorf("%s TTS %d: %s", label, res.StatusCode, detail)
	}
	if readErr != nil {
		return nil, readErr
	}
	return data, nil
}

// encodeURIComponent is the JS global: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is escaped.
func encodeURIComponent(s string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").
		Replace(url.QueryEscape(s))
}
