package domain

import (
	"fmt"
	"math"
	"strings"
)

// Rules are the gym business rules (gym.business_rules): a global row
// (branch_id NULL) plus per-branch overrides that hold only the keys that differ.
type Rules struct {
	// CreditExpiryDays is the default validity of bonus/adjustment credits.
	CreditExpiryDays int `json:"creditExpiryDays"`
	// CancellationDeadlineHours: cancelling closer than this to the start is late.
	CancellationDeadlineHours int    `json:"cancellationDeadlineHours"`
	LateCancelPolicy          string `json:"lateCancelPolicy"`
	NoShowPolicy              string `json:"noShowPolicy"`
	ReEntryGraceMin           int    `json:"reEntryGraceMin"`
	AntiPassbackMin           int    `json:"antiPassbackMin"`
	QRTTLSec                  int    `json:"qrTtlSec"`
	WaitlistAutoPromote       bool   `json:"waitlistAutoPromote"`
	// LowBalanceThreshold: a balance at or below this is low.
	LowBalanceThreshold    int `json:"lowBalanceThreshold"`
	ExpiryReminderDays     int `json:"expiryReminderDays"`
	BookingOpensDaysBefore int `json:"bookingOpensDaysBefore"`
	BookingClosesMinBefore int `json:"bookingClosesMinBefore"`
}

// RulesPatch is a partial rule set; nil fields are absent.
type RulesPatch struct {
	CreditExpiryDays          *int    `json:"creditExpiryDays,omitempty"`
	CancellationDeadlineHours *int    `json:"cancellationDeadlineHours,omitempty"`
	LateCancelPolicy          *string `json:"lateCancelPolicy,omitempty"`
	NoShowPolicy              *string `json:"noShowPolicy,omitempty"`
	ReEntryGraceMin           *int    `json:"reEntryGraceMin,omitempty"`
	AntiPassbackMin           *int    `json:"antiPassbackMin,omitempty"`
	QRTTLSec                  *int    `json:"qrTtlSec,omitempty"`
	WaitlistAutoPromote       *bool   `json:"waitlistAutoPromote,omitempty"`
	LowBalanceThreshold       *int    `json:"lowBalanceThreshold,omitempty"`
	ExpiryReminderDays        *int    `json:"expiryReminderDays,omitempty"`
	BookingOpensDaysBefore    *int    `json:"bookingOpensDaysBefore,omitempty"`
	BookingClosesMinBefore    *int    `json:"bookingClosesMinBefore,omitempty"`
}

// IsEmpty reports whether no key is set.
func (p RulesPatch) IsEmpty() bool { return p == RulesPatch{} }

// RuleDefaults mirror GYM_RULE_DEFAULTS.
var RuleDefaults = Rules{
	CreditExpiryDays:          60,
	CancellationDeadlineHours: 4,
	LateCancelPolicy:          "forfeit",
	NoShowPolicy:              "forfeit",
	ReEntryGraceMin:           15,
	AntiPassbackMin:           60,
	QRTTLSec:                  45,
	WaitlistAutoPromote:       true,
	LowBalanceThreshold:       3,
	ExpiryReminderDays:        7,
	BookingOpensDaysBefore:    7,
	BookingClosesMinBefore:    0,
}

type ruleKind int

const (
	kindInt ruleKind = iota
	kindPolicy
	kindBool
)

// ruleSpec is one key of the rules shape, with the bounds of the reference
// schema's CHECK constraints and the Indonesian labels of rules.ts.
type ruleSpec struct {
	key      string
	kind     ruleKind
	min, max int
	label    string
	intField func(*RulesPatch) **int
	strField func(*RulesPatch) **string
	boolFld  func(*RulesPatch) **bool
}

func intRule(key string, lo, hi int, label string, f func(*RulesPatch) **int) ruleSpec {
	return ruleSpec{key: key, kind: kindInt, min: lo, max: hi, label: label, intField: f}
}

func policyRule(key string, f func(*RulesPatch) **string) ruleSpec {
	return ruleSpec{key: key, kind: kindPolicy, strField: f}
}

// ruleSpecs is in GYM_RULE_KEYS order.
var ruleSpecs = []ruleSpec{
	intRule("creditExpiryDays", 1, 3650, "Masa berlaku kredit", func(p *RulesPatch) **int { return &p.CreditExpiryDays }),
	intRule("cancellationDeadlineHours", 0, 720, "Batas batal", func(p *RulesPatch) **int { return &p.CancellationDeadlineHours }),
	policyRule("lateCancelPolicy", func(p *RulesPatch) **string { return &p.LateCancelPolicy }),
	policyRule("noShowPolicy", func(p *RulesPatch) **string { return &p.NoShowPolicy }),
	intRule("reEntryGraceMin", 0, 1440, "Grace masuk ulang", func(p *RulesPatch) **int { return &p.ReEntryGraceMin }),
	intRule("antiPassbackMin", 0, 1440, "Anti-passback", func(p *RulesPatch) **int { return &p.AntiPassbackMin }),
	intRule("qrTtlSec", 10, 3600, "Umur QR", func(p *RulesPatch) **int { return &p.QRTTLSec }),
	{key: "waitlistAutoPromote", kind: kindBool, boolFld: func(p *RulesPatch) **bool { return &p.WaitlistAutoPromote }},
	intRule("lowBalanceThreshold", 0, 1000, "Ambang saldo menipis", func(p *RulesPatch) **int { return &p.LowBalanceThreshold }),
	intRule("expiryReminderDays", 1, 365, "Pengingat kedaluwarsa", func(p *RulesPatch) **int { return &p.ExpiryReminderDays }),
	intRule("bookingOpensDaysBefore", 0, 365, "Booking dibuka", func(p *RulesPatch) **int { return &p.BookingOpensDaysBefore }),
	intRule("bookingClosesMinBefore", 0, 10080, "Booking ditutup", func(p *RulesPatch) **int { return &p.BookingClosesMinBefore }),
}

// RuleKeys lists the rule keys in canonical order.
func RuleKeys() []string {
	keys := make([]string, len(ruleSpecs))
	for i, s := range ruleSpecs {
		keys[i] = s.key
	}
	return keys
}

// check validates one decoded JSON value (float64/string/bool, nil when
// null or missing) and stores it in p only when valid. It returns the zod
// issue message, or "" when valid.
func (s ruleSpec) check(v any, p *RulesPatch) string {
	switch s.kind {
	case kindInt:
		n, ok := v.(float64)
		if !ok {
			return s.label + " harus berupa angka"
		}
		if !isSafeInteger(n) {
			return s.label + " harus bilangan bulat"
		}
		if n < float64(s.min) {
			return fmt.Sprintf("%s minimal %d", s.label, s.min)
		}
		if n > float64(s.max) {
			return fmt.Sprintf("%s maksimal %d", s.label, s.max)
		}
		i := int(n)
		*s.intField(p) = &i
	case kindPolicy:
		str, ok := v.(string)
		if !ok || (str != "forfeit" && str != "free") {
			return "Kebijakan harus forfeit atau free"
		}
		*s.strField(p) = &str
	case kindBool:
		b, ok := v.(bool)
		if !ok {
			return "Promosi waitlist harus ya/tidak"
		}
		*s.boolFld(p) = &b
	}
	return ""
}

func isSafeInteger(n float64) bool {
	return n == math.Trunc(n) && math.Abs(n) <= 1<<53-1
}

// KV is one key of a JSON object in input order.
type KV struct {
	Key   string
	Value any
}

func lookup(obj []KV, key string) (any, bool) {
	for _, kv := range obj {
		if kv.Key == key {
			return kv.Value, true
		}
	}
	return nil, false
}

// validateRules mirrors the strict zod object: the first failing key (shape
// order) wins, then unknown keys in input order.
func validateRules(obj []KV, partial bool) (RulesPatch, string) {
	var p RulesPatch
	for _, s := range ruleSpecs {
		v, present := lookup(obj, s.key)
		if !present && partial {
			continue
		}
		if msg := s.check(v, &p); msg != "" {
			return RulesPatch{}, s.key + ": " + msg
		}
	}
	var unknown []string
	for _, kv := range obj {
		if !isRuleKey(kv.Key) {
			unknown = append(unknown, kv.Key)
		}
	}
	if len(unknown) > 0 {
		return RulesPatch{}, "Kunci aturan tidak dikenal: " + strings.Join(unknown, ", ")
	}
	return p, ""
}

func isRuleKey(key string) bool {
	for _, s := range ruleSpecs {
		if s.key == key {
			return true
		}
	}
	return false
}

// ValidateRules validates a complete global rule set (every key required).
// It returns the error message, or "" with the rules.
func ValidateRules(obj []KV) (Rules, string) {
	p, msg := validateRules(obj, false)
	if msg != "" {
		return Rules{}, msg
	}
	return p.Over(Rules{}), ""
}

// ValidateRulesPatch validates a branch override: only the keys sent.
func ValidateRulesPatch(obj []KV) (RulesPatch, string) {
	return validateRules(obj, true)
}

// SanitizeStoredRules keeps only known keys with valid values from stored
// JSON (a decoded map). Old or corrupt data must not break booking.
func SanitizeStoredRules(raw any) RulesPatch {
	obj, ok := raw.(map[string]any)
	if !ok {
		return RulesPatch{}
	}
	var p RulesPatch
	for _, s := range ruleSpecs {
		v, present := obj[s.key]
		if !present {
			continue
		}
		s.check(v, &p) // stores the value only when it is valid
	}
	return p
}

// Over returns base with every set key of p applied.
func (p RulesPatch) Over(base Rules) Rules {
	setInt := func(dst *int, v *int) {
		if v != nil {
			*dst = *v
		}
	}
	setInt(&base.CreditExpiryDays, p.CreditExpiryDays)
	setInt(&base.CancellationDeadlineHours, p.CancellationDeadlineHours)
	if p.LateCancelPolicy != nil {
		base.LateCancelPolicy = *p.LateCancelPolicy
	}
	if p.NoShowPolicy != nil {
		base.NoShowPolicy = *p.NoShowPolicy
	}
	setInt(&base.ReEntryGraceMin, p.ReEntryGraceMin)
	setInt(&base.AntiPassbackMin, p.AntiPassbackMin)
	setInt(&base.QRTTLSec, p.QRTTLSec)
	if p.WaitlistAutoPromote != nil {
		base.WaitlistAutoPromote = *p.WaitlistAutoPromote
	}
	setInt(&base.LowBalanceThreshold, p.LowBalanceThreshold)
	setInt(&base.ExpiryReminderDays, p.ExpiryReminderDays)
	setInt(&base.BookingOpensDaysBefore, p.BookingOpensDaysBefore)
	setInt(&base.BookingClosesMinBefore, p.BookingClosesMinBefore)
	return base
}

// ResolveRules layers defaults, then global, then the branch override.
// Arguments are decoded stored JSON (nil when absent).
func ResolveRules(globalRaw, branchRaw any) Rules {
	return SanitizeStoredRules(branchRaw).Over(SanitizeStoredRules(globalRaw).Over(RuleDefaults))
}
