package reports

import (
	"net/http"
	"reflect"
	"testing"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

func TestConversationInsightReport(t *testing.T) {
	staff, inbox := crmtest.Staff(t, "crm.reports"), crmtest.Staff(t, "crm.inbox")
	tx := testutil.Tx(t)
	mux := crmtest.Mux(newHandler(tx, testutil.Deps(t, nil), Ports{}).routes())
	conv := func(phone, at string) string {
		return crmtest.Scalar[string](t, tx, `INSERT INTO crm.wa_conversations (phone, channel, external_id, status, last_message_at)
			VALUES ($1, 'whatsapp', $2, 'open', $3) RETURNING id::text`, phone, phone, at)
	}
	insight := func(id, topic, sentiment string, complaint bool, keywords string) {
		crmtest.MustExec(t, tx, `INSERT INTO crm.wa_conversation_insights (conversation_id, summary, topic, sentiment, is_complaint, keywords, fingerprint)
			VALUES ($1::uuid, 'isi rahasia +628123456789', $2, $3, $4, $5::jsonb, 'fp')`, id, topic, sentiment, complaint, keywords)
	}
	insight(conv("+6281100000001", "2019-03-02T10:00:00Z"), "Keluhan Pengiriman", "negatif", true, `["pengiriman","terlambat"]`)
	insight(conv("+6281100000002", "2019-03-03T10:00:00Z"), "keluhan pengiriman", "negatif", true, `["Pengiriman!","paket rusak"]`)
	conv("+6281100000003", "2019-03-04T10:00:00Z")
	// Outside the period by last_message_at.
	insight(conv("+6281100000004", "2019-04-01T00:00:00Z"), "tanya harga", "positif", false, `["harga"]`)

	const path = "/api/crm/reports/conversations?from=2019-03-01&to=2019-03-31"
	if code, _ := crmtest.Call(t, mux, "GET", path, nil, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	if code, _ := crmtest.Call(t, mux, "GET", path, nil, &inbox); code != 403 {
		t.Fatalf("no reports grant: %d", code)
	}
	if code, body := crmtest.Call(t, mux, "GET", "/api/crm/reports/conversations?from=bad", nil, &staff); code != 400 {
		t.Fatalf("bad period: %d %v", code, body)
	}

	code, body := crmtest.Call(t, mux, "GET", path, nil, &staff)
	if code != 200 {
		t.Fatalf("json: %d %v", code, body)
	}
	want := map[string]any{
		"period": map[string]any{"from": "2019-03-01", "to": "2019-03-31"},
		"summary": map[string]any{"total_conversations": 3.0, "analyzed": 2.0, "not_analyzed": 1.0, "complaints": 2.0,
			"sentiment": map[string]any{"positif": 0.0, "netral": 0.0, "negatif": 2.0}},
		"keywords": []any{
			map[string]any{"keyword": "pengiriman", "count": 2.0, "conversations": 2.0},
			map[string]any{"keyword": "paket rusak", "count": 1.0, "conversations": 1.0},
			map[string]any{"keyword": "terlambat", "count": 1.0, "conversations": 1.0},
		},
		"topics": []any{map[string]any{"topic": "keluhan pengiriman", "count": 2.0}},
	}
	if !reflect.DeepEqual(body["data"], want) {
		t.Fatalf("data %v", body["data"])
	}

	r := testutil.AsStaff(testutil.Request("GET", path+"&format=xlsx", nil), staff)
	rec, _ := testutil.Do(t, mux, r)
	h := rec.Header()
	if rec.Code != http.StatusOK || h.Get("Content-Type") != xlsx.ContentType || h.Get("Cache-Control") != "no-store" ||
		h.Get("Content-Disposition") != `attachment; filename="analitik-percakapan-2019-03-01_2019-03-31.xlsx"` {
		t.Fatalf("xlsx: %d %v", rec.Code, h)
	}
	file := rec.Body.Bytes()
	for sheet, rows := range map[string][][]string{
		"Ringkasan":  {{"Laporan Analitik Percakapan", ""}, {"Periode", "2019-03-01 s/d 2019-03-31"}, {"", ""}, {"Metrik", "Jumlah"}, {"Percakapan pada periode", "3"}},
		"Kata Kunci": {{"Kata Kunci", "Jumlah Percakapan", "Total Kemunculan"}, {"pengiriman", "2", "2"}, {"paket rusak", "1", "1"}, {"terlambat", "1", "1"}},
		"Topik":      {{"Topik", "Jumlah Percakapan"}, {"keluhan pengiriman", "2"}},
	} {
		m, err := xlsx.ParseMatrix(file, xlsx.ReadOptions{PreferSheet: sheet})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(m[:len(rows)], rows) {
			t.Errorf("%s: %v", sheet, m)
		}
	}
}
