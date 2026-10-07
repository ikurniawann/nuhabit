package domain

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
)

// Appearance is AppearanceTokens (lib/theme/appearance-tokens.ts), in the
// key order parseAppearanceTokens builds.
type Appearance struct {
	PresetID string            `json:"presetId"`
	Base     AppearanceBase    `json:"base"`
	Sidebar  AppearanceSidebar `json:"sidebar"`
	Navbar   AppearanceNavbar  `json:"navbar"`
	Font     AppearanceFont    `json:"font"`
}

// AppearanceBase is AppearanceTokens.base.
type AppearanceBase struct {
	Background  string `json:"background"`
	Foreground  string `json:"foreground"`
	Card        string `json:"card"`
	Primary     string `json:"primary"`
	Secondary   string `json:"secondary"`
	Destructive string `json:"destructive"`
	Border      string `json:"border"`
	Input       string `json:"input"`
	Ring        string `json:"ring"`
}

// AppearanceSidebar is AppearanceTokens.sidebar.
type AppearanceSidebar struct {
	Background       string `json:"background"`
	Foreground       string `json:"foreground"`
	ActiveBackground string `json:"activeBackground"`
	ActiveForeground string `json:"activeForeground"`
	Border           string `json:"border"`
}

// AppearanceNavbar is AppearanceTokens.navbar.
type AppearanceNavbar struct {
	Background string `json:"background"`
	Foreground string `json:"foreground"`
	Border     string `json:"border"`
}

// AppearanceFont is AppearanceTokens.font.
type AppearanceFont struct {
	Family string `json:"family"`
	Size   int    `json:"size"`
}

// DefaultAppearance is DEFAULT_APPEARANCE.
var DefaultAppearance = Appearance{
	PresetID: "nuhabit",
	Base: AppearanceBase{
		Background: "#fdfff2", Foreground: "#131a1c", Card: "#fdfff2", Primary: "#daff59", Secondary: "#00281a",
		Destructive: "#b3262c", Border: "#e3dbcc", Input: "#e3dbcc", Ring: "#203b32",
	},
	Sidebar: AppearanceSidebar{
		Background: "#131a1c", Foreground: "#fdfff2", ActiveBackground: "#daff59", ActiveForeground: "#00281a",
		Border: "#131a1c",
	},
	Navbar: AppearanceNavbar{Background: "#f3ece2", Foreground: "#131a1c", Border: "#e3dbcc"},
	Font:   AppearanceFont{Family: "manrope", Size: 16},
}

// themePresets are the THEME_PRESETS ids (lib/theme/presets.ts).
var themePresets = []string{"nuhabit", "wonderland", "ocean", "emerald", "graphite", "sunset"}

// fontFamilies are the FONT_STACKS keys.
var fontFamilies = []string{
	"roundo", "inter", "jakarta", "poppins", "dm-sans", "nunito", "outfit", "manrope", "figtree", "roboto",
	"open-sans", "lato", "source-sans", "work-sans", "ibm-plex-sans", "rubik", "mulish", "urbanist", "sora",
	"space-grotesk", "public-sans", "noto-sans", "karla", "lora", "merriweather", "source-serif",
	"jetbrains-mono", "ibm-plex-mono", "system",
}

var (
	hex3 = regexp.MustCompile(`^[0-9a-f]{3}$`)
	hex6 = regexp.MustCompile(`^[0-9a-f]{6}$`)
)

// normalizeHex is normalizeHex (lib/theme/palette.ts); ok is false where the
// TS throws.
func normalizeHex(input string) (string, bool) {
	h := strings.TrimPrefix(strings.ToLower(TrimJS(input)), "#")
	if hex3.MatchString(h) {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if !hex6.MatchString(h) {
		return "", false
	}
	return "#" + h, true
}

func safeHex(obj map[string]any, key, fallback string) string {
	s, ok := obj[key].(string)
	if !ok {
		return fallback
	}
	if h, ok := normalizeHex(s); ok {
		return h
	}
	return fallback
}

func child(obj map[string]any, key string) map[string]any {
	if m, ok := obj[key].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// fontSize is isFontSize: exactly 14, 15 or 16.
func fontSize(v any) (int, bool) {
	var f float64
	switch x := v.(type) {
	case json.Number:
		n, err := x.Float64()
		if err != nil {
			return 0, false
		}
		f = n
	case float64:
		f = x
	default:
		return 0, false
	}
	switch f {
	case 14, 15, 16:
		return int(f), true
	}
	return 0, false
}

// ParseAppearance is parseAppearanceTokens over a decoded JSON value: every
// missing or invalid token falls back to DefaultAppearance.
func ParseAppearance(raw any) Appearance {
	out := DefaultAppearance
	obj, ok := raw.(map[string]any)
	if !ok {
		return out
	}
	if id, ok := obj["presetId"].(string); ok && slices.Contains(themePresets, id) {
		out.PresetID = id
	}
	d := DefaultAppearance
	base := child(obj, "base")
	out.Base = AppearanceBase{
		Background:  safeHex(base, "background", d.Base.Background),
		Foreground:  safeHex(base, "foreground", d.Base.Foreground),
		Card:        safeHex(base, "card", d.Base.Card),
		Primary:     safeHex(base, "primary", d.Base.Primary),
		Secondary:   safeHex(base, "secondary", d.Base.Secondary),
		Destructive: safeHex(base, "destructive", d.Base.Destructive),
		Border:      safeHex(base, "border", d.Base.Border),
		Input:       safeHex(base, "input", d.Base.Input),
		Ring:        safeHex(base, "ring", d.Base.Ring),
	}
	sidebar := child(obj, "sidebar")
	out.Sidebar = AppearanceSidebar{
		Background:       safeHex(sidebar, "background", d.Sidebar.Background),
		Foreground:       safeHex(sidebar, "foreground", d.Sidebar.Foreground),
		ActiveBackground: safeHex(sidebar, "activeBackground", d.Sidebar.ActiveBackground),
		ActiveForeground: safeHex(sidebar, "activeForeground", d.Sidebar.ActiveForeground),
		Border:           safeHex(sidebar, "border", d.Sidebar.Border),
	}
	navbar := child(obj, "navbar")
	out.Navbar = AppearanceNavbar{
		Background: safeHex(navbar, "background", d.Navbar.Background),
		Foreground: safeHex(navbar, "foreground", d.Navbar.Foreground),
		Border:     safeHex(navbar, "border", d.Navbar.Border),
	}
	font := child(obj, "font")
	if family, ok := font["family"].(string); ok && slices.Contains(fontFamilies, family) {
		out.Font.Family = family
	}
	if size, ok := fontSize(font["size"]); ok {
		out.Font.Size = size
	}
	return out
}
