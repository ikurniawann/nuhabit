package settings_test

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/platform/testutil"
)

func TestBranchProfile(t *testing.T) {
	admin := staff(t, "settings.business")
	e := newEnv(t)
	org := testutil.CreateOrg(t, e.tx)
	path := "/api/settings/business/branch/" + org.BranchID + "/profile"

	expect(t, e.do(nil, "GET", path, nil), 401, unauthorized)
	expect(t, e.do(&admin, "GET", "/api/settings/business/branch/nope/profile", nil), 400,
		`{"success":false,"error":"ID cabang tidak valid"}`)

	r := e.do(&admin, "GET", path, nil)
	expect(t, r, 200, "")
	got := r.json(t)["data"].(map[string]any)
	if got["is_public"] != false || got["slug"] == "" || got["benefits"] == nil {
		t.Fatalf("fresh profile %v", got)
	}

	expect(t, e.do(&admin, "PUT", path, map[string]any{"slug": "Bad Slug"}), 400, "")
	expect(t, e.do(&admin, "PUT", path, map[string]any{"slug": "sulu-test", "lat": 95}), 400, "")

	slug := "go-test-" + testutil.RandomHex(3)
	r = e.do(&admin, "PUT", path, map[string]any{
		"slug": slug, "is_public": true, "city": " Bandung ", "lat": -6.9, "lng": 107.6,
		"phone": "+62811", "benefits": []map[string]any{{"title": "Coach", "text": "Tersertifikasi"}},
		"accordions":   map[string]any{"facilities": []string{"Rig", "Turf"}},
		"testimonials": []map[string]any{{"name": "Ayu", "quote": "Mantap", "role": "Member"}},
	})
	expect(t, r, 200, "")
	got = r.json(t)["data"].(map[string]any)
	if got["slug"] != slug || got["is_public"] != true || got["city"] != "Bandung" || got["lat"] != -6.9 {
		t.Fatalf("saved profile %v", got)
	}
	acc := got["accordions"].(map[string]any)
	if len(acc["facilities"].([]any)) != 2 || len(acc["parking"].([]any)) != 0 {
		t.Fatalf("accordions %v", acc)
	}

	// The public reader sees it now, and not after is_public goes back to false.
	svc := branches.Service{}
	ctx := context.Background()
	if p, err := svc.PublicProfile(ctx, e.tx, slug); err != nil || p == nil || p.Testimonials[0].Name != "Ayu" {
		t.Fatalf("public profile %v %v", p, err)
	}
	expect(t, e.do(&admin, "PUT", path, map[string]any{"slug": slug, "is_public": false}), 200, "")
	if p, err := svc.PublicProfile(ctx, e.tx, slug); err != nil || p != nil {
		t.Fatalf("hidden profile %v %v", p, err)
	}

	// A second branch may not take the slug.
	other := testutil.CreateOrg(t, e.tx)
	expect(t, e.do(&admin, "PUT", "/api/settings/business/branch/"+other.BranchID+"/profile", map[string]any{"slug": slug}), 409,
		`{"success":false,"error":"Slug sudah dipakai cabang lain"}`)
}
