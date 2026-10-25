package gymdesk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// deskAccounts registers members through the member portal's front desk
// functions, as internal/app wires them.
type deskAccounts struct{}

func (deskAccounts) Register(ctx context.Context, db database.DB, m NewMember) (string, error) {
	return memberportal.RegisterAtDesk(ctx, db, memberportal.DeskMember(m), time.Now())
}

func (deskAccounts) UpdateProfile(ctx context.Context, db database.DB, id string, p ProfilePatch) error {
	return memberportal.UpdateAtDesk(ctx, db, id, memberportal.DeskProfile(p), time.Now())
}

// importFixture serves the member import with real registration and the
// real gym-credits ledger inside one rolled-back transaction.
func importFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	credits := gymcredits.NewDefaultService(module.Deps{}, tx)
	svc := &Service{db: tx, ports: Ports{Accounts: deskAccounts{}, Credits: fakeCredits{ledger: credits}, Opening: credits, WaiverVersion: "1.0"}, now: time.Now}
	return &fixture{t: t, ctx: context.Background(), tx: tx, mux: testutil.Mux(mod{h: &handler{svc: svc, guard: headerGuard{}}}),
		sfx: testutil.RandomHex(4), num: fmt.Sprintf("%07d", time.Now().UnixNano()%10_000_000)}
}

func (f *fixture) upload(csv string, dryRun bool) (int, map[string]any) {
	f.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "member.csv")
	if err != nil {
		f.t.Fatal(err)
	}
	_, _ = fw.Write([]byte(csv))
	if dryRun {
		_ = mw.WriteField("dry_run", "1")
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/api/gym/members/import", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r.Header.Set("X-Test-Staff", staffA)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, r)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	data, _ := out["data"].(map[string]any)
	if data == nil {
		data = map[string]any{"raw": rec.Body.String()}
	}
	return rec.Code, data
}

func count(data map[string]any, key string) int {
	n, _ := data[key].(float64)
	return int(n)
}

func row(data map[string]any, i int) map[string]any {
	rows, _ := data["rows"].([]any)
	if i >= len(rows) {
		return map[string]any{}
	}
	m, _ := rows[i].(map[string]any)
	return m
}

func (f *fixture) text(sql string, args ...any) string {
	f.t.Helper()
	var v string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

// Members import by phone with their opening balances; a re-import
// matches the same members and writes no second balance.
func TestImportMembers(t *testing.T) {
	f := importFixture(t)
	passName := "Go Pass Impor " + f.sfx
	f.id(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days) VALUES ($1, 'pass', 0, 1000000, 28)`, passName)
	rina, budi := "0812"+f.num+"1", "0812"+f.num+"2"
	rinaEmail := "rina" + f.sfx + "@test.local"
	csv := "nama,telepon,email,tanggal_bergabung,saldo_kredit,kredit_berlaku_sampai,paket_pass,pass_berakhir,catatan\n" +
		"Rina " + f.sfx + "," + rina + "," + rinaEmail + ",2025-03-01,6,2031-12-31,,,Sisa paket lama\n" +
		"Budi " + f.sfx + "," + budi + ",,2026-01-15,,," + passName + ",2031-06-30,\n" +
		"Citra " + f.sfx + ",abc,,,,,,2031-01-01,\n"

	status, dry := f.upload(csv, true)
	if status != 200 || count(dry, "created") != 2 || count(dry, "failed") != 1 {
		t.Fatalf("dry run: %d %v", status, dry)
	}
	if msg, _ := row(dry, 2)["message"].(string); !strings.Contains(msg, "Nomor WhatsApp tidak valid") && !strings.Contains(msg, "Paket pass wajib diisi") {
		t.Fatalf("row 4: %q", msg)
	}
	if n := f.text(`SELECT count(*)::text FROM pos.pos_customers WHERE phone = ANY($1)`, []string{rina, budi}); n != "0" {
		t.Fatalf("dry run wrote %s members", n)
	}

	status, commit := f.upload(csv, false)
	if status != 200 || count(commit, "created") != 2 || count(commit, "failed") != 1 {
		t.Fatalf("commit: %d %v", status, commit)
	}
	if msg, _ := row(commit, 0)["message"].(string); msg != "saldo awal 6 kredit" {
		t.Fatalf("row 2 message: %q", msg)
	}
	rinaID := f.text(`SELECT id::text FROM pos.pos_customers WHERE phone = $1`, rina)
	if got := f.text(`SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') || ' ' || email FROM pos.pos_customers WHERE id = $1`, rinaID); got != "2025-03-01 "+rinaEmail {
		t.Fatalf("rina: %s", got)
	}
	if got := f.text(`SELECT sum(amount)::text || ' ' || max(note) FROM gym.credit_ledger WHERE customer_id = $1`, rinaID); got != "6 Saldo awal (impor): Sisa paket lama" {
		t.Fatalf("rina ledger: %s", got)
	}
	if n := f.text(`SELECT count(*)::text FROM crm.crm_member_profiles WHERE customer_id = $1`, rinaID); n != "1" {
		t.Fatalf("crm profile: %s", n)
	}
	budiID := f.text(`SELECT id::text FROM pos.pos_customers WHERE phone = $1`, budi)
	if got := f.text(`SELECT count(*)::text || ' ' || max(to_char(ends_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')) FROM gym.member_passes WHERE customer_id = $1`, budiID); got != "1 2031-07-01" {
		t.Fatalf("budi pass: %s", got)
	}
	if n := f.text(`SELECT count(*)::text FROM audit.audit_log WHERE action = 'import' AND entity = 'gym.members' AND actor_id = $1`, staffA); n != "1" {
		t.Fatalf("audit: %s", n)
	}

	// Same file again: matched by phone, balances already recorded.
	_, again := f.upload(csv, false)
	if count(again, "created") != 0 || count(again, "unchanged") != 2 {
		t.Fatalf("re-import: %v", again)
	}
	if msg, _ := row(again, 0)["message"].(string); msg != "saldo awal sudah dicatat" {
		t.Fatalf("re-import row 2: %q", msg)
	}
	if got := f.text(`SELECT sum(amount)::text FROM gym.credit_ledger WHERE customer_id = $1`, rinaID); got != "6" {
		t.Fatalf("balance after re-import: %s", got)
	}
	if n := f.text(`SELECT count(*)::text FROM pos.pos_customers WHERE phone = ANY($1)`, []string{rina, budi}); n != "2" {
		t.Fatalf("members duplicated: %s", n)
	}

	// A new number for Rina, matched by email: the profile updates, the
	// balance stays.
	moved := strings.Replace(csv, rina+","+rinaEmail, "0812"+f.num+"3,"+rinaEmail, 1)
	_, upd := f.upload(moved, false)
	if count(upd, "updated") != 1 || count(upd, "unchanged") != 1 {
		t.Fatalf("new number: %v", upd)
	}
	if got := f.text(`SELECT phone FROM pos.pos_customers WHERE id = $1`, rinaID); got != "0812"+f.num+"3" {
		t.Fatalf("phone after update: %s", got)
	}
}
