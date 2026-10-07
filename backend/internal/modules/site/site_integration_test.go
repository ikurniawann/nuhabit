package site_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/site"
	"nuhabit/backend/internal/platform/testutil"
)

// Every test writes inside one rolled-back transaction; staff fixtures come
// from testutil and are removed afterwards.

type env struct {
	t      *testing.T
	ctx    context.Context
	tx     pgx.Tx
	mux    http.Handler
	editor testutil.Staff
	viewer testutil.Staff
}

var fixedNow = time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	editor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
		"site.content": nil, "site.articles": nil, "site.events": nil,
	}})
	viewer := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"dashboard": nil}})
	tx := testutil.Tx(t)
	m := site.NewOn(deps, tx, app.SitePortsOn(tx))
	return &env{t: t, ctx: context.Background(), tx: tx, mux: testutil.Mux(m), editor: editor, viewer: viewer}
}

func (e *env) call(as *testutil.Staff, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	r := testutil.Request(method, path, body)
	if as != nil {
		r = testutil.AsStaff(r, *as)
	}
	rec, out := testutil.Do(e.t, e.mux, r)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func (e *env) data(as *testutil.Staff, method, path string, body any) map[string]any {
	e.t.Helper()
	out := e.call(as, method, path, body, http.StatusOK)
	d, _ := out["data"].(map[string]any)
	return d
}

func (e *env) list(as *testutil.Staff, path string) []any {
	e.t.Helper()
	out := e.call(as, "GET", path, nil, http.StatusOK)
	l, _ := out["data"].([]any)
	return l
}

// has reports whether a listing contains the row with slug; the local
// database may hold other rows, so tests never count the whole list.
func has(list []any, slug string) bool {
	for _, item := range list {
		if row, _ := item.(map[string]any); row["slug"] == slug {
			return true
		}
	}
	return false
}

func TestContentDefaultsAndRoundTrip(t *testing.T) {
	e := setup(t)

	home := e.data(nil, "GET", "/api/public/site/content/home", nil)
	if home["hero"].(map[string]any)["cta_label"] != "Coba Gratis" || len(home["pillars"].([]any)) != 3 {
		t.Fatalf("defaults %v", home)
	}
	e.call(nil, "GET", "/api/public/site/content/nope", nil, http.StatusNotFound)

	path := "/api/site/content/home"
	e.call(nil, "PUT", path, map[string]any{}, http.StatusUnauthorized)
	e.call(&e.viewer, "PUT", path, map[string]any{}, http.StatusForbidden)
	e.call(&e.editor, "PUT", path, map[string]any{"hero": map[string]any{"image_url": "javascript:x"}}, http.StatusBadRequest)

	saved := e.data(&e.editor, "PUT", path, map[string]any{
		"hero":     map[string]any{"title": "  Judul baru "},
		"partners": []map[string]any{{"name": "Rogue", "logo_url": "/api/files/site/rogue.png"}},
	})
	hero := saved["hero"].(map[string]any)
	if hero["title"] != "Judul baru" || hero["cta_label"] != "Coba Gratis" || len(saved["partners"].([]any)) != 1 {
		t.Fatalf("saved %v", saved)
	}
	public := e.data(nil, "GET", "/api/public/site/content/home", nil)
	if public["hero"].(map[string]any)["title"] != "Judul baru" {
		t.Fatalf("public after save %v", public)
	}
	staffView := e.data(&e.editor, "GET", path, nil)
	if staffView["hero"].(map[string]any)["title"] != "Judul baru" {
		t.Fatalf("staff view %v", staffView)
	}
}

func TestArticlesPublishAndPublicVisibility(t *testing.T) {
	e := setup(t)
	const path = "/api/site/articles"

	e.call(nil, "GET", path, nil, http.StatusUnauthorized)
	e.call(&e.viewer, "GET", path, nil, http.StatusForbidden)
	e.call(&e.editor, "POST", path, map[string]any{"title": "", "category": "x"}, http.StatusBadRequest)

	title := "Go Test Blok " + testutil.RandomHex(3)
	slug := "go-test-blok-" + title[len(title)-6:]
	out := e.call(&e.editor, "POST", path, map[string]any{"title": title, "category": "training", "body_md": "# Halo"}, http.StatusCreated)
	a := out["data"].(map[string]any)
	id := a["id"].(string)
	if a["slug"] != slug || a["status"] != "draft" || a["published_at"] != nil {
		t.Fatalf("created %v (want slug %s)", a, slug)
	}
	e.call(&e.editor, "POST", path, map[string]any{"title": "Dup", "slug": slug}, http.StatusConflict)

	if has(e.list(nil, "/api/public/site/articles"), slug) {
		t.Fatal("draft visible publicly")
	}
	e.call(nil, "GET", "/api/public/site/articles/"+slug, nil, http.StatusNotFound)
	if !has(e.list(&e.editor, path), slug) {
		t.Fatal("draft missing from the staff list")
	}

	patched := e.data(&e.editor, "PATCH", path+"/"+id, map[string]any{"status": "published", "excerpt": "Ringkasan"})
	if patched["published_at"] != fixedNow.Format("2006-01-02T15:04:05.000Z") || patched["excerpt"] != "Ringkasan" {
		t.Fatalf("published %v", patched)
	}
	if !has(e.list(nil, "/api/public/site/articles?category=training"), slug) {
		t.Fatal("published article missing from the public list")
	}
	if has(e.list(nil, "/api/public/site/articles?category=news"), slug) {
		t.Fatal("category filter ignored")
	}
	e.call(nil, "GET", "/api/public/site/articles?category=bogus", nil, http.StatusBadRequest)
	pub := e.data(nil, "GET", "/api/public/site/articles/"+slug, nil)
	if pub["body_md"] != "# Halo" {
		t.Fatalf("public article %v", pub)
	}

	// Clearing the excerpt with null and unpublishing hides it again.
	patched = e.data(&e.editor, "PATCH", path+"/"+id, map[string]any{"status": "draft", "excerpt": nil})
	if patched["excerpt"] != nil {
		t.Fatalf("excerpt not cleared %v", patched)
	}
	e.call(nil, "GET", "/api/public/site/articles/"+slug, nil, http.StatusNotFound)

	e.call(&e.editor, "DELETE", path+"/"+id, nil, http.StatusOK)
	e.call(&e.editor, "DELETE", path+"/"+id, nil, http.StatusNotFound)
	e.call(&e.editor, "GET", path+"/not-a-uuid", nil, http.StatusBadRequest)
}

func TestEvents(t *testing.T) {
	e := setup(t)
	const path = "/api/site/events"

	slug := "go-test-race-" + testutil.RandomHex(3)
	draftSlug := slug + "-draft"
	e.call(&e.editor, "POST", path, map[string]any{"title": "Race Day"}, http.StatusBadRequest)
	out := e.call(&e.editor, "POST", path, map[string]any{
		"title": "Race Day", "slug": slug, "starts_at": "2026-11-01T02:00:00Z", "form_slug": "race-day", "status": "published",
	}, http.StatusCreated)
	ev := out["data"].(map[string]any)
	if ev["slug"] != slug || ev["form_slug"] != "race-day" || ev["starts_at"] != "2026-11-01T02:00:00.000Z" {
		t.Fatalf("event %v", ev)
	}
	e.call(&e.editor, "POST", path, map[string]any{"title": "Draft", "slug": draftSlug, "starts_at": "2026-12-01T02:00:00Z"}, http.StatusCreated)
	public := e.list(nil, "/api/public/site/events")
	if !has(public, slug) || has(public, draftSlug) {
		t.Fatalf("public events %v", public)
	}
	if staff := e.list(&e.editor, path); !has(staff, slug) || !has(staff, draftSlug) {
		t.Fatalf("staff events %v", staff)
	}
	pub := e.data(nil, "GET", "/api/public/site/events/"+slug, nil)
	if pub["title"] != "Race Day" {
		t.Fatalf("public event %v", pub)
	}
	patched := e.data(&e.editor, "PATCH", path+"/"+ev["id"].(string), map[string]any{"form_slug": nil, "status": "draft"})
	if patched["form_slug"] != nil {
		t.Fatalf("form_slug not cleared %v", patched)
	}
	e.call(nil, "GET", "/api/public/site/events/"+slug, nil, http.StatusNotFound)
}

func TestPublicBranches(t *testing.T) {
	e := setup(t)
	hidden := testutil.CreateOrg(t, e.tx)
	shown := testutil.CreateOrg(t, e.tx)
	slug := "go-public-" + testutil.RandomHex(3)
	if _, err := e.tx.Exec(e.ctx, `UPDATE configuration.branches SET is_public = true, slug = $2, city = 'Bandung',
		lat = -6.9, lng = 107.6, benefits = '[{"title":"Coach","text":"Bersertifikat"}]' WHERE id = $1`, shown.BranchID, slug); err != nil {
		t.Fatal(err)
	}

	list := e.list(nil, "/api/public/site/branches")
	var found map[string]any
	for _, item := range list {
		b := item.(map[string]any)
		if b["slug"] == slug {
			found = b
		}
		if b["name"] != nil && b["slug"] != slug && b["name"].(string) == "Go Test B "+hidden.BranchID {
			t.Fatalf("hidden branch listed: %v", b)
		}
	}
	if found == nil || found["city"] != "Bandung" || found["lat"] != -6.9 {
		t.Fatalf("public branch missing: %v", list)
	}
	if _, has := found["benefits"]; has {
		t.Fatalf("summary carries the full profile: %v", found)
	}

	detail := e.data(nil, "GET", "/api/public/site/branches/"+slug, nil)
	if detail["benefits"].([]any)[0].(map[string]any)["title"] != "Coach" || detail["accordions"].(map[string]any)["parking"] == nil {
		t.Fatalf("detail %v", detail)
	}

	var hiddenSlug string
	if err := e.tx.QueryRow(e.ctx, `SELECT slug FROM configuration.branches WHERE id = $1`, hidden.BranchID).Scan(&hiddenSlug); err != nil {
		t.Fatal(err)
	}
	e.call(nil, "GET", "/api/public/site/branches/"+hiddenSlug, nil, http.StatusNotFound)
}
