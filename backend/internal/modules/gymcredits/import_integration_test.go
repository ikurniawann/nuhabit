package gymcredits

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// upload posts a CSV to the package import as staff.
func (e *env) upload(csv string, dryRun bool) (int, map[string]any) {
	e.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "paket.csv")
	if err != nil {
		e.t.Fatal(err)
	}
	_, _ = fw.Write([]byte(csv))
	if dryRun {
		_ = mw.WriteField("dry_run", "true")
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/api/gym/packages/import", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r = testutil.AsStaff(r, e.staff)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
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

func rowMessage(data map[string]any, i int) string {
	rows, _ := data["rows"].([]any)
	if i >= len(rows) {
		return ""
	}
	s, _ := rows[i].(map[string]any)["message"].(string)
	return s
}

// Packages import by name with branch prices and class type restrictions;
// a re-import is a no-op and an edited row updates in place.
func TestImportPackages(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	sfx := strings.ToUpper(testutil.RandomHex(3))
	e.exec(`UPDATE configuration.branches SET code = $2 WHERE id = $1`, org.BranchID, "GOPKG"+sfx)
	var classTypeID string
	e.scalar(&classTypeID, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Go Impor Kelas "+sfx)
	credits, pass := "Go Impor Pack "+sfx, "Go Impor Pass "+sfx
	csv := "nama,jenis,kredit,masa_berlaku_hari,harga,harga_cabang,cabang,jenis_kelas,termasuk_pt,publik,batas_beli_per_member,badge,deskripsi,urutan\n" +
		credits + ",credits,10,90,Rp 1.500.000,,," + "Go Impor Kelas " + sfx + ",,ya,1,,Sepuluh kredit,30\n" +
		pass + ",pass,,28,1200000,GOPKG" + sfx + "=1350000,,,ya,tidak,,Paling laris,,110\n" +
		"Go Impor Rusak " + sfx + ",credits,,30,abc,NOPE=1,,,,,,,,\n"

	status, dry := e.upload(csv, true)
	if status != 200 || dry["dry_run"] != true || count(dry, "created") != 2 || count(dry, "failed") != 1 {
		t.Fatalf("dry run: %d %v", status, dry)
	}
	if msg := rowMessage(dry, 2); !strings.Contains(msg, "Kredit wajib diisi") || !strings.Contains(msg, "Harga harus nominal") ||
		!strings.Contains(msg, "cabang tidak ditemukan") {
		t.Fatalf("row 4: %q", msg)
	}
	var n int
	e.scalar(&n, `SELECT count(*) FROM gym.credit_packages WHERE name = ANY($1)`, []string{credits, pass})
	if n != 0 {
		t.Fatalf("dry run wrote %d packages", n)
	}

	status, commit := e.upload(csv, false)
	if status != 200 || count(commit, "created") != 2 || count(commit, "failed") != 1 {
		t.Fatalf("commit: %d %v", status, commit)
	}
	var got string
	e.scalar(&got, `SELECT credits::text || ' ' || price_idr::text || ' ' || purchase_limit_per_member::text || ' ' ||
		applicable_class_type_ids[1]::text || ' ' || is_public::text FROM gym.credit_packages WHERE name = $1`, credits)
	if got != "10 1500000.00 1 "+classTypeID+" true" {
		t.Fatalf("credits package: %s", got)
	}
	e.scalar(&got, `SELECT p.kind || ' ' || p.credits::text || ' ' || p.covers_personal::text || ' ' || p.is_public::text || ' ' || COALESCE(p.badge, '-') || ' ' ||
		(SELECT bp.price_idr::text FROM gym.package_branch_prices bp WHERE bp.package_id = p.id AND bp.branch_id = $2)
		FROM gym.credit_packages p WHERE p.name = $1`, pass, org.BranchID)
	if got != "pass 0 true false Paling laris 1350000.00" {
		t.Fatalf("pass package: %s", got)
	}
	e.scalar(&n, `SELECT count(*) FROM audit.audit_log WHERE action = 'import' AND entity = 'gym.credit_packages' AND actor_id = $1`, e.staff.UserID)
	if n != 1 {
		t.Fatalf("audit rows: %d", n)
	}

	_, again := e.upload(csv, false)
	if count(again, "unchanged") != 2 || count(again, "created") != 0 || count(again, "updated") != 0 {
		t.Fatalf("re-import: %v", again)
	}

	edited := strings.Replace(csv, "GOPKG"+sfx+"=1350000,,,ya,tidak,,Paling laris,,110", ",,,tidak,ya,,,,120", 1)
	_, upd := e.upload(edited, false)
	if count(upd, "updated") != 1 || count(upd, "unchanged") != 1 {
		t.Fatalf("edit: %v", upd)
	}
	e.scalar(&got, `SELECT p.covers_personal::text || ' ' || p.is_public::text || ' ' || COALESCE(p.badge, '-') || ' ' || p.sort_order::text || ' ' ||
		(SELECT count(*) FROM gym.package_branch_prices bp WHERE bp.package_id = p.id)::text
		FROM gym.credit_packages p WHERE p.name = $1`, pass)
	if got != "false true - 120 0" {
		t.Fatalf("after edit: %s", got)
	}
	e.scalar(&n, `SELECT count(*) FROM gym.credit_packages WHERE name = $1`, pass)
	if n != 1 {
		t.Fatalf("natural key duplicated: %d", n)
	}
}

// Opening balances are written once per member: a second call changes
// nothing, and a member with a live pass keeps it.
func TestOpeningBalances(t *testing.T) {
	e := setup(t)
	svc := e.svc
	created, err := svc.OpeningCredits(e.ctx, e.tx, e.member.CustomerID, 8, "2031-12-31", "Saldo awal", e.staff.UserID)
	if err != nil || !created {
		t.Fatalf("opening credits: %v %v", created, err)
	}
	if created, err = svc.OpeningCredits(e.ctx, e.tx, e.member.CustomerID, 8, "", "Saldo awal", e.staff.UserID); err != nil || created {
		t.Fatalf("second opening credits: %v %v", created, err)
	}
	var got string
	e.scalar(&got, `SELECT sum(amount)::text || ' ' || max(note) FROM gym.credit_ledger WHERE customer_id = $1`, e.member.CustomerID)
	if got != "8 Saldo awal" {
		t.Fatalf("ledger: %s", got)
	}
	e.scalar(&got, `SELECT to_char(expires_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') FROM gym.credit_lots WHERE customer_id = $1`, e.member.CustomerID)
	if got != "2032-01-01 00:00" {
		t.Fatalf("lot expiry: %s", got)
	}
	if _, err := svc.OpeningCredits(e.ctx, e.tx, e.member.CustomerID, 0, "", "x", e.staff.UserID); err == nil {
		t.Fatal("zero credits must fail")
	}

	passName := "Go Opening Pass " + testutil.RandomHex(3)
	e.exec(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days) VALUES ($1, 'pass', 0, 1000000, 28)`, passName)
	if _, err := svc.OpeningPass(e.ctx, e.tx, e.member.CustomerID, "Tidak Ada", "2031-06-30"); err == nil || !strings.Contains(err.Error(), "Paket pass tidak ditemukan") {
		t.Fatalf("unknown pass package: %v", err)
	}
	created, err = svc.OpeningPass(e.ctx, e.tx, e.member.CustomerID, strings.ToLower(passName), "2031-06-30")
	if err != nil || !created {
		t.Fatalf("opening pass: %v %v", created, err)
	}
	if created, err = svc.OpeningPass(e.ctx, e.tx, e.member.CustomerID, passName, "2031-07-31"); err != nil || created {
		t.Fatalf("second opening pass: %v %v", created, err)
	}
	e.scalar(&got, `SELECT count(*)::text || ' ' || max(to_char(ends_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')) || ' ' || max(COALESCE(purchase_id::text, 'none'))
		FROM gym.member_passes WHERE customer_id = $1`, e.member.CustomerID)
	if got != "1 2031-07-01 none" {
		t.Fatalf("passes: %s", got)
	}
}
