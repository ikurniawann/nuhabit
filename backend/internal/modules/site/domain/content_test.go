package domain

import (
	"encoding/json"
	"testing"

	"nuhabit/backend/internal/platform/validate"
)

func TestDefaultsCoverEverySchema(t *testing.T) {
	for _, key := range Keys() {
		d := Default(key)
		if d == nil {
			t.Fatalf("%s: no defaults", key)
		}
		for _, f := range Schemas[key] {
			if _, ok := d[f.Name]; !ok {
				t.Errorf("%s: default lacks %s", key, f.Name)
			}
		}
	}
	// Default hands out a copy.
	Default("home")["hero"].(map[string]any)["title"] = "changed"
	if Defaults["home"]["hero"].(map[string]any)["title"] == "changed" {
		t.Fatal("Default returned the shared map")
	}
}

func TestMergeKeepsDefaultsForMissingFields(t *testing.T) {
	got := Merge("home", map[string]any{
		"hero":     map[string]any{"title": "Judul baru"},
		"partners": []any{map[string]any{"name": "Rogue", "logo_url": "/x.png"}},
	})
	hero := got["hero"].(map[string]any)
	if hero["title"] != "Judul baru" || hero["cta_label"] != "Start a Trial" {
		t.Fatalf("hero %v", hero)
	}
	if len(got["partners"].([]any)) != 1 || len(got["pillars"].([]any)) != 3 {
		t.Fatalf("lists %v", got)
	}
}

func decode(t *testing.T, raw string) *validate.Form {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		t.Fatal(err)
	}
	return validate.New(v, true)
}

func TestValidateCleansAndRejects(t *testing.T) {
	f := decode(t, `{"hero":{"title":"  Halo ","video_url":"https://v.id/a.mp4","extra":1},
		"pillars":[{"code":"A","title":"B","text":"C"}],"unknown":true}`)
	got := Validate("home", f)
	if !f.Valid() {
		t.Fatalf("issues %v", f.Issues())
	}
	hero := got["hero"].(map[string]any)
	if hero["title"] != "Halo" || hero["extra"] != nil || got["unknown"] != nil || got["mission"] != nil {
		t.Fatalf("cleaned %v", got)
	}
	if len(got["pillars"].([]any)) != 1 {
		t.Fatalf("pillars %v", got["pillars"])
	}

	f = decode(t, `{"hero":{"image_url":"javascript:alert(1)"}}`)
	Validate("home", f)
	if f.Valid() {
		t.Fatal("javascript: URL accepted")
	}
	f = decode(t, `{"laws":{"items":["a","",5]}}`)
	Validate("training", f)
	if f.Valid() {
		t.Fatal("non-string law accepted")
	}
	f = decode(t, `{"laws":{"items":["a",""]}}`)
	got = Validate("training", f)
	if items := got["laws"].(map[string]any)["items"].([]any); !f.Valid() || len(items) != 1 {
		t.Fatalf("laws %v %v", items, f.Issues())
	}
}
