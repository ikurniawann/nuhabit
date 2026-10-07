package tableorder

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Port of app/api/table-order/orders/[id]/payment-proof/route.test.ts and
// the cashier's GET /api/pos/orders/[id]/payment-proof, on real files in a
// temporary STORAGE_DIR.

var pngBytes = append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 32)...)

// proofUpload builds a multipart body with one `file` part sent without a
// MIME type (some phone galleries do that); nil data sends no file.
func proofUpload(t *testing.T, path string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if data != nil {
		h := textproto.MIMEHeader{}
		h.Set("Content-Disposition", `form-data; name="file"; filename="bukti.png"`)
		h.Set("Content-Type", "")
		part, err := mw.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(http.MethodPost, path, &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func (e *env) staticQrisOrder() string {
	e.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('static_qris_enabled', 'true'), ('static_qris_image_url', '/api/files/payment-qris/q.png')`)
	d := data(e.post(map[string]any{"table_code": "WIT-OFFICE-BDG", "payment_method": "static_qris", "items": []any{item(e.latte)}}, false, 201))
	return d["id"].(string)
}

func (e *env) serve(r *http.Request) *httptest.ResponseRecorder {
	rec, _ := testutil.Do(e.t, e.mux, r)
	return rec
}

func (e *env) expect(r *http.Request, status int, msg string) {
	e.t.Helper()
	rec, out := testutil.Do(e.t, e.mux, r)
	if rec.Code != status || (msg != "" && out["error"] != msg) {
		e.t.Fatalf("%s %s: %d %s, want %d %q", r.Method, r.URL.Path, rec.Code, rec.Body.String(), status, msg)
	}
}

func TestPaymentProofUploadAndView(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	e := setup(t)
	id := e.staticQrisOrder()
	path := "/api/table-order/orders/" + id + "/payment-proof"

	// An old proof in the order's folder is replaced and removed.
	old := "payment-proofs/" + id + "/1-old.png"
	oldAbs := filepath.Join(dir, "private", filepath.FromSlash(old))
	if err := os.MkdirAll(filepath.Dir(oldAbs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldAbs, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	e.exec(`UPDATE pos.pos_orders SET payment_proof_path = $2 WHERE id = $1`, id, old)

	rec, out := testutil.Do(t, e.mux, proofUpload(t, path, pngBytes))
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	if at, _ := data(out)["payment_proof_uploaded_at"].(string); !strings.HasSuffix(at, "Z") || len(at) != 24 {
		t.Fatalf("uploaded_at: %v", out)
	}
	var saved string
	e.scalar(&saved, `SELECT payment_proof_path FROM pos.pos_orders WHERE id = $1`, id)
	if !strings.HasPrefix(saved, "payment-proofs/"+id+"/") || !strings.HasSuffix(saved, ".png") {
		t.Fatalf("saved path %q", saved)
	}
	if got, err := os.ReadFile(filepath.Join(dir, "private", filepath.FromSlash(saved))); err != nil || !bytes.Equal(got, pngBytes) {
		t.Fatalf("stored bytes: %v", err)
	}
	if _, err := os.Stat(oldAbs); !os.IsNotExist(err) {
		t.Fatalf("old proof kept: %v", err)
	}

	// The guest reads it back with the TS headers.
	view := e.serve(httptest.NewRequest(http.MethodGet, path, nil))
	if view.Code != 200 || !bytes.Equal(view.Body.Bytes(), pngBytes) || view.Header().Get("Content-Type") != "image/png" ||
		view.Header().Get("Cache-Control") != "private, no-store" || view.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("view: %d %v", view.Code, view.Header())
	}

	// The cashier needs a POS session.
	posPath := "/api/pos/orders/" + id + "/payment-proof"
	e.expect(httptest.NewRequest(http.MethodGet, posPath, nil), 401, "Authentication required")
	noPos := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm": nil}})
	e.expect(testutil.AsStaff(httptest.NewRequest(http.MethodGet, posPath, nil), noPos), 401, "Authentication required")
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos": nil}})
	pos := e.serve(testutil.AsStaff(httptest.NewRequest(http.MethodGet, posPath, nil), cashier))
	if pos.Code != 200 || !bytes.Equal(pos.Body.Bytes(), pngBytes) || pos.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("pos view: %d %s", pos.Code, pos.Body.String())
	}
	e.expect(testutil.AsStaff(httptest.NewRequest(http.MethodGet, "/api/pos/orders/nope/payment-proof", nil), cashier), 400, "Order tidak valid")

	// A path outside the order's folder is never read.
	e.exec(`UPDATE pos.pos_orders SET payment_proof_path = 'psikotes/rahasia.png' WHERE id = $1`, id)
	e.expect(httptest.NewRequest(http.MethodGet, path, nil), 404, "Bukti bayar belum ada")
	e.expect(testutil.AsStaff(httptest.NewRequest(http.MethodGet, posPath, nil), cashier), 404, "Bukti bayar belum ada")
	e.exec(`UPDATE pos.pos_orders SET payment_proof_path = $2 WHERE id = $1`, id, "payment-proofs/"+id+"/../../secret.png")
	e.expect(httptest.NewRequest(http.MethodGet, path, nil), 404, "Bukti bayar belum ada")
	// A recorded file that is gone.
	e.exec(`UPDATE pos.pos_orders SET payment_proof_path = $2 WHERE id = $1`, id, "payment-proofs/"+id+"/gone.png")
	e.expect(testutil.AsStaff(httptest.NewRequest(http.MethodGet, posPath, nil), cashier), 404, "Berkas bukti bayar hilang")
}

func TestPaymentProofRejections(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	e := setup(t)
	id := e.staticQrisOrder()
	path := "/api/table-order/orders/" + id + "/payment-proof"

	e.expect(proofUpload(t, "/api/table-order/orders/..%2Fetc/payment-proof", pngBytes), 400, "Order tidak valid")
	e.expect(proofUpload(t, "/api/table-order/orders/11111111-1111-4111-8111-111111111111/payment-proof", pngBytes), 404, "Order tidak ditemukan")
	e.expect(proofUpload(t, path, nil), 400, "Pilih foto bukti bayar dulu")
	e.expect(proofUpload(t, path, []byte("<html><script>alert(1)</script></html>")), 400, "File harus foto/tangkapan layar JPG, PNG, atau WebP")
	e.expect(proofUpload(t, path, append(bytes.Clone(pngBytes), make([]byte, 8<<20)...)), 400, "Foto bukti maksimal 8 MB")

	e.exec(`UPDATE pos.pos_orders SET special_requests = 'Self-service table order T1; payment=cashier' WHERE id = $1`, id)
	e.expect(proofUpload(t, path, pngBytes), 409, "Order ini tidak memakai pembayaran Static QRIS")
	e.exec(`UPDATE pos.pos_orders SET special_requests = 'payment=static_qris', payment_status = 'paid' WHERE id = $1`, id)
	e.expect(proofUpload(t, path, pngBytes), 409, "Order sudah lunas")
	e.exec(`UPDATE pos.pos_orders SET payment_status = 'unpaid', status = 'cancelled' WHERE id = $1`, id)
	e.expect(proofUpload(t, path, pngBytes), 409, "Order sudah dibatalkan")

	if entries, _ := os.ReadDir(filepath.Join(dir, "private", "payment-proofs")); len(entries) != 0 {
		t.Fatalf("rejected uploads wrote files: %v", entries)
	}
}
