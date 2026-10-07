package domain

import (
	"math"
	"strings"
)

// ProfileFields are the eight fields that make a profile complete.
// Strings use "" for missing; WAConsent is nil until the member chooses.
type ProfileFields struct {
	Name      *string `json:"name"`
	Phone     *string `json:"phone"`
	Email     *string `json:"email"`
	BirthDate *string `json:"birth_date"`
	Gender    *string `json:"gender"`
	City      *string `json:"city"`
	PhotoURL  *string `json:"photo_url"`
	WAConsent *bool   `json:"wa_consent"`
}

// ProfileFieldKeys lists the fields in PROFILE_FIELD_LABELS order.
var ProfileFieldKeys = []string{"name", "phone", "email", "birth_date", "gender", "city", "photo_url", "wa_consent"}

// ProfileFieldLabels are the Indonesian labels shown for missing fields.
var ProfileFieldLabels = map[string]string{
	"name":       "Nama",
	"phone":      "No. WhatsApp",
	"email":      "Email",
	"birth_date": "Tanggal lahir",
	"gender":     "Jenis kelamin",
	"city":       "Kota/domisili",
	"photo_url":  "Foto profil",
	"wa_consent": "Pilihan promo WA",
}

// ProfileCompletion is the completion summary.
type ProfileCompletion struct {
	Percent  int      `json:"percent"`
	Missing  []string `json:"missing"`
	Complete bool     `json:"complete"`
}

func filled(s *string) bool { return s != nil && strings.TrimSpace(*s) != "" }

// ComputeProfileCompletion mirrors computeProfileCompletion: a consent of
// false counts as filled because the member made a choice.
func ComputeProfileCompletion(f ProfileFields) ProfileCompletion {
	present := map[string]bool{
		"name":       filled(f.Name),
		"phone":      filled(f.Phone),
		"email":      filled(f.Email),
		"birth_date": filled(f.BirthDate),
		"gender":     filled(f.Gender),
		"city":       filled(f.City),
		"photo_url":  filled(f.PhotoURL),
		"wa_consent": f.WAConsent != nil,
	}
	missing := []string{}
	for _, key := range ProfileFieldKeys {
		if !present[key] {
			missing = append(missing, key)
		}
	}
	total := len(ProfileFieldKeys)
	percent := int(math.Floor(float64(total-len(missing))/float64(total)*100 + 0.5))
	return ProfileCompletion{Percent: percent, Missing: missing, Complete: len(missing) == 0}
}

// MissingLabels maps missing keys to their labels.
func MissingLabels(missing []string) []string {
	out := make([]string, 0, len(missing))
	for _, key := range missing {
		out = append(out, ProfileFieldLabels[key])
	}
	return out
}

// Tier is one active membership tier, ordered by rank ascending.
type Tier struct {
	Code            string
	Name            string
	MinLifetimeXP   float64
	DiscountPercent float64
}

// ResolveTierByXP picks the highest tier whose minimum the XP reaches; XP
// below the first tier still gets the first tier. nil when there are none.
func ResolveTierByXP(tiers []Tier, totalXP float64) *Tier {
	for i := len(tiers) - 1; i >= 0; i-- {
		if totalXP >= tiers[i].MinLifetimeXP {
			return &tiers[i]
		}
	}
	if len(tiers) > 0 {
		return &tiers[0]
	}
	return nil
}

// NextTier is the first tier whose minimum is above the XP.
func NextTier(tiers []Tier, totalXP float64) *Tier {
	for i := range tiers {
		if tiers[i].MinLifetimeXP > totalXP {
			return &tiers[i]
		}
	}
	return nil
}
