package site_test

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Member news: members see published news for every branch and for the
// branches they train at, pinned first; the public site keeps showing only
// its own articles.
func TestMemberNewsVisibility(t *testing.T) {
	editor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.news": {"read", "create", "update", "delete"}}})
	member := testutil.CreateMember(t)
	e := setup(t)
	b1, b2 := testutil.CreateOrg(t, e.tx).BranchID, testutil.CreateOrg(t, e.tx).BranchID
	sfx := testutil.RandomHex(3)
	exec := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	// The member booked a class at branch 1 last week.
	classType := exec(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Go News Class "+sfx)
	session := exec(`INSERT INTO gym.class_sessions (class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost,
		booking_opens_at, booking_closes_at, status)
		VALUES ($1, $2, now() - interval '7 days', now() - interval '7 days' + interval '1 hour', 10, 1,
		        now() - interval '14 days', now() - interval '7 days', 'completed') RETURNING id::text`, classType, b1)
	exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'completed') RETURNING id::text`, session, member.CustomerID)

	post := func(body map[string]any) map[string]any {
		t.Helper()
		out := e.call(&editor, "POST", "/api/gym/news", body, http.StatusCreated)
		return out["data"].(map[string]any)
	}
	news := func(title, category, published string, extra map[string]any) string {
		body := map[string]any{"title": title + " " + sfx, "member_category": category, "excerpt": "Ringkas", "body_md": "Isi " + title,
			"status": "published", "published_at": published}
		for k, v := range extra {
			body[k] = v
		}
		return post(body)["id"].(string)
	}
	all := news("Untuk semua", "news", "2026-10-05T09:00:00Z", nil)
	pinned := news("Event cabang 1", "event", "2026-10-01T09:00:00Z", map[string]any{"pinned": true, "branch_ids": []string{b1}})
	other := news("Tips cabang 2", "tips", "2026-10-06T09:00:00Z", map[string]any{"branch_ids": []string{b2}})
	scheduled := news("Nanti", "news", "2026-11-01T09:00:00Z", nil)
	both := post(map[string]any{"title": "Juga di situs " + sfx, "member_category": "promo", "status": "published",
		"published_at": "2026-10-04T09:00:00Z", "also_on_site": true})
	draft := post(map[string]any{"title": "Draf " + sfx, "member_category": "promo"})["id"].(string)
	if both["audience"] != "both" || both["category"] != "news" || draft == "" {
		t.Fatalf("created = %v", both)
	}
	e.call(&editor, "POST", "/api/gym/news", map[string]any{"title": "Tanpa kategori"}, http.StatusBadRequest)
	e.call(&e.viewer, "GET", "/api/gym/news", nil, http.StatusForbidden)

	feed := func(query string) []string {
		t.Helper()
		rec, out := testutil.Do(t, e.mux, testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/news"+query, nil), member))
		if rec.Code != http.StatusOK {
			t.Fatalf("feed %s: %d %v", query, rec.Code, out)
		}
		var ids []string
		for _, item := range out["data"].([]any) {
			ids = append(ids, item.(map[string]any)["id"].(string))
		}
		return ids
	}
	mine := map[string]bool{all: true, pinned: true, other: true, scheduled: true, both["id"].(string): true, draft: true}
	var got []string
	for _, id := range feed("") {
		if mine[id] {
			got = append(got, id)
		}
	}
	if want := []string{pinned, all, both["id"].(string)}; len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("feed = %v, want %v", got, want)
	}
	if events := feed("?category=event"); len(events) == 0 || events[0] != pinned {
		t.Fatalf("event filter = %v", events)
	}
	rec, _ := testutil.Do(t, e.mux, testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/news?category=apparel", nil), member))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad category = %d", rec.Code)
	}
	detail := func(id string, status int) map[string]any {
		t.Helper()
		rec, out := testutil.Do(t, e.mux, testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/news/"+id, nil), member))
		if rec.Code != status {
			t.Fatalf("detail %s: %d %v", id, rec.Code, out)
		}
		d, _ := out["data"].(map[string]any)
		return d
	}
	if d := detail(pinned, http.StatusOK); d["body"] != "Isi Event cabang 1" || d["category"] != "event" || d["pinned"] != true {
		t.Fatalf("detail = %v", d)
	}
	detail(other, http.StatusNotFound)
	detail(draft, http.StatusNotFound)

	// The public site shows the shared article only.
	public := e.list(nil, "/api/public/site/articles")
	if !has(public, both["slug"].(string)) {
		t.Fatalf("shared article missing on the site")
	}
	for _, item := range public {
		if id := item.(map[string]any)["id"]; id == all || id == pinned {
			t.Fatalf("member-only article on the site: %v", item)
		}
	}
	e.call(nil, "GET", "/api/public/site/articles/"+post(map[string]any{"title": "Slug member " + sfx, "member_category": "news",
		"status": "published", "published_at": "2026-10-01T00:00:00Z"})["slug"].(string), nil, http.StatusNotFound)

	// The editor lists drafts and the branches, edits and deletes news only.
	staff := e.data(&editor, "GET", "/api/gym/news", nil)
	listed := map[string]bool{}
	for _, n := range staff["news"].([]any) {
		listed[n.(map[string]any)["id"].(string)] = true
	}
	if !listed[draft] || !listed[other] || len(staff["branches"].([]any)) < 2 {
		t.Fatalf("staff list = %v", staff)
	}
	patched := e.data(&editor, "PATCH", "/api/gym/news/"+other, map[string]any{"branch_ids": []string{}, "member_category": "promo", "pinned": true})
	if patched["member_category"] != "promo" || patched["category"] != "news" || len(patched["branch_ids"].([]any)) != 0 {
		t.Fatalf("patched = %v", patched)
	}
	detail(other, http.StatusOK)
	siteOnly := exec(`INSERT INTO site.articles (slug, title, status) VALUES ($1, 'Situs saja', 'draft') RETURNING id::text`, "situs-"+sfx)
	e.call(&editor, "PATCH", "/api/gym/news/"+siteOnly, map[string]any{"pinned": true}, http.StatusNotFound)
	e.call(&editor, "DELETE", "/api/gym/news/"+siteOnly, nil, http.StatusNotFound)
	e.call(&editor, "DELETE", "/api/gym/news/"+other, nil, http.StatusOK)
	detail(other, http.StatusNotFound)
}
