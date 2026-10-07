package domain

import "slices"

// TtsVoice is TtsVoice (lib/tts/catalog.ts).
type TtsVoice struct {
	ID               string `json:"id"`
	Label            string `json:"label"`
	NativeIndonesian bool   `json:"nativeIndonesian"`
	Note             string `json:"note,omitempty"`
}

// TtsProvider is TtsProvider.
type TtsProvider struct {
	ID                  string     `json:"id"`
	Label               string     `json:"label"`
	Description         string     `json:"description"`
	DefaultModel        string     `json:"defaultModel"`
	Models              []string   `json:"models"`
	DefaultVoice        string     `json:"defaultVoice"`
	Voices              []TtsVoice `json:"voices"`
	AllowCustomVoice    bool       `json:"allowCustomVoice"`
	RequiredCredentials []string   `json:"requiredCredentials"`
}

// TtsCatalog is TTS_PROVIDERS, rendered as an object keyed by id in this
// order.
type TtsCatalog struct {
	OpenAI     TtsProvider `json:"openai"`
	Azure      TtsProvider `json:"azure"`
	ElevenLabs TtsProvider `json:"elevenlabs"`
}

// TtsProviders is TTS_PROVIDERS.
var TtsProviders = TtsCatalog{
	OpenAI: TtsProvider{
		ID:    "openai",
		Label: "OpenAI",
		Description: "Sudah terpasang dan termurah, tetapi semua suaranya penutur asli Inggris — " +
			"bahasa Indonesia terdengar beraksen.",
		DefaultModel: "gpt-4o-mini-tts",
		Models:       []string{"gpt-4o-mini-tts", "tts-1", "tts-1-hd"},
		DefaultVoice: "coral",
		Voices: []TtsVoice{
			{ID: "alloy", Label: "Alloy (netral)"},
			{ID: "ash", Label: "Ash (pria, tenang)"},
			{ID: "ballad", Label: "Ballad (pria, hangat)"},
			{ID: "coral", Label: "Coral (wanita, ramah)"},
			{ID: "echo", Label: "Echo (pria)"},
			{ID: "fable", Label: "Fable (ekspresif)"},
			{ID: "nova", Label: "Nova (wanita, cerah)"},
			{ID: "onyx", Label: "Onyx (pria, dalam)"},
			{ID: "sage", Label: "Sage (wanita, kalem)"},
			{ID: "shimmer", Label: "Shimmer (wanita, lembut)"},
		},
		RequiredCredentials: []string{"API key OpenAI (Settings → Integrasi)"},
	},
	Azure: TtsProvider{
		ID:    "azure",
		Label: "Azure Speech",
		Description: "Punya suara id-ID asli sehingga pelafalannya lokal. Paling murah di antara opsi native " +
			"dan mendukung penyesuaian tempo.",
		DefaultModel: "neural",
		Models:       []string{"neural"},
		DefaultVoice: "id-ID-GadisNeural",
		Voices: []TtsVoice{
			{ID: "id-ID-GadisNeural", Label: "Gadis (wanita, id-ID)", NativeIndonesian: true,
				Note: "Cocok untuk nada HR yang menenangkan."},
			{ID: "id-ID-ArdiNeural", Label: "Ardi (pria, id-ID)", NativeIndonesian: true},
		},
		AllowCustomVoice:    true,
		RequiredCredentials: []string{"Azure Speech key", "Region (mis. southeastasia)"},
	},
	ElevenLabs: TtsProvider{
		ID:    "elevenlabs",
		Label: "ElevenLabs",
		Description: "Paling ekspresif dan bisa memakai suara hasil cloning, tetapi paling mahal. Modelnya " +
			"multilingual, bukan khusus Indonesia.",
		DefaultModel:        "eleven_multilingual_v2",
		Models:              []string{"eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"},
		DefaultVoice:        "",
		Voices:              []TtsVoice{},
		AllowCustomVoice:    true,
		RequiredCredentials: []string{"ElevenLabs API key", "Voice ID"},
	},
}

// TTS defaults and limits.
const (
	TtsDefaultProvider = "openai"
	TtsPreviewText     = "Perkenalkan diri Anda secara singkat, lalu ceritakan pengalaman kerja atau kegiatan " +
		"yang paling relevan dengan posisi ini."
	// TtsMaxInputChars bounds one synthesis call.
	TtsMaxInputChars = 600
)

// IsTtsProviderID is isTtsProviderId for the catalog's own keys.
func IsTtsProviderID(v any) bool {
	s, ok := v.(string)
	return ok && (s == "openai" || s == "azure" || s == "elevenlabs")
}

// GetTtsProvider is getTtsProvider: the provider, OpenAI for anything
// unknown.
func GetTtsProvider(id any) TtsProvider {
	s, _ := id.(string)
	switch s {
	case "azure":
		return TtsProviders.Azure
	case "elevenlabs":
		return TtsProviders.ElevenLabs
	}
	return TtsProviders.OpenAI
}

func trimmedString(v any) string {
	switch s := v.(type) {
	case string:
		return TrimJS(s)
	case *string:
		if s != nil {
			return TrimJS(*s)
		}
	}
	return ""
}

// ResolveTtsVoice is resolveTtsVoice: the voice when the catalog lists it
// or the provider allows custom voices, else the provider default.
func ResolveTtsVoice(providerID, voice any) string {
	p := GetTtsProvider(providerID)
	c := trimmedString(voice)
	if c == "" {
		return p.DefaultVoice
	}
	if p.AllowCustomVoice || slices.ContainsFunc(p.Voices, func(v TtsVoice) bool { return v.ID == c }) {
		return c
	}
	return p.DefaultVoice
}

// ResolveTtsModel is resolveTtsModel: a known model, else the default.
func ResolveTtsModel(providerID, model any) string {
	p := GetTtsProvider(providerID)
	if c := trimmedString(model); slices.Contains(p.Models, c) {
		return c
	}
	return p.DefaultModel
}
