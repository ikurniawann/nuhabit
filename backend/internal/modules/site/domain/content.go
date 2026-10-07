// Package domain holds the public site's content model: the shape of each
// site.content key, its defaults and its validation. No database or HTTP.
package domain

import (
	"maps"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Kind is the type of one content field.
type Kind int

const (
	// Text is a short single-line string.
	Text Kind = iota
	// Long is a paragraph or markdown body.
	Long
	// URL is an absolute http(s) URL or a site-relative path.
	URL
	// Strings is a list of short strings.
	Strings
	// Object is a nested object with Fields.
	Object
	// Objects is a list of objects with Fields.
	Objects
)

// Field describes one key of a content object.
type Field struct {
	Name   string
	Kind   Kind
	Fields []Field // Object and Objects
}

const (
	textMax    = 300
	longMax    = 50000
	urlMax     = 1000
	listMax    = 40
	stringsMax = 60
)

func text(name string) Field  { return Field{Name: name, Kind: Text} }
func long(name string) Field  { return Field{Name: name, Kind: Long} }
func link(name string) Field  { return Field{Name: name, Kind: URL} }
func lines(name string) Field { return Field{Name: name, Kind: Strings} }
func object(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Object, Fields: fields}
}
func objects(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Objects, Fields: fields}
}

// Schemas is the shape of every content key, in the order the editor
// shows the fields.
var Schemas = map[string][]Field{
	"home": {
		object("hero", text("kicker"), text("title"), long("subtitle"), link("video_url"), link("image_url"), text("cta_label")),
		objects("partners", text("name"), link("logo_url")),
		objects("pillars", text("code"), text("title"), long("text")),
		object("mission", long("quote"), text("author")),
		objects("reel", link("image_url"), text("caption")),
	},
	"training": {
		object("intro", text("title"), long("text")),
		objects("class_types", text("name"), text("duration"), long("text")),
		object("block", text("title"), long("text"), objects("phases", text("name"), text("weeks"), long("text"))),
		object("laws", text("title"), lines("items")),
	},
	"space": {
		text("title"),
		long("intro"),
		objects("sections", text("title"), long("text"), link("image_url")),
	},
	"brand": {
		text("title"),
		long("intro"),
		long("story_md"),
		objects("values", text("title"), long("text")),
		link("image_url"),
	},
	"social": {
		link("instagram"), link("tiktok"), link("youtube"), text("whatsapp"), text("email"),
	},
	"legal_privacy": {text("title"), long("body_md")},
	"legal_terms":   {text("title"), long("body_md")},
	"analytics":     {text("gtm_id"), text("meta_pixel_id")},
}

// Keys lists the content keys in a stable order.
func Keys() []string { return slices.Sorted(maps.Keys(Schemas)) }

// IsKey reports whether key is a content key.
func IsKey(key string) bool {
	_, ok := Schemas[key]
	return ok
}

// Defaults is what the public site renders before staff edit a key.
var Defaults = map[string]map[string]any{
	"home": {
		"hero": map[string]any{
			"kicker":    "HYROX training gym",
			"title":     "Training that makes you strong for life, not only for the gym.",
			"subtitle":  "Small classes, certified coaches and a measurable 8-week program. Start with a free trial session at your nearest branch.",
			"video_url": "",
			"image_url": "",
			"cta_label": "Start a Trial",
		},
		"partners": []any{},
		"pillars": []any{
			map[string]any{"code": "STATION", "title": "Station", "text": "The eight HYROX stations: SkiErg, sled push, sled pull, burpee broad jump, rowing, farmer's carry, sandbag lunge and wall balls. You learn the technique before the load goes up."},
			map[string]any{"code": "ENGINE", "title": "Engine", "text": "Running and aerobic conditioning built step by step. You know your zones, your pace and your progress every week."},
			map[string]any{"code": "++", "title": "Community", "text": "Race together, recover together, and classes that expect you to show up. A new habit is easier when you are not alone."},
		},
		"mission": map[string]any{
			"quote":  "We believe small, consistent habits change bodies and lives. NüHabit exists so you have the place, the program and the people to keep them.",
			"author": "The NüHabit team",
		},
		"reel": []any{},
	},
	"training": {
		"intro": map[string]any{
			"title": "One method, three class types.",
			"text":  "Every class follows the same 8-week block, so whatever your schedule, your progress stays measurable.",
		},
		"class_types": []any{
			map[string]any{"name": "Station", "duration": "60 minutes", "text": "Strength and technique on the eight HYROX stations, with the load rising each phase."},
			map[string]any{"name": "Engine", "duration": "60 minutes", "text": "Running intervals and cardio machines to build aerobic capacity."},
			map[string]any{"name": "Race Sim", "duration": "75 minutes", "text": "A full race simulation at the end of every block. Record your time and compare it with the last block."},
		},
		"block": map[string]any{
			"title": "An 8-week block in 4 phases",
			"text":  "Every block opens with a baseline test and closes with a race simulation.",
			"phases": []any{
				map[string]any{"name": "Phase 1: Foundation", "weeks": "Weeks 1-2", "text": "Technique, mobility and the baseline test."},
				map[string]any{"name": "Phase 2: Build", "weeks": "Weeks 3-4", "text": "Volume goes up, station loads rise step by step."},
				map[string]any{"name": "Phase 3: Intensity", "weeks": "Weeks 5-6", "text": "Harder intervals, shorter rests."},
				map[string]any{"name": "Phase 4: Peak", "weeks": "Weeks 7-8", "text": "Taper, race simulation and review."},
			},
		},
		"laws": map[string]any{
			"title": "The NüHabit Laws",
			"items": []any{
				"Arrive on time. The warm-up is part of the class.",
				"Technique first, load second.",
				"Put the equipment back after you use it.",
				"Cheer for the person next to you.",
				"Rest is training too. Sleep enough.",
			},
		},
	},
	"space": {
		"title": "A training space built for HYROX.",
		"intro": "Rig, running turf, sled lanes and a recovery area on one floor. Every branch follows the same standard.",
		"sections": []any{
			map[string]any{"title": "Rig & stations", "text": "A modular rig, SkiErgs, rowers, sleds and wall ball targets in every lane.", "image_url": ""},
			map[string]any{"title": "Turf", "text": "Turf lanes for sled push, sled pull and farmer's carry.", "image_url": ""},
			map[string]any{"title": "Recovery", "text": "A mobility area, foam rollers, and lockers with showers.", "image_url": ""},
		},
	},
	"brand": {
		"title":    "Our story",
		"intro":    "NüHabit started with one question: why does good training so rarely turn into a habit?",
		"story_md": "We started in one small room with one rig and a handful of members who wanted to finish their first HYROX race. What we learned was simple: a clear program, coaches who show up, and training partners who expect you bring people back.\n\nToday every NüHabit branch runs the same method, and every member has a progress record they can take to any branch.",
		"values": []any{
			map[string]any{"title": "Consistent", "text": "Habits beat motivation."},
			map[string]any{"title": "Measurable", "text": "Every block has a starting number and a finishing number."},
			map[string]any{"title": "Together", "text": "Training feels lighter when someone is waiting for you."},
		},
		"image_url": "",
	},
	"social": {
		"instagram": "https://instagram.com/nuhabit",
		"tiktok":    "",
		"youtube":   "",
		"whatsapp":  "",
		"email":     "hello@nuhabit.id",
	},
	"legal_privacy": {
		"title":   "Privacy Policy",
		"body_md": "NüHabit stores the data you give us when you sign up, book a class or shop: your name, phone number, email and transaction history. We use it to run your membership and never sell it to anyone else.\n\nYou can request a copy or the deletion of your data through the contact details on this page.",
	},
	"legal_terms": {
		"title":   "Terms & Conditions",
		"body_md": "By buying a plan or attending a class at NüHabit, you agree to the gym rules, the class cancellation policy and the plan validity shown at purchase.\n\nPlans already purchased are not refundable unless applicable law says otherwise.",
	},
	"analytics": {
		"gtm_id":        "",
		"meta_pixel_id": "",
	},
}

// Default is a fresh copy of the key's defaults (nil for an unknown key).
func Default(key string) map[string]any {
	d, ok := Defaults[key]
	if !ok {
		return nil
	}
	return cloneMap(d)
}

// Merge overlays the stored value on the key's defaults: maps merge key
// by key at every depth, scalars and lists from stored win.
func Merge(key string, stored map[string]any) map[string]any {
	return mergeMaps(Default(key), stored)
}

func mergeMaps(base, over map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for k, v := range over {
		bm, bok := base[k].(map[string]any)
		vm, vok := v.(map[string]any)
		if bok && vok {
			base[k] = mergeMaps(bm, vm)
			continue
		}
		base[k] = v
	}
	return base
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch x := v.(type) {
		case map[string]any:
			out[k] = cloneMap(x)
		case []any:
			out[k] = cloneList(x)
		default:
			out[k] = v
		}
	}
	return out
}

func cloneList(l []any) []any {
	out := make([]any, len(l))
	for i, v := range l {
		if m, ok := v.(map[string]any); ok {
			out[i] = cloneMap(m)
		} else {
			out[i] = v
		}
	}
	return out
}

// ValidURL accepts an empty value, an absolute http(s) URL or a
// site-relative path.
func ValidURL(s string) bool {
	if s == "" || strings.HasPrefix(s, "/") {
		return !strings.HasPrefix(s, "//")
	}
	return (strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")) && validate.ValidURL(s)
}

var urlCheck = func(s string) (string, string, bool) { return "invalid_format", "URL tidak valid", ValidURL(s) }

// Validate reads the body of one content key from f, recording issues on
// it, and returns the cleaned value: strings trimmed, unknown keys dropped,
// absent fields omitted so Merge fills them from the defaults.
func Validate(key string, f *validate.Form) map[string]any {
	return validateObject(f, Schemas[key])
}

func validateObject(f *validate.Form, fields []Field) map[string]any {
	out := make(map[string]any, len(fields))
	opt := validate.Rule{Optional: true, Nullable: true}
	for _, fd := range fields {
		switch fd.Kind {
		case Text, Long, URL:
			o := validate.StrOpts{Trim: true, Max: textMax}
			switch fd.Kind {
			case Long:
				o.Max = longMax
			case URL:
				o.Max, o.Check = urlMax, urlCheck
			}
			if s := f.Str(fd.Name, opt, o); s != nil {
				out[fd.Name] = *s
			}
		case Strings:
			list := f.Strings(fd.Name, opt, stringsMax, validate.StrOpts{Trim: true, Max: textMax})
			if list == nil {
				continue
			}
			items := make([]any, 0, len(list))
			for _, s := range list {
				if s != "" {
					items = append(items, s)
				}
			}
			out[fd.Name] = items
		case Object:
			if raw, sent := f.Fields()[fd.Name]; sent && raw != nil {
				out[fd.Name] = validateObject(f.Child(fd.Name), fd.Fields)
			}
		case Objects:
			items := []any{}
			if f.List(fd.Name, opt, listMax, func(sub *validate.Form, i int, v any) {
				items = append(items, validateObject(sub.Item(i, v), fd.Fields))
			}) != nil {
				out[fd.Name] = items
			}
		}
	}
	return out
}
