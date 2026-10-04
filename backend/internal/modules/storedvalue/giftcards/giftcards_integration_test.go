package giftcards

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	svdomain "nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests against TEST_DATABASE_URL. Every write runs inside one
// transaction rolled back at the end; the staff fixtures come from
// testutil. Settings and the catalog are in-memory fakes (the real
// adapters live in internal/app).

type fakeSettings map[string]string

func (f fakeSettings) Get(_ context.Context, _ database.Querier, key string) (*string, error) {
	if v, ok := f[key]; ok {
		return &v, nil
	}
	return nil, nil
}

func (f fakeSettings) Set(_ context.Context, _ database.Querier, key, value string) error {
	f[key] = value
	return nil
}

type fakeCatalog map[string]bool

func (f fakeCatalog) GiftCardProductIDs(_ context.Context, _ database.Querier, ids []string) ([]string, error) {
	out := []string{}
	for _, id := range ids {
		if f[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

type fakeDir struct {
	kit.Directory
	venue kit.Venue
}

func (d fakeDir) DefaultVenue(context.Context, database.Querier) kit.Venue { return d.venue }

func (d fakeDir) UserScope(context.Context, database.Querier, string) (*kit.UserScope, error) {
	return nil, nil
}

type env struct {
	t        *testing.T
	ctx      context.Context
	tx       pgx.Tx
	mux      *http.ServeMux
	svc      *Service
	settings fakeSettings
	catalog  fakeCatalog
	pos      testutil.Staff
	promo    testutil.Staff
	member   testutil.Member
	scope    Scope
	now      time.Time
}

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, nil)
	e := &env{t: t, ctx: context.Background(), settings: fakeSettings{}, catalog: fakeCatalog{},
		now: time.Date(2026, 10, 4, 5, 0, 0, 0, time.UTC)}
	e.pos = testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos": nil}})
	e.promo = testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.promo": nil}})
	// Fixtures first: their cleanup must run after the rollback, or a
	// DELETE would wait on rows this transaction still holds.
	e.member = testutil.CreateMember(t)
	e.tx = testutil.Tx(t)
	e.scalar(&e.scope.BranchID, `SELECT id::text FROM configuration.branches ORDER BY created_at LIMIT 1`)
	e.scalar(&e.scope.CompanyID, `SELECT company_id::text FROM configuration.branches WHERE id = $1`, e.scope.BranchID)
	now := func() time.Time { return e.now }
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	e.svc = NewService(e.tx, Ports{Settings: e.settings, Catalog: e.catalog}, now, log)
	k := &kit.Kit{Auth: deps.Auth, Log: log, Now: now, DB: e.tx,
		Dir:     fakeDir{venue: kit.Venue{CompanyID: &e.scope.CompanyID, BranchID: &e.scope.BranchID}},
		Limiter: svdomain.NewRateLimiter()}
	e.mux = http.NewServeMux()
	for _, rt := range Routes(k, e.svc) {
		e.mux.Handle(rt.Pattern, rt.Handler)
	}
	return e
}

func (e *env) scalar(dst any, sql string, args ...any) {
	e.t.Helper()
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(dst); err != nil {
		e.t.Fatalf("query %q: %v", sql, err)
	}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (e *env) uuid() string {
	var id string
	e.scalar(&id, `SELECT gen_random_uuid()::text`)
	return id
}

// card inserts an active card with an 'isi' ledger row and returns its id.
func (e *env) card(code string, balance float64, mutate string) string {
	e.t.Helper()
	var id string
	e.scalar(&id, `INSERT INTO giftcard.gift_cards (company_id, branch_id, code, initial_value, balance, status, source_type)
		VALUES ($1, $2, $3, $4, $4, 'active', 'manual') RETURNING id::text`, e.scope.CompanyID, e.scope.BranchID, code, balance)
	e.exec(`INSERT INTO giftcard.gift_card_ledger (company_id, branch_id, card_id, direction, amount, balance_after, context_type)
		VALUES ($1, $2, $3, 'isi', $4, $4, 'manual')`, e.scope.CompanyID, e.scope.BranchID, id, balance)
	if mutate != "" {
		e.exec(`UPDATE giftcard.gift_cards SET `+mutate+` WHERE id = $1`, id)
	}
	return id
}

func (e *env) do(as *testutil.Staff, method, path string, body any) (int, string) {
	e.t.Helper()
	r := testutil.Request(method, path, body)
	if as != nil {
		r = testutil.AsStaff(r, *as)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	return rec.Code, rec.Body.String()
}

// expect checks status and the exact body; %ID-like placeholders in want
// are filled by fmt.Sprintf with args.
func (e *env) expect(as *testutil.Staff, method, path string, body any, status int, want string, args ...any) {
	e.t.Helper()
	code, got := e.do(as, method, path, body)
	if len(args) > 0 {
		want = fmt.Sprintf(want, args...)
	}
	if code != status || got != want {
		e.t.Fatalf("%s %s:\n got %d %s\nwant %d %s", method, path, code, got, status, want)
	}
}

// data returns the decoded data of a 200 response.
func (e *env) data(as *testutil.Staff, method, path string, body any) any {
	e.t.Helper()
	code, raw := e.do(as, method, path, body)
	if code != http.StatusOK {
		e.t.Fatalf("%s %s: %d %s", method, path, code, raw)
	}
	var out struct{ Data any }
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func (e *env) ledgerCount(cardID, direction string) int {
	var n int
	e.scalar(&n, `SELECT count(*) FROM giftcard.gift_card_ledger WHERE card_id = $1 AND direction = $2`, cardID, direction)
	return n
}

func (e *env) cardState(id string) (balance float64, status string) {
	e.scalar(&balance, `SELECT balance::float8 FROM giftcard.gift_cards WHERE id = $1`, id)
	e.scalar(&status, `SELECT status FROM giftcard.gift_cards WHERE id = $1`, id)
	return
}

const unauthorized = `{"success":false,"error":"Authentication required"}`

/* ── POST /api/pos/gift-card-check ───────────────────────────────────── */

func TestPosGiftCardCheck(t *testing.T) {
	e := setup(t)
	const path = "/api/pos/gift-card-check"
	e.expect(nil, "POST", path, map[string]any{"code": "GCAAAABBBB", "total": 1000}, 401, unauthorized)
	e.expect(&e.promo, "POST", path, map[string]any{"code": "GCAAAABBBB", "total": 1000}, 401, unauthorized)

	e.expect(&e.pos, "POST", path, map[string]any{"code": "x"}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"too_small","path":["code"],"message":"Too small: expected string to have >=3 characters"},`+
			`{"code":"invalid_type","path":["total"],"message":"Invalid input: expected number, received undefined"}]}`)
	// parseJsonBody: malformed JSON validates as {}.
	e.expect(&e.pos, "POST", path, "{not json", 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"invalid_type","path":["code"],"message":"Invalid input: expected string, received undefined"},`+
			`{"code":"invalid_type","path":["total"],"message":"Invalid input: expected number, received undefined"}]}`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GC12345678", "total": 2e9}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"too_big","path":["total"],"message":"Too big: expected number to be <=1000000000"}]}`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GC-12", "total": 0}, 400,
		`{"success":false,"error":"Format kode gift card tidak valid"}`)

	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCNOTFOUND1", "total": 1000}, 200,
		`{"success":true,"data":{"ok":false,"reason":"Gift card tidak ditemukan"}}`)

	e.card("GCABCD2345", 50000, "")
	e.expect(&e.pos, "POST", path, map[string]any{"code": " gcabcd2345 ", "total": 30000}, 200,
		`{"success":true,"data":{"ok":true,"code":"GCABCD2345","balance":50000,"covers":true,"expires_at":null}}`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCABCD2345", "total": 80000}, 200,
		`{"success":true,"data":{"ok":true,"code":"GCABCD2345","balance":50000,"covers":false,"expires_at":null}}`)

	e.card("GCEXPIRED2", 50000, `expires_at = '2026-10-01T00:00:00Z'`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCEXPIRED2", "total": 0}, 200,
		`{"success":true,"data":{"ok":false,"reason":"Gift card sudah kedaluwarsa"}}`)
	e.card("GCFUTURE22", 50000, `expires_at = '2027-01-31T10:00:00.123Z'`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCFUTURE22", "total": 0}, 200,
		`{"success":true,"data":{"ok":true,"code":"GCFUTURE22","balance":50000,"covers":true,"expires_at":"2027-01-31T10:00:00.123Z"}}`)
	e.card("GCDISABLED", 50000, `status = 'disabled'`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCDISABLED", "total": 10}, 200,
		`{"success":true,"data":{"ok":false,"reason":"Gift card tidak aktif atau belum bisa dipakai"}}`)

	// 20 attempts per cashier per minute; this test has made 10 so far.
	for range 10 {
		e.do(&e.pos, "POST", path, map[string]any{"code": "GCABCD2345", "total": 1})
	}
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCABCD2345", "total": 1}, 429,
		`{"success":false,"error":"Terlalu banyak percobaan — tunggu sebentar"}`)
}

/* ── POST /api/pos/gift-card-reload ──────────────────────────────────── */

func TestPosGiftCardReload(t *testing.T) {
	e := setup(t)
	const path = "/api/pos/gift-card-reload"
	valid := map[string]any{"code": "gcrel23456", "amount": 50000, "payment_method": "cash"}
	e.expect(nil, "POST", path, valid, 401, unauthorized)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "gcrel23456", "amount": -1, "payment_method": "cash"}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"too_small","path":["amount"],"message":"Too small: expected number to be >0"}]}`)
	e.expect(&e.pos, "POST", path, map[string]any{}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"invalid_type","path":["amount"],"message":"Invalid input: expected number, received undefined"},`+
			`{"code":"invalid_value","path":["payment_method"],"message":"Invalid option: expected one of \"cash\"|\"qris\"|\"debit_card\"|\"credit_card\"|\"transfer\""},`+
			`{"code":"invalid_type","path":["code"],"message":"Invalid input: expected string, received undefined"}]}`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "gcrel23456", "amount": 2e8, "payment_method": "ark_coin"}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"too_big","path":["amount"],"message":"Too big: expected number to be <=100000000"},`+
			`{"code":"invalid_value","path":["payment_method"],"message":"Invalid option: expected one of \"cash\"|\"qris\"|\"debit_card\"|\"credit_card\"|\"transfer\""}]}`)
	e.expect(&e.pos, "POST", path, valid, 404, `{"success":false,"error":"Gift card tidak ditemukan"}`)

	id := e.card("GCREL23456", 20000, "")
	code, raw := e.do(&e.pos, "POST", path, valid)
	ledgerID := regexp.MustCompile(`"ledgerId":"([0-9a-f-]{36})"`).FindStringSubmatch(raw)
	if code != 200 || ledgerID == nil || raw != `{"success":true,"data":{"ok":true,"ledgerId":"`+ledgerID[1]+`","balanceAfter":70000,"statusAfter":"active"}}` {
		t.Fatalf("reload: %d %s", code, raw)
	}
	var reloaded, note, method, by string
	e.scalar(&reloaded, `SELECT reloaded_total::text FROM giftcard.gift_cards WHERE id = $1`, id)
	e.scalar(&note, `SELECT note FROM giftcard.gift_card_ledger WHERE id = $1`, ledgerID[1])
	e.scalar(&method, `SELECT payment_method || '/' || context_type FROM giftcard.gift_card_ledger WHERE id = $1`, ledgerID[1])
	e.scalar(&by, `SELECT created_by::text FROM giftcard.gift_card_ledger WHERE id = $1`, ledgerID[1])
	if reloaded != "50000.00" || note != "Reload saldo (Tunai)" || method != "cash/reload" || by != e.pos.UserID {
		t.Fatalf("ledger: reloaded=%s note=%q method=%s by=%s", reloaded, note, method, by)
	}

	e.card("GCOFF23456", 20000, `status = 'disabled'`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GCOFF23456", "amount": 1000, "payment_method": "qris"}, 400,
		`{"success":false,"error":"Kartu nonaktif atau belum dibayar — tidak bisa di-reload"}`)
	e.expect(&e.pos, "POST", path, map[string]any{"code": "GC-1", "amount": 1000, "payment_method": "qris"}, 400,
		`{"success":false,"error":"Format kode gift card tidak valid"}`)
}

/* ── promo back office ───────────────────────────────────────────────── */

func TestPromoGiftCardIssueListLedger(t *testing.T) {
	e := setup(t)
	e.expect(nil, "GET", "/api/promo/gift-cards", nil, 401, unauthorized)
	e.expect(&e.promo, "POST", "/api/promo/gift-cards", map[string]any{"mode": "x"}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"invalid_union","path":["mode"],"message":"Invalid discriminator value. Expected 'single' | 'batch'"}]}`)
	e.expect(&e.promo, "POST", "/api/promo/gift-cards", map[string]any{"mode": "batch"}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"invalid_type","path":["initial_value"],"message":"Invalid input: expected number, received undefined"},`+
			`{"code":"invalid_type","path":["count"],"message":"Invalid input: expected number, received undefined"}]}`)
	e.expect(&e.promo, "POST", "/api/promo/gift-cards", "{bad", 500, `{"success":false,"error":"Terjadi kesalahan server"}`)

	member := e.member
	single := e.data(&e.promo, "POST", "/api/promo/gift-cards", map[string]any{
		"mode": "single", "initial_value": 150000, "buyer_name": " Budi ", "buyer_phone": "0812-3456-7890",
		"note": "Hadiah", "customer_id": member.CustomerID, "expires_at": "2027-01-01",
	}).(map[string]any)
	id, _ := single["id"].(string)
	code, _ := single["code"].(string)
	if len(single) != 2 || len(code) != 12 {
		t.Fatalf("single: %v", single)
	}
	status, raw := e.do(&e.promo, "POST", "/api/promo/gift-cards", map[string]any{"mode": "batch", "initial_value": 25000, "count": 3})
	var batch struct {
		Data struct {
			Count int      `json:"count"`
			Codes []string `json:"codes"`
		} `json:"data"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal([]byte(raw), &batch)
	stored := e.codesOf(`SELECT code FROM giftcard.gift_cards WHERE branch_id = $1 AND initial_value = 25000 AND created_by = $2 ORDER BY code`)
	slices.Sort(batch.Data.Codes)
	if status != 200 || !strings.HasPrefix(raw, `{"success":true,"data":{"count":3,"codes":[`) || batch.Message != "3 gift card diterbitkan" ||
		!slices.Equal(batch.Data.Codes, stored) {
		t.Fatalf("batch: %d %s (stored %v)", status, raw, stored)
	}
	var isiRows int
	e.scalar(&isiRows, `SELECT count(*) FROM giftcard.gift_card_ledger l JOIN giftcard.gift_cards g ON g.id = l.card_id
		WHERE g.created_by = $1 AND l.direction = 'isi' AND l.amount = 25000 AND l.created_by = $1`, e.promo.UserID)
	if isiRows != 3 {
		t.Fatalf("batch ledger rows: %d", isiRows)
	}

	// List: numeric columns as strings, member fields joined, TS key order.
	var created time.Time
	e.scalar(&created, `SELECT created_at FROM giftcard.gift_cards WHERE id = $1`, id)
	e.expect(&e.promo, "GET", "/api/promo/gift-cards?q="+strings.ToLower(code), nil, 200,
		`{"success":true,"data":[{"id":"%s","code":"%s","initial_value":"150000.00","balance":"150000.00","status":"active",`+
			`"expires_at":"2026-12-31T17:00:00.000Z","source_type":"manual","buyer_name":"Budi","buyer_phone":"0812-3456-7890",`+
			`"note":"Hadiah","created_at":"%s","reloaded_total":"0.00","customer_id":"%s","customer_name":"Go Test Member","customer_phone":"%s"}]}`,
		id, code, created.UTC().Format("2006-01-02T15:04:05.000Z"), member.CustomerID, member.Phone)
	if n := len(e.data(&e.promo, "GET", "/api/promo/gift-cards?phone=%2B62812-3456", nil).([]any)); n < 1 {
		t.Fatalf("phone filter found %d", n)
	}
	if n := len(e.data(&e.promo, "GET", "/api/promo/gift-cards?customer_id="+member.CustomerID+"&status=active", nil).([]any)); n != 1 {
		t.Fatalf("customer filter found %d", n)
	}
	e.expect(&e.promo, "GET", "/api/promo/gift-cards?customer_id=nope", nil, 400, `{"success":false,"error":"customer_id tidak valid"}`)

	var ledgerID string
	var at time.Time
	e.scalar(&ledgerID, `SELECT id::text FROM giftcard.gift_card_ledger WHERE card_id = $1`, id)
	e.scalar(&at, `SELECT created_at FROM giftcard.gift_card_ledger WHERE card_id = $1`, id)
	e.expect(&e.promo, "GET", "/api/promo/gift-cards/"+id+"/ledger", nil, 200,
		`{"success":true,"data":[{"id":"%s","direction":"isi","amount":"150000.00","balance_after":"150000.00","context_type":"manual",`+
			`"context_id":null,"note":null,"payment_method":null,"payment_reference":null,"created_at":"%s"}]}`,
		ledgerID, at.UTC().Format("2006-01-02T15:04:05.000Z"))
	e.expect(&e.promo, "GET", "/api/promo/gift-cards/"+e.uuid()+"/ledger", nil, 404, `{"success":false,"error":"Gift card tidak ditemukan"}`)
	e.expect(&e.promo, "GET", "/api/promo/gift-cards/not-a-uuid/ledger", nil, 400, `{"success":false,"error":"Format data tidak valid"}`)
}

func (e *env) codesOf(sql string) []string {
	rows, err := e.tx.Query(e.ctx, sql, e.scope.BranchID, e.promo.UserID)
	if err != nil {
		e.t.Fatal(err)
	}
	codes, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		e.t.Fatal(err)
	}
	return codes
}

func TestPromoGiftCardPatchAdjustReload(t *testing.T) {
	e := setup(t)
	id := e.card("GCPATCH234", 100000, "")
	path := "/api/promo/gift-cards/" + id

	union := `{"success":false,"error":"Validation failed","details":[{"code":"invalid_union","path":[],"message":"Invalid input"}]}`
	e.expect(&e.promo, "PATCH", path, map[string]any{}, 400, union)
	e.expect(&e.promo, "PATCH", path, map[string]any{"is_active": true, "customer_id": nil}, 400, union)
	e.expect(&e.promo, "PATCH", path, "null", 400, union)

	e.expect(&e.promo, "PATCH", path, map[string]any{"is_active": false}, 200,
		`{"success":true,"data":{"id":"%s","status":"disabled"},"message":"Gift card diperbarui"}`, id)
	e.exec(`UPDATE giftcard.gift_cards SET status = 'exhausted' WHERE id = $1`, id)
	e.expect(&e.promo, "PATCH", path, map[string]any{"is_active": true}, 409,
		`{"success":false,"error":"Gift card berstatus 'exhausted' tidak bisa diubah lewat aksi ini"}`)
	e.exec(`UPDATE giftcard.gift_cards SET status = 'active' WHERE id = $1`, id)

	member := e.member
	e.expect(&e.promo, "PATCH", path, map[string]any{"customer_id": member.CustomerID}, 200,
		`{"success":true,"data":{"id":"%s","customer_id":"%s"},"message":"Gift card ditautkan ke member"}`, id, member.CustomerID)
	e.expect(&e.promo, "PATCH", path, map[string]any{"customer_id": nil}, 200,
		`{"success":true,"data":{"id":"%s","customer_id":null},"message":"Tautan member dilepas"}`, id)
	e.expect(&e.promo, "PATCH", path, map[string]any{"customer_id": e.uuid()}, 404,
		`{"success":false,"error":"Gift card atau member tidak ditemukan"}`)

	// adjust
	adjust := path + "/adjust"
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": 0, "reason": "abc"}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"custom","path":["delta"],"message":"Nominal koreksi tidak boleh 0"},`+
			`{"code":"too_small","path":["reason"],"message":"Too small: expected string to have >=5 characters"}]}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": 2e8, "reason": "salah input"}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"custom","path":["delta"],"message":"Nominal koreksi terlalu besar"}]}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": 0.001, "reason": "salah input"}, 400,
		`{"success":false,"error":"Nominal koreksi tidak boleh 0"}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": -100000, "reason": "salah input kasir"}, 200,
		`{"success":true,"data":{"ok":true,"balanceAfter":0,"statusAfter":"exhausted"},"message":"Saldo gift card dikoreksi"}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": -1, "reason": "salah input kasir"}, 400,
		`{"success":false,"error":"Koreksi membuat saldo negatif"}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": 100001, "reason": "salah input kasir"}, 400,
		`{"success":false,"error":"Koreksi tidak boleh melebihi total nilai yang pernah diisi — pakai Reload"}`)
	e.expect(&e.promo, "POST", adjust, map[string]any{"delta": 40000.555, "reason": "kembalikan saldo"}, 200,
		`{"success":true,"data":{"ok":true,"balanceAfter":40000.56,"statusAfter":"active"},"message":"Saldo gift card dikoreksi"}`)
	var note, by string
	e.scalar(&note, `SELECT note || '/' || context_type FROM giftcard.gift_card_ledger WHERE card_id = $1 AND direction = 'koreksi' AND amount = 40000.56`, id)
	e.scalar(&by, `SELECT DISTINCT created_by::text FROM giftcard.gift_card_ledger WHERE card_id = $1 AND direction = 'koreksi'`, id)
	if note != "kembalikan saldo/manual" || by != e.promo.UserID {
		t.Fatalf("adjust ledger: %s by %s", note, by)
	}
	e.expect(&e.promo, "POST", "/api/promo/gift-cards/"+e.uuid()+"/adjust", map[string]any{"delta": 1, "reason": "salah input"}, 404,
		`{"success":false,"error":"Gift card tidak ditemukan"}`)

	// reload by id
	code, raw := e.do(&e.promo, "POST", path+"/reload", map[string]any{"amount": 10000, "payment_method": "transfer", "payment_reference": " TRX-1 ", "note": "Top up"})
	if code != 200 || !strings.HasSuffix(raw, `"balanceAfter":50000.56,"statusAfter":"active"},"message":"Saldo gift card bertambah"}`) {
		t.Fatalf("promo reload: %d %s", code, raw)
	}
	var ref string
	e.scalar(&ref, `SELECT payment_reference || '/' || note FROM giftcard.gift_card_ledger WHERE card_id = $1 AND context_type = 'reload'`, id)
	if ref != "TRX-1/Top up" {
		t.Fatalf("reload ledger: %q", ref)
	}
	e.expect(&e.promo, "POST", path+"/reload", map[string]any{"amount": 99_999_999, "payment_method": "cash"}, 400,
		`{"success":false,"error":"Saldo setelah reload melebihi plafon Rp100.000.000"}`)
}

func TestPromoMemberLookupAndConfig(t *testing.T) {
	e := setup(t)
	member := e.member // phone +6299…
	e.expect(&e.promo, "GET", "/api/promo/gift-cards/member-lookup?phone=12", nil, 200, `{"success":true,"data":[]}`)
	e.expect(&e.promo, "GET", "/api/promo/gift-cards/member-lookup?phone="+strings.TrimPrefix(member.Phone, "+"), nil, 200,
		`{"success":true,"data":[{"id":"%s","name":"Go Test Member","phone":"%s"}]}`, member.CustomerID, member.Phone)

	e.expect(&e.promo, "GET", "/api/promo/gift-card-config", nil, 200,
		`{"success":true,"data":{"presets":[50000,100000,200000,500000],"allow_custom":true,"expiry_months":null}}`)
	e.settings[ConfigKey] = "{broken"
	e.expect(&e.promo, "GET", "/api/promo/gift-card-config", nil, 200,
		`{"success":true,"data":{"presets":[50000,100000,200000,500000],"allow_custom":true,"expiry_months":null}}`)

	e.expect(&e.promo, "PUT", "/api/promo/gift-card-config", map[string]any{"presets": []any{}, "expiry_months": 0}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"too_small","path":["presets"],"message":"Too small: expected array to have >=1 items"},`+
			`{"code":"too_small","path":["expiry_months"],"message":"Too small: expected number to be >=1"}]}`)
	e.expect(&e.promo, "PUT", "/api/promo/gift-card-config", map[string]any{"presets": []any{1.5, 2e8}}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"invalid_type","path":["presets",0],"message":"Invalid input: expected int, received number"},`+
			`{"code":"too_big","path":["presets",1],"message":"Too big: expected number to be <=100000000"}]}`)

	e.expect(&e.promo, "PUT", "/api/promo/gift-card-config", map[string]any{"presets": []any{200000, 50000, 50000}, "expiry_months": 12}, 200,
		`{"success":true,"data":{"presets":[50000,200000],"allow_custom":true,"expiry_months":12},"message":"Konfigurasi gift card tersimpan"}`)
	e.expect(&e.promo, "PUT", "/api/promo/gift-card-config", map[string]any{"allow_custom": false}, 200,
		`{"success":true,"data":{"presets":[50000,200000],"allow_custom":false,"expiry_months":12},"message":"Konfigurasi gift card tersimpan"}`)
	e.expect(&e.promo, "PUT", "/api/promo/gift-card-config", map[string]any{"expiry_months": nil}, 200,
		`{"success":true,"data":{"presets":[50000,200000],"allow_custom":false,"expiry_months":null},"message":"Konfigurasi gift card tersimpan"}`)
	if got := e.settings[ConfigKey]; got != `{"presets":[50000,200000],"allow_custom":false,"expiry_months":null}` {
		t.Fatalf("stored config: %s", got)
	}
}

/* ── checkout-facing methods ─────────────────────────────────────────── */

func TestPrepareGiftCardSale(t *testing.T) {
	e := setup(t)
	gift, regular := e.uuid(), e.uuid()
	e.catalog[gift] = true
	plan, err := e.svc.PrepareGiftCardSale(e.ctx, e.tx, []SaleLine{{ProductID: regular, UnitPrice: 1000}})
	if err != nil || !plan.OK || len(plan.Nominals) != 0 {
		t.Fatalf("regular cart: %+v %v", plan, err)
	}
	plan, err = e.svc.PrepareGiftCardSale(e.ctx, e.tx, []SaleLine{
		{ProductID: gift, UnitPrice: "70000", VariantPriceAdjustment: 5000, Quantity: "2"},
		{ProductID: regular, UnitPrice: 1},
		{ProductID: gift, UnitPrice: 30000, Quantity: 0},
	})
	if err != nil || !plan.OK || fmt.Sprint(plan.Nominals) != "[75000 75000 30000]" {
		t.Fatalf("gift cart: %+v %v", plan, err)
	}
	e.settings[ConfigKey] = `{"presets":[50000,100000],"allow_custom":false}`
	plan, _ = e.svc.PrepareGiftCardSale(e.ctx, e.tx, []SaleLine{{ProductID: gift, UnitPrice: 75000}})
	if plan.OK || plan.Reason != "Nominal gift card harus salah satu dari: Rp50.000, Rp100.000" {
		t.Fatalf("preset rule: %+v", plan)
	}
	plan, _ = e.svc.PrepareGiftCardSale(e.ctx, e.tx, []SaleLine{{ProductID: gift, UnitPrice: 50000, Quantity: 21}})
	if plan.OK || plan.Reason != "Maksimal 20 gift card per transaksi" {
		t.Fatalf("card cap: %+v", plan)
	}
}

func TestIssueRedeemRefundVoid(t *testing.T) {
	e := setup(t)
	e.settings[ConfigKey] = `{"expiry_months":1}`
	e.now = time.Date(2026, 1, 31, 3, 4, 5, 678_900_000, time.UTC)
	order := e.uuid()
	in := IssueInput{Scope: e.scope, OrderID: order, Nominals: []float64{50000, 50000}, BuyerName: ptr("Ani"), CreatedBy: e.pos.UserID}
	cards, err := e.svc.IssueGiftCardsForPosOrder(e.ctx, e.tx, in)
	if err != nil || len(cards) != 2 {
		t.Fatalf("issue: %v %v", cards, err)
	}
	raw := mustJSON(t, cards[0])
	if want := `{"id":"` + cards[0].ID + `","code":"` + cards[0].Code + `","initial_value":50000,"expires_at":"2026-02-28T03:04:05.678Z"}`; raw != want {
		t.Fatalf("issued card json: %s", raw)
	}
	var note string
	e.scalar(&note, `SELECT note || '|' || buyer_name || '|' || source_type FROM giftcard.gift_cards WHERE id = $1`, cards[0].ID)
	if note != "Dijual di kasir (order "+order+")|Ani|pos_order" || e.ledgerCount(cards[0].ID, "isi") != 1 {
		t.Fatalf("issued row: %s", note)
	}
	again, err := e.svc.IssueGiftCardsForPosOrder(e.ctx, e.tx, in)
	if err != nil || mustJSON(t, again) != mustJSON(t, cards) {
		t.Fatalf("issue is not idempotent: %v %v", again, err)
	}

	e.now = time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	pay := e.uuid()
	redeem := func(code string, amount float64, orderID string) RedeemOutcome {
		out, err := e.svc.RedeemGiftCardForPosOrder(e.ctx, e.tx, RedeemInput{Scope: e.scope, Code: code, Amount: amount, OrderID: orderID, CreatedBy: e.pos.UserID})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	if out := redeem("nope1234", 1, pay); out != (RedeemOutcome{Reason: "Gift card tidak ditemukan", Status: 404}) {
		t.Fatalf("not found: %+v", out)
	}
	if out := redeem(cards[0].Code, 60000, pay); out != (RedeemOutcome{Reason: "Saldo gift card tidak cukup", Status: 400}) {
		t.Fatalf("low balance: %+v", out)
	}
	if out := redeem(" "+strings.ToLower(cards[0].Code), 50000, pay); !out.OK || out.BalanceAfter != 0 || out.StatusAfter != "exhausted" || out.CardID != cards[0].ID {
		t.Fatalf("redeem: %+v", out)
	}
	if out := redeem(cards[1].Code, 10, pay); out != (RedeemOutcome{Reason: "Order ini sudah dibayar dengan gift card", Status: 409}) {
		t.Fatalf("second debit: %+v", out)
	}

	// Void refuses a sale whose card was spent, and changes nothing.
	_, err = e.svc.VoidIssuedGiftCardsForPosOrder(e.ctx, e.tx, VoidInput{OrderID: order})
	var used *IssuedGiftCardAlreadyUsedError
	if !errors.As(err, &used) || err.Error() != "Gift card "+cards[0].Code+" sudah terpakai — void ditolak" {
		t.Fatalf("void of a used card: %v", err)
	}
	if _, status := e.cardState(cards[1].ID); status != "active" {
		t.Fatalf("void touched card 2: %s", status)
	}

	// Refund gives the debit back once.
	ok, err := e.svc.RefundGiftCardForPosOrder(e.ctx, e.tx, RefundInput{Scope: e.scope, OrderID: pay, CreatedBy: e.pos.UserID})
	if err != nil || !ok {
		t.Fatalf("refund: %v %v", ok, err)
	}
	ok, err = e.svc.RefundGiftCardForPosOrder(e.ctx, e.tx, RefundInput{Scope: e.scope, OrderID: pay})
	if balance, status := e.cardState(cards[0].ID); err != nil || !ok || balance != 50000 || status != "active" || e.ledgerCount(cards[0].ID, "koreksi") != 1 {
		t.Fatalf("refund twice: ok=%v err=%v balance=%v status=%s", ok, err, balance, status)
	}
	e.scalar(&note, `SELECT note FROM giftcard.gift_card_ledger WHERE card_id = $1 AND direction = 'koreksi'`, cards[0].ID)
	if note != "Pengembalian saldo — pembayaran order gagal diselesaikan" {
		t.Fatalf("refund note: %q", note)
	}
	if ok, err := e.svc.RefundGiftCardForPosOrder(e.ctx, e.tx, RefundInput{Scope: e.scope, OrderID: e.uuid()}); err != nil || ok {
		t.Fatalf("refund without debit: %v %v", ok, err)
	}

	// A sale whose cards are unspent voids; a second void is a no-op.
	other := e.uuid()
	sold, err := e.svc.IssueGiftCardsForPosOrder(e.ctx, e.tx, IssueInput{Scope: e.scope, OrderID: other, Nominals: []float64{25000}})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if n, err := e.svc.VoidIssuedGiftCardsForPosOrder(e.ctx, e.tx, VoidInput{OrderID: other, Note: " — void X1"}); err != nil || n != 1 {
			t.Fatalf("void: %d %v", n, err)
		}
	}
	e.scalar(&note, `SELECT status || '|' || note FROM giftcard.gift_cards WHERE id = $1`, sold[0].ID)
	if note != "disabled|Dijual di kasir (order "+other+") — void X1" {
		t.Fatalf("voided card: %s", note)
	}
	if n, err := e.svc.VoidIssuedGiftCardsForPosOrder(e.ctx, e.tx, VoidInput{OrderID: e.uuid()}); err != nil || n != 0 {
		t.Fatalf("void of an order without cards: %d %v", n, err)
	}
	// The caller's transaction stays usable after the refused void.
	e.scalar(&note, `SELECT 'ok'`)
}

/* ── helpers ─────────────────────────────────────────────────────────── */

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(buf.String())
}

func ptr[T any](v T) *T { return &v }
