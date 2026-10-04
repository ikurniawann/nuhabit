package app

import (
	"context"
	"encoding/json"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The Do write adapters run on a rolled-back transaction; the overview
// adapter builds the real desktop board on the pool.
func TestInsightsAdapters(t *testing.T) {
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	tx := testutil.Tx(t)
	ctx := context.Background()

	id, title, err := insightsAnnouncements{}.CreateDraft(ctx, tx, "Libur Go", "<p>isi</p>", []string{"info"})
	if err != nil || id == "" || title != "Libur Go" {
		t.Fatal(id, title, err)
	}
	var status, tags string
	if err := tx.QueryRow(ctx, `SELECT status, tags::text FROM hris.announcements WHERE id = $1`, id).Scan(&status, &tags); err != nil || status != "draft" || tags != "{info}" {
		t.Fatal(status, tags, err)
	}

	var candidateID string
	if err := tx.QueryRow(ctx, `INSERT INTO recruitment.candidates (full_name, email, phone, domicile, source)
		VALUES ('Go Note', 'go' || md5(random()::text) || '@x.id', '0812', 'Jkt', 'portal') RETURNING id::text`).Scan(&candidateID); err != nil {
		t.Fatal(err)
	}
	noteID, err := insightsCandidateNotes{}.Add(ctx, tx, candidateID, "Sudah dihubungi", staff.UserID, "Do")
	if err != nil || noteID == "" {
		t.Fatal(noteID, err)
	}

	deps := testutil.Deps(t, nil)
	raw, gagal, err := newInsightsOverview(deps).Build(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var o map[string]any
	if err := json.Unmarshal(raw, &o); err != nil || o["periode"] == nil || o["gagal"] == nil || len(gagal) != len(o["gagal"].([]any)) {
		t.Fatal(string(raw), err)
	}
}
