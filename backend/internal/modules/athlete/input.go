package athlete

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"nuhabit/backend/internal/modules/athlete/domain"
)

// Request bodies, validated like the zod schemas in frontend/src/lib/gym/athlete-route.ts:
// lengths count UTF-16 code units, trim is String.prototype.trim, optional
// fields reject null unless the schema is nullable, and any failure (including
// malformed JSON) is a 400 with the schema's message.

// opt records whether a JSON key was present and whether it was null.
type opt[T any] struct {
	Set  bool
	Null bool
	V    T
}

func (o *opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.V)
}

// given is a present, non-null value.
func (o opt[T]) given() bool { return o.Set && !o.Null }

const maxBodyBytes = 16 << 20

// decodeBody reads a JSON object body. false means the TS `request.json()`
// would have failed or produced something other than an object.
func decodeBody(r *http.Request, dst any) bool {
	if r.Body == nil {
		return false
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		return false
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return false
	}
	return json.Unmarshal(raw, dst) == nil
}

// jsLen is String.prototype.length.
func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

// jsSlice is String.prototype.slice(0, n), dropping a split surrogate pair.
func jsSlice(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	units = units[:n]
	if last := units[n-1]; last >= 0xD800 && last <= 0xDBFF {
		units = units[:n-1]
	}
	return string(utf16.Decode(units))
}

// jsTrim is String.prototype.trim (ECMAScript WhiteSpace + LineTerminator).
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
			return true
		}
		return r >= 0x2000 && r <= 0x200A
	})
}

var guidRe = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`)

// isGUID is z.guid().
func isGUID(s string) bool { return guidRe.MatchString(s) }

// isoDateTimeRe is z.iso.datetime({ offset: true }) from zod 4.
var isoDateTimeRe = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|([+-](?:[01]\d|2[0-3]):[0-5]\d)))$`)

var isoPartsRe = regexp.MustCompile(`^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d+))?)?(Z|[+-]\d\d:\d\d)$`)

// parseISODateTime validates like zod and parses like `new Date(s)` (millisecond precision).
func parseISODateTime(s string) (time.Time, bool) {
	if !isoDateTimeRe.MatchString(s) {
		return time.Time{}, false
	}
	m := isoPartsRe.FindStringSubmatch(s)
	if m == nil {
		return time.Time{}, false
	}
	n := func(v string) int { i, _ := strconv.Atoi(v); return i }
	ms := 0
	if frac := m[7]; frac != "" {
		ms = n((frac + "00")[:3])
	}
	t := time.Date(n(m[1]), time.Month(n(m[2])), n(m[3]), n(m[4]), n(m[5]), n(m[6]), ms*int(time.Millisecond), time.UTC)
	if zone := m[8]; zone != "Z" {
		offset := time.Duration(n(zone[1:3]))*time.Hour + time.Duration(n(zone[4:6]))*time.Minute
		if zone[0] == '+' {
			t = t.Add(-offset)
		} else {
			t = t.Add(offset)
		}
	}
	return t, true
}

func oneOf(v string, list []string) bool {
	for _, x := range list {
		if v == x {
			return true
		}
	}
	return false
}

// stringField validates an optional string with a default and a max length.
func stringField(o opt[string], max int) (string, bool) {
	if !o.Set {
		return "", true
	}
	return o.V, !o.Null && jsLen(o.V) <= max
}

// trimmedField is z.string().trim().min(min).max(max), required.
func trimmedField(o opt[string], min, max int) (string, bool) {
	if !o.given() {
		return "", false
	}
	v := jsTrim(o.V)
	n := jsLen(v)
	return v, n >= min && n <= max
}

// ── saveActivitySchema ───────────────────────────────────────────────────────

type trackPointBody struct {
	T   opt[float64] `json:"t"`
	Lat opt[float64] `json:"lat"`
	Lng opt[float64] `json:"lng"`
	Ele opt[float64] `json:"ele"`
}

type saveActivityBody struct {
	Type             opt[string]           `json:"type"`
	Title            opt[string]           `json:"title"`
	Description      opt[string]           `json:"description"`
	StartedAt        opt[string]           `json:"startedAt"`
	Points           opt[[]trackPointBody] `json:"points"`
	ManualElapsedSec opt[float64]          `json:"manualElapsedSec"`
	GearID           opt[string]           `json:"gearId"`
	Visibility       opt[string]           `json:"visibility"`
	Photos           opt[[]opt[string]]    `json:"photos"`
}

// SaveActivityInput is a validated recording.
type SaveActivityInput struct {
	Type             string
	Title            string
	Description      string
	StartedAt        *time.Time
	Points           []domain.TrackPoint
	ManualElapsedSec *float64
	GearID           *string
	Visibility       string
	Photos           []string
}

const maxTrackPoints = 50_000

func (b saveActivityBody) validate() (SaveActivityInput, bool) {
	in := SaveActivityInput{Points: []domain.TrackPoint{}, Photos: []string{}}
	var ok bool
	if !b.Type.given() || !oneOf(b.Type.V, domain.ActivityTypes) {
		return in, false
	}
	in.Type = b.Type.V
	if in.Title, ok = stringField(b.Title, 120); !ok {
		return in, false
	}
	if in.Description, ok = stringField(b.Description, 2000); !ok {
		return in, false
	}
	if b.StartedAt.given() {
		t, ok := parseISODateTime(b.StartedAt.V)
		if !ok {
			return in, false
		}
		in.StartedAt = &t
	}
	if b.Points.Set {
		if b.Points.Null || len(b.Points.V) > maxTrackPoints {
			return in, false
		}
		for _, p := range b.Points.V {
			if !p.T.given() || p.T.V < 0 ||
				!p.Lat.given() || p.Lat.V < -90 || p.Lat.V > 90 ||
				!p.Lng.given() || p.Lng.V < -180 || p.Lng.V > 180 ||
				(p.Ele.Set && p.Ele.Null) {
				return in, false
			}
			point := domain.TrackPoint{T: p.T.V, Lat: p.Lat.V, Lng: p.Lng.V}
			if p.Ele.Set {
				ele := p.Ele.V
				point.Ele = &ele
			}
			in.Points = append(in.Points, point)
		}
	}
	if b.ManualElapsedSec.given() {
		v := b.ManualElapsedSec.V
		if v != math.Trunc(v) || v <= 0 || v > 24*3600 {
			return in, false
		}
		in.ManualElapsedSec = &v
	}
	if b.GearID.given() {
		if !isGUID(b.GearID.V) {
			return in, false
		}
		in.GearID = &b.GearID.V
	}
	in.Visibility = domain.VisibilityEveryone
	if b.Visibility.Set {
		if b.Visibility.Null || !oneOf(b.Visibility.V, domain.ActivityVisibilities) {
			return in, false
		}
		in.Visibility = b.Visibility.V
	}
	if b.Photos.Set {
		if b.Photos.Null || len(b.Photos.V) > domain.MaxActivityPhotos {
			return in, false
		}
		for _, p := range b.Photos.V {
			if !p.given() || jsLen(p.V) > domain.MaxPhotoBytes {
				return in, false
			}
			in.Photos = append(in.Photos, p.V)
		}
	}
	return in, true
}

// ── updateActivitySchema ─────────────────────────────────────────────────────

type updateActivityBody struct {
	Title       opt[string] `json:"title"`
	Description opt[string] `json:"description"`
	Visibility  opt[string] `json:"visibility"`
	GearID      opt[string] `json:"gearId"`
}

// ActivityPatch is a validated partial update; GearSet with a nil GearID clears the gear.
type ActivityPatch struct {
	Title       *string
	Description *string
	Visibility  *string
	GearSet     bool
	GearID      *string
}

func (b updateActivityBody) validate() (ActivityPatch, bool) {
	var p ActivityPatch
	if b.Title.Set {
		if b.Title.Null || jsLen(b.Title.V) < 1 || jsLen(b.Title.V) > 120 {
			return p, false
		}
		p.Title = &b.Title.V
	}
	if b.Description.Set {
		if b.Description.Null || jsLen(b.Description.V) > 2000 {
			return p, false
		}
		p.Description = &b.Description.V
	}
	if b.Visibility.Set {
		if b.Visibility.Null || !oneOf(b.Visibility.V, domain.ActivityVisibilities) {
			return p, false
		}
		p.Visibility = &b.Visibility.V
	}
	if b.GearID.Set {
		p.GearSet = true
		if !b.GearID.Null {
			if !isGUID(b.GearID.V) {
				return p, false
			}
			p.GearID = &b.GearID.V
		}
	}
	return p, true
}

// ── commentSchema, saveRouteSchema, gearSchema ───────────────────────────────

type commentBody struct {
	Text opt[string] `json:"text"`
}

func (b commentBody) validate() (string, bool) {
	return trimmedField(b.Text, 1, domain.MaxCommentLength)
}

type saveRouteBody struct {
	ActivityID opt[string] `json:"activityId"`
	Name       opt[string] `json:"name"`
}

type routeInput struct{ ActivityID, Name string }

func (b saveRouteBody) validate() (routeInput, bool) {
	if !b.ActivityID.given() || !isGUID(b.ActivityID.V) {
		return routeInput{}, false
	}
	name, ok := trimmedField(b.Name, 2, 80)
	return routeInput{ActivityID: b.ActivityID.V, Name: name}, ok
}

type gearBody struct {
	Name    opt[string] `json:"name"`
	Kind    opt[string] `json:"kind"`
	Retired opt[bool]   `json:"retired"`
}

// GearInput is a validated gear create/update.
type GearInput struct {
	Name    string
	Kind    string
	Retired bool
}

func (b gearBody) validate() (GearInput, bool) {
	var in GearInput
	var ok bool
	if in.Name, ok = trimmedField(b.Name, 2, 60); !ok {
		return in, false
	}
	if !b.Kind.given() || !oneOf(b.Kind.V, domain.GearKinds) {
		return in, false
	}
	in.Kind = b.Kind.V
	if b.Retired.Set {
		if b.Retired.Null {
			return in, false
		}
		in.Retired = b.Retired.V
	}
	return in, true
}

// ── settingsSchema (train) and the home settings patch ───────────────────────

var (
	unitsValues    = []string{"METRIC", "IMPERIAL"}
	languageValues = []string{"EN", "ID"}
)

type settingsBody struct {
	Units            opt[string]  `json:"units"`
	BookingReminders opt[bool]    `json:"bookingReminders"`
	WeeklyGoalKm     opt[float64] `json:"weeklyGoalKm"`
	Language         opt[string]  `json:"language"`
}

// SettingsPatch is a validated partial settings update; GoalSet with a nil
// WeeklyGoalKm removes the target.
type SettingsPatch struct {
	Units            *string
	BookingReminders *bool
	GoalSet          bool
	WeeklyGoalKm     *float64
	Language         *string
}

// homeSettingsBody is the home settings PATCH schema: no weeklyGoalKm key.
type homeSettingsBody struct {
	Units            opt[string] `json:"units"`
	BookingReminders opt[bool]   `json:"bookingReminders"`
	Language         opt[string] `json:"language"`
}

func (b homeSettingsBody) validate() (SettingsPatch, bool) {
	return settingsBody{Units: b.Units, BookingReminders: b.BookingReminders, Language: b.Language}.validate()
}

// validate ports settingsSchema.
func (b settingsBody) validate() (SettingsPatch, bool) {
	var p SettingsPatch
	if b.Units.Set {
		if b.Units.Null || !oneOf(b.Units.V, unitsValues) {
			return p, false
		}
		p.Units = &b.Units.V
	}
	if b.BookingReminders.Set {
		if b.BookingReminders.Null {
			return p, false
		}
		p.BookingReminders = &b.BookingReminders.V
	}
	if b.WeeklyGoalKm.Set {
		p.GoalSet = true
		if !b.WeeklyGoalKm.Null {
			if v := b.WeeklyGoalKm.V; v <= 0 || v > 1000 {
				return p, false
			}
			p.WeeklyGoalKm = &b.WeeklyGoalKm.V
		}
	}
	if b.Language.Set {
		if b.Language.Null || !oneOf(b.Language.V, languageValues) {
			return p, false
		}
		p.Language = &b.Language.V
	}
	return p, true
}
