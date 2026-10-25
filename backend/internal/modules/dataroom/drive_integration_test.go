package dataroom

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// Drive replacement: grants with inheritance and overrides, trash with
// restore and purge, versions, search, share expiry and the download
// toggle, chunked uploads, comments with mentions, locks, copies and the
// filing port.

// testPeople reads configuration.users on the test transaction.
type testPeople struct{ q database.Querier }

func (p testPeople) Search(ctx context.Context, q string, limit int) ([]Person, error) {
	return p.list(ctx, `SELECT id::text, full_name, email, role FROM configuration.users
		WHERE status = 'active' AND full_name ILIKE '%' || $1 || '%' ORDER BY full_name LIMIT $2`, q, limit)
}

func (p testPeople) ByIDs(ctx context.Context, ids []string) ([]Person, error) {
	return p.list(ctx, `SELECT id::text, full_name, email, role FROM configuration.users WHERE id = ANY($1::uuid[]) ORDER BY full_name`, ids)
}

func (p testPeople) list(ctx context.Context, sql string, args ...any) ([]Person, error) {
	rows, err := p.q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Person])
}

// person inserts a staff account the People port and notifications see.
func (f *fixture) person(name, role string) string {
	f.t.Helper()
	email := strings.ToLower(strings.ReplaceAll(name, " ", ".")) + "-" + testutil.RandomHex(3) + "@test.local"
	id := f.scalar(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`, email)
	f.scalar(`INSERT INTO configuration.users (id, full_name, role, email) VALUES ($1, $2, $3, $4) RETURNING id::text`, id, name, role, email)
	return id
}

func (f *fixture) grants(nodeID string, grants []map[string]any, asStaff string, status int) response {
	f.t.Helper()
	return f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + nodeID + "/permissions", staff: asStaff,
		body: map[string]any{"grants": grants}}), status)
}

func (f *fixture) listNames(target, staff string, role ...string) []string {
	f.t.Helper()
	r := f.ok(f.do(call{method: "GET", target: target, staff: staff, role: strings.Join(role, "")}), 200)
	names := []string{}
	for _, it := range r.data()["items"].([]any) {
		names = append(names, it.(map[string]any)["name"].(string))
	}
	return names
}

func TestPermissionsInheritanceAndOverrides(t *testing.T) {
	f, _ := fileFixture(t)
	fin := f.department("Go Test FIN")
	root := f.folder("Direksi", nil)
	sub := f.folder("Rapat", &root)
	fileID := f.ok(f.upload(sub, part{"file", "notulen.txt", "", []byte("rapat")}, ""), 201).data()["id"].(string)
	f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + root + "/access", role: "super_admin",
		body: map[string]any{"department_ids": []string{fin}}}), 200)
	ops := f.person("Ops Satu", "pos")
	f.dir.dept[ops] = f.department("Go Test OPS")

	// Department baseline: closed.
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + sub, staff: ops, role: "pos"}), 403, "Folder ini tidak dibuka untuk departemen Anda")
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + fileID + "/download", staff: ops, role: "pos"}), 403, "File ini tidak dibuka untuk departemen Anda")

	// A viewer grant on the root is inherited by the subfolder and its file.
	f.fail(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + root + "/permissions", staff: ops, role: "pos",
		body: map[string]any{"grants": []any{}}}), 403, "Item ini tidak dibuka untuk departemen Anda")
	saved := f.grants(root, []map[string]any{{"subject_type": "user", "subject_id": ops, "role": "viewer"}}, "", 200)
	if raw, _ := json.Marshal(saved.data()["grants"]); !strings.Contains(string(raw), `"subject_name":"Ops Satu"`) || !strings.Contains(string(raw), `"role":"viewer"`) {
		t.Fatalf("grants: %s", raw)
	}
	if names := f.listNames("/api/dataroom/nodes?parent="+sub, ops); len(names) != 1 || names[0] != "notulen.txt" {
		t.Fatalf("inherited listing: %v", names)
	}
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + fileID + "/download", staff: ops, role: "pos"}), 200); r.Raw != "rapat" {
		t.Fatalf("inherited download: %s", r.Raw)
	}
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + fileID, staff: ops, role: "pos", body: map[string]any{"name": "x"}}), 403, "Anda tidak punya hak mengedit item ini")
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/comments", staff: ops, role: "pos", body: map[string]any{"body": "hai"}}), 403, "Anda tidak punya hak berkomentar di item ini")
	f.fail(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + root + "/permissions", staff: ops, role: "pos",
		body: map[string]any{"grants": []any{}}}), 403, "Hanya pemilik yang bisa melakukan ini")
	if n := f.scalar(`SELECT count(*)::text FROM public.notifications WHERE user_id = $1 AND metadata->>'kind' = 'dataroom_share'`, ops); n != "1" {
		t.Fatalf("share notification rows: %s", n)
	}
	if len(f.mail.sent) != 1 || !strings.Contains(f.mail.sent[0].subject, `membagikan folder "Direksi"`) {
		t.Fatalf("share email: %+v", f.mail.sent)
	}

	// A higher grant below overrides: editor on the subfolder.
	f.grants(sub, []map[string]any{{"subject_type": "user", "subject_id": ops, "role": "editor"}}, "", 200)
	f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + fileID, staff: ops, role: "pos", body: map[string]any{"name": "notulen-final.txt"}}), 200)
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + root, staff: ops, role: "pos", body: map[string]any{"name": "x"}}), 403, "Anda tidak punya hak mengedit item ini")

	// A lower grant below overrides a role grant above: the nearest wins.
	f.grants(root, []map[string]any{{"subject_type": "role", "subject_id": "pos", "role": "editor"}}, "", 200)
	f.grants(sub, []map[string]any{{"subject_type": "user", "subject_id": ops, "role": "viewer"}}, "", 200)
	f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + root, staff: ops, role: "pos", body: map[string]any{"description": "rapat direksi"}}), 200)
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + fileID, staff: ops, role: "pos", body: map[string]any{"name": "x"}}), 403, "Anda tidak punya hak mengedit item ini")

	// Shared with me lists the nodes with a direct grant for me or my role.
	if names := f.listNames("/api/dataroom/nodes?view=shared", ops, "pos"); strings.Join(names, ",") != "Direksi,Rapat" {
		t.Fatalf("shared with me: %v", names)
	}
	if names := f.listNames("/api/dataroom/nodes?view=shared", ""); len(names) != 0 {
		t.Fatalf("creator sees own nodes as shared: %v", names)
	}
	levels := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + sub + "/permissions", staff: ops, role: "pos"}), 200).data()
	if levels["my_level"] != "viewer" || levels["can_manage"] != false {
		t.Fatalf("my level: %v", levels)
	}
}

func TestTrashRestorePurgeAndHousekeeping(t *testing.T) {
	f, dir := fileFixture(t)
	root := f.folder("Arsip", nil)
	sub := f.folder("2025", &root)
	fileNode := f.ok(f.upload(sub, part{"file", "lama.txt", "", []byte("lama")}, ""), 201).data()
	fileID, path := fileNode["id"].(string), fileNode["storage_path"].(string)
	other := f.ok(f.upload("", part{"file", "lain.txt", "", []byte("lain")}, ""), 201).data()["id"].(string)

	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + sub}), 200)
	if names := f.listNames("/api/dataroom/nodes?parent="+root, ""); len(names) != 0 {
		t.Fatalf("trashed folder still listed: %v", names)
	}
	if names := f.listNames("/api/dataroom/nodes?view=trash", ""); strings.Join(names, ",") != "2025" {
		t.Fatalf("trash lists roots only: %v", names)
	}
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + sub}), 404, "Item tidak ditemukan")
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + sub}), 404, "Folder tidak ditemukan")
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/restore"}), 400, "Item tidak ada di sampah")

	// Search skips the trash; restore brings the subtree back.
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/search?q=lama"}), 200); len(r.data()["items"].([]any)) != 0 {
		t.Fatalf("search found trash: %s", r.Raw)
	}
	restored := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + sub + "/restore"}), 200).data()
	if restored["parent_id"] != root || restored["trashed_at"] != nil {
		t.Fatalf("restore: %v", restored)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.nodes WHERE id IN ($1, $2) AND trashed_at IS NULL`, sub, fileID); n != "2" {
		t.Fatalf("restored rows: %s", n)
	}

	// A file trashed on its own, then its folder: restoring the folder
	// leaves the file in the trash; restoring the file while its folder is
	// in the trash lands it at root.
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + fileID}), 200)
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + sub}), 200)
	f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + sub + "/restore"}), 200)
	if names := f.listNames("/api/dataroom/nodes?view=trash", ""); strings.Join(names, ",") != "lama.txt" {
		t.Fatalf("file keeps its own trash entry: %v", names)
	}
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + sub}), 200)
	back := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/restore"}), 200).data()
	if back["parent_id"] != nil {
		t.Fatalf("restore under a trashed parent lands at root: %v", back)
	}
	f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + sub + "/restore"}), 200)

	// Housekeeping purges roots older than 30 days and expired upload sessions.
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + fileID}), 200)
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + other}), 200)
	f.scalar(`UPDATE dataroom.nodes SET trashed_at = now() - interval '31 days' WHERE id = $1 RETURNING id::text`, fileID)
	session := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "besar.bin", "size": 10}}), 201).data()
	f.ok(f.do(call{method: "PUT", target: "/api/dataroom/uploads/" + session["id"].(string) + "/chunk", headers: map[string]string{"X-Upload-Offset": "0"}, body: nil}), 400)
	f.scalar(`UPDATE dataroom.upload_sessions SET expires_at = now() - interval '1 hour' WHERE id = $1 RETURNING id::text`, session["id"])
	if err := f.svc.Housekeeping(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.nodes WHERE id = $1`, fileID); n != "0" {
		t.Fatal("old trash not purged")
	}
	if _, err := os.Stat(filepath.Join(dir, "private", filepath.FromSlash(path))); !os.IsNotExist(err) {
		t.Fatalf("purged file still on disk: %v", err)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.nodes WHERE id = $1 AND trashed_root`, other); n != "1" {
		t.Fatal("recent trash purged too early")
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.upload_sessions`); n != "0" {
		t.Fatal("expired upload session kept")
	}
}

// postVersion uploads a new version of a file.
func (f *fixture) postVersion(nodeID string, p part, staff string) response {
	f.t.Helper()
	req := multipartRequest(f.t, "/api/dataroom/nodes/"+nodeID+"/versions", nil, p)
	if staff == "" {
		staff = f.staff
	}
	req.Header.Set("X-Test-Staff", staff)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return response{Status: rec.Code, Raw: rec.Body.String(), Body: out, Header: rec.Header()}
}

func TestVersionsAndLock(t *testing.T) {
	f, _ := fileFixture(t)
	root := f.folder("Kontrak", nil)
	node := f.ok(f.upload(root, part{"file", "sewa.txt", "", []byte("satu")}, ""), 201).data()
	id := node["id"].(string)

	v2 := f.ok(f.postVersion(id, part{"file", "sewa-v2.txt", "", []byte("dua dua")}, ""), 201).data()
	if v2["version"] != float64(2) || v2["size_bytes"] != float64(7) || v2["name"] != "sewa.txt" {
		t.Fatalf("v2: %v", v2)
	}
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download"}), 200); r.Raw != "dua dua" {
		t.Fatalf("live bytes: %s", r.Raw)
	}
	versions := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/versions"}), 200).Body["data"].([]any)
	if len(versions) != 1 || versions[0].(map[string]any)["version"] != float64(1) {
		t.Fatalf("versions: %v", versions)
	}
	v1 := versions[0].(map[string]any)["id"].(string)
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/versions/" + v1 + "/download"}), 200); r.Raw != "satu" {
		t.Fatalf("v1 bytes: %s", r.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/versions/" + newUUID(t, f.tx) + "/download"}), 404, "Versi tidak ditemukan")

	// Restoring keeps the replaced bytes as a version too.
	restored := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + id + "/versions/" + v1 + "/restore"}), 200).data()
	if restored["version"] != float64(3) || restored["size_bytes"] != float64(4) {
		t.Fatalf("restored: %v", restored)
	}
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download"}), 200); r.Raw != "satu" {
		t.Fatalf("restored bytes: %s", r.Raw)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.node_versions WHERE node_id = $1`, id); n != "2" {
		t.Fatalf("version rows: %s", n)
	}
	used, _ := f.svc.usedBytes(context.Background())
	if used != 4+4+7 {
		t.Fatalf("quota counts versions: %d", used)
	}

	// A lock held by someone else refuses edits, versions and trash.
	editor := f.person("Editor Dua", "admin")
	locked := f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + id + "/lock", staff: editor}), 200).data()
	if locked["locked_by"] != editor || locked["locked_by_name"] != "Dewi Arsip" {
		t.Fatalf("lock: %v", locked)
	}
	if r := f.postVersion(id, part{"file", "x.txt", "", []byte("x")}, ""); r.Status != 423 || r.Body["error"] != "Sedang diedit oleh Dewi Arsip" {
		t.Fatalf("locked version: %s", r.Raw)
	}
	if r := f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + id, body: map[string]any{"name": "y.txt"}}); r.Status != 423 {
		t.Fatalf("locked rename: %s", r.Raw)
	}
	if r := f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + id}); r.Status != 423 {
		t.Fatalf("locked trash: %s", r.Raw)
	}
	// Tags and description stay editable; the owner may unlock.
	f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + id, body: map[string]any{"tags": []string{"Sewa", " kantor ", "sewa"}}}), 200)
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + id + "/lock"}), 200)
	f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + id, body: map[string]any{"name": "y.txt"}}), 200)
	if tags := f.scalar(`SELECT array_to_string(tags, ',') FROM dataroom.nodes WHERE id = $1`, id); tags != "sewa,kantor" {
		t.Fatalf("tags: %s", tags)
	}
}

func TestSearchIndexesNamesTagsAndText(t *testing.T) {
	f, _ := fileFixture(t)
	root := f.folder("Keuangan", nil)
	pdfID := f.ok(f.upload(root, part{"file", "neraca-2026.pdf", "", samplePDF(t, "Laporan audit tahunan")}, ""), 201).data()["id"].(string)
	f.ok(f.upload(root, part{"file", "catatan.txt", "", []byte("rapat anggaran kuartal")}, ""), 201)
	f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdfID, body: map[string]any{"tags": []string{"audit", "tahunan"}, "description": "Hasil pemeriksaan KAP"}}), 200)

	hits := func(q string) []string {
		t.Helper()
		r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/search?" + q}), 200)
		names := []string{}
		for _, it := range r.data()["items"].([]any) {
			names = append(names, it.(map[string]any)["name"].(string))
		}
		return names
	}
	if got := hits("q=nera"); strings.Join(got, ",") != "neraca-2026.pdf" {
		t.Fatalf("name prefix: %v", got)
	}
	if got := hits("q=pemeriksaan"); strings.Join(got, ",") != "neraca-2026.pdf" {
		t.Fatalf("description: %v", got)
	}
	if got := hits("tag=audit"); strings.Join(got, ",") != "neraca-2026.pdf" {
		t.Fatalf("tag: %v", got)
	}
	if got := hits("q=anggaran"); strings.Join(got, ",") != "catatan.txt" {
		t.Fatalf("text body: %v", got)
	}
	if got := hits("q=tahunan+laporan"); strings.Join(got, ",") != "neraca-2026.pdf" {
		t.Fatalf("pdf text: %v", got)
	}
	if got := hits("q="); len(got) != 0 {
		t.Fatalf("empty query: %v", got)
	}
	r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/search?q=neraca"}), 200)
	hit := r.data()["items"].([]any)[0].(map[string]any)
	if path := hit["path"].([]any); len(path) != 1 || path[0].(map[string]any)["name"] != "Keuangan" {
		t.Fatalf("path: %v", hit["path"])
	}
	tags := f.ok(f.do(call{method: "GET", target: "/api/dataroom/tags"}), 200).Raw
	if !strings.Contains(tags, `{"tag":"audit","count":1}`) {
		t.Fatalf("tags: %s", tags)
	}

	// Stars and recents.
	f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + pdfID + "/star"}), 200)
	if names := f.listNames("/api/dataroom/nodes?view=starred", ""); strings.Join(names, ",") != "neraca-2026.pdf" {
		t.Fatalf("starred: %v", names)
	}
	f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + pdfID + "/download?inline=1"}), 200)
	if names := f.listNames("/api/dataroom/nodes?view=recent", ""); strings.Join(names, ",") != "neraca-2026.pdf" {
		t.Fatalf("recent: %v", names)
	}
	acts := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + pdfID + "/activity"}), 200).Raw
	if !strings.Contains(acts, `"action":"view"`) || !strings.Contains(acts, `"action":"update_meta"`) || !strings.Contains(acts, `"action":"upload"`) {
		t.Fatalf("activity: %s", acts)
	}
}

func TestShareExpiryAndDownloadToggle(t *testing.T) {
	f, _ := fileFixture(t)
	root := f.folder("Investor", nil)
	pdfID := f.ok(f.upload(root, part{"file", "deck.pdf", "", samplePDF(t, "Deck")}, ""), 201).data()["id"].(string)
	id, token, created := f.share(map[string]any{"node_id": root, "access_type": "public", "allow_download": false, "expires_days": 1})
	if created.data()["allow_download"] != false {
		t.Fatalf("share: %s", created.Raw)
	}
	base := "/api/share/" + token
	f.ok(f.do(call{method: "GET", target: base + "/files/" + pdfID, staff: "-"}), 200)
	f.fail(f.do(call{method: "GET", target: base + "/files/" + pdfID + "?download=1", staff: "-"}), 403, "Link ini hanya untuk melihat; unduhan dimatikan oleh pemilik")
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.share_access_logs WHERE share_id = $1 AND action = 'download'`, id); n != "0" {
		t.Fatal("refused download logged")
	}
	// A viewer with a grant may not create links; a trashed node is gone.
	viewer := f.person("Tamu Lihat", "pos")
	f.grants(root, []map[string]any{{"subject_type": "user", "subject_id": viewer, "role": "viewer"}}, "", 200)
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/shares", staff: viewer, body: map[string]any{"node_id": root, "access_type": "public"}}), 403,
		"Hanya editor atau pemilik yang bisa membuat link berbagi")

	f.scalar(`UPDATE dataroom.shares SET expires_at = now() - interval '1 minute' WHERE id = $1 RETURNING id::text`, id)
	f.fail(f.do(call{method: "GET", target: base, staff: "-"}), 410, "Link sudah kedaluwarsa")
	f.fail(f.do(call{method: "GET", target: base + "/files/" + pdfID, staff: "-"}), 410, "Link sudah kedaluwarsa")

	_, token2, _ := f.share(map[string]any{"node_id": pdfID, "access_type": "public"})
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/nodes/" + pdfID}), 200)
	f.fail(f.do(call{method: "GET", target: "/api/share/" + token2, staff: "-"}), 404, "Berkas sudah dihapus")
}

func (f *fixture) chunk(sessionID string, offset int, data []byte, status int) response {
	f.t.Helper()
	req := httptest.NewRequest("PUT", "/api/dataroom/uploads/"+sessionID+"/chunk", bytes.NewReader(data))
	req.Header.Set("X-Test-Staff", f.staff)
	req.Header.Set("X-Upload-Offset", strconv.Itoa(offset))
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	r := response{Status: rec.Code, Raw: rec.Body.String(), Body: out, Header: rec.Header()}
	return f.ok(r, status)
}

func TestChunkedUploadAndVersionReplace(t *testing.T) {
	f, dir := fileFixture(t)
	root := f.folder("Video", nil)
	pdf := samplePDF(t, "Potongan")
	f.svc.ports.MaxChunkedBytes = float64(len(pdf) - 1)
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "a.pdf", "size": len(pdf), "parent_id": root}}), 400,
		"Ukuran file melebihi batas "+domain.FormatBytes(float64(len(pdf)-1)))
	f.svc.ports.MaxChunkedBytes = 1 << 30
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "a.pdf", "size": len(pdf), "parent_id": newUUID(t, f.tx)}}), 404, "Folder tujuan tidak ditemukan")
	started := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "a/b.pdf", "size": len(pdf), "parent_id": root, "mime": "application/octet-stream"}}), 201).data()
	sid := started["id"].(string)
	if started["chunk_bytes"] != float64(MaxChunkBytes) || started["received_bytes"] != float64(0) {
		t.Fatalf("start: %v", started)
	}
	half := len(pdf) / 2
	f.chunk(sid, 0, pdf[:half], 200)
	// A repeated or out-of-order chunk is refused with the resume offset.
	if r := f.chunk(sid, 0, pdf[:half], 409); r.Body["code"] != "offset_mismatch" {
		t.Fatalf("offset: %s", r.Raw)
	}
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/uploads/" + sid + "/complete"}), 400, "Unggahan belum lengkap ("+strconv.Itoa(half)+" dari "+strconv.Itoa(len(pdf))+" byte)")
	status := f.ok(f.do(call{method: "GET", target: "/api/dataroom/uploads/" + sid}), 200).data()
	if status["received_bytes"] != float64(half) {
		t.Fatalf("status: %v", status)
	}
	f.chunk(sid, half, pdf[half:], 200)
	node := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads/" + sid + "/complete"}), 201).data()
	if node["mime"] != "application/pdf" || node["name"] != "a-b.pdf" || node["size_bytes"] != float64(len(pdf)) || node["parent_id"] != root {
		t.Fatalf("complete: %v", node)
	}
	if onDisk, err := os.ReadFile(filepath.Join(dir, "private", filepath.FromSlash(node["storage_path"].(string)))); err != nil || !bytes.Equal(onDisk, pdf) {
		t.Fatalf("assembled file: %v", err)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.upload_sessions WHERE id = $1`, sid); n != "0" {
		t.Fatal("session kept after complete")
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/uploads/" + sid}), 404, "Sesi unggah tidak ditemukan")
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/search?q=potongan"}), 200); len(r.data()["items"].([]any)) != 1 {
		t.Fatalf("chunked upload indexed: %s", r.Raw)
	}

	// replace_node_id makes the session a new version.
	id := node["id"].(string)
	again := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "v2.txt", "size": 3, "replace_node_id": id}}), 201).data()
	f.chunk(again["id"].(string), 0, []byte("v2!"), 200)
	v2 := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads/" + again["id"].(string) + "/complete"}), 201).data()
	if v2["id"] != id || v2["version"] != float64(2) || v2["name"] != "a-b.pdf" || v2["size_bytes"] != float64(3) {
		t.Fatalf("replace: %v", v2)
	}
	// Another account cannot touch the session.
	other := f.ok(f.do(call{method: "POST", target: "/api/dataroom/uploads", body: map[string]any{"name": "x.txt", "size": 1}}), 201).data()
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/uploads/" + other["id"].(string), staff: newUUID(t, f.tx)}), 404, "Sesi unggah tidak ditemukan")
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/uploads/" + other["id"].(string)}), 200)
}

func TestCommentsMentionsAndCopy(t *testing.T) {
	f, _ := fileFixture(t)
	root := f.folder("Proyek", nil)
	fileID := f.ok(f.upload(root, part{"file", "brief.txt", "", []byte("brief")}, ""), 201).data()["id"].(string)
	budi := f.person("Budi Komentar", "admin")
	f.grants(fileID, []map[string]any{{"subject_type": "user", "subject_id": budi, "role": "commenter"}}, "", 200)

	first := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/comments", staff: budi,
		body: map[string]any{"body": "Tolong cek @Dewi", "mention_user_ids": []string{f.staff, budi, newUUID(t, f.tx)}}}), 201).data()
	if mentions := first["mentions"].([]any); len(mentions) != 0 {
		t.Fatalf("unknown and self mentions dropped: %v", mentions)
	}
	dewi := f.person("Dewi Arsip", "super_admin")
	second := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/comments", staff: budi,
		body: map[string]any{"body": "Balasan", "parent_id": first["id"], "mention_user_ids": []string{dewi}}}), 201).data()
	if second["parent_id"] != first["id"] || len(second["mentions"].([]any)) != 1 {
		t.Fatalf("reply: %v", second)
	}
	if n := f.scalar(`SELECT title FROM public.notifications WHERE user_id = $1 AND metadata->>'kind' = 'dataroom_mention'`, dewi); n != `Dewi Arsip menyebut Anda di "brief.txt"` {
		t.Fatalf("mention notification: %s", n)
	}
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/comments", staff: budi,
		body: map[string]any{"body": "x", "parent_id": newUUID(t, f.tx)}}), 404, "Komentar induk tidak ditemukan")
	list := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + fileID + "/comments", staff: budi}), 200).Body["data"].([]any)
	if len(list) != 2 {
		t.Fatalf("comments: %v", list)
	}
	// The author or an owner deletes; others may not.
	stranger := f.person("Orang Lain", "pos")
	f.grants(fileID, []map[string]any{{"subject_type": "user", "subject_id": budi, "role": "commenter"}, {"subject_type": "user", "subject_id": stranger, "role": "editor"}}, "", 200)
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/comments/" + second["id"].(string), staff: stranger}), 403, "Hanya penulis atau pemilik yang bisa menghapus komentar")
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/comments/" + second["id"].(string), staff: budi}), 200)
	f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/comments/" + first["id"].(string)}), 200)
	list = f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + fileID + "/comments"}), 200).Body["data"].([]any)
	if first := list[0].(map[string]any); first["deleted"] != true || first["body"] != "" {
		t.Fatalf("deleted comment: %v", first)
	}

	// Copy: a file next to itself gets a prefix; a folder copies its subtree.
	copied := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + fileID + "/copy", body: map[string]any{"parent_id": root}}), 201).data()
	if copied["name"] != "Salinan brief.txt" || copied["id"] == fileID {
		t.Fatalf("copy: %v", copied)
	}
	if r := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + copied["id"].(string) + "/download"}), 200); r.Raw != "brief" {
		t.Fatalf("copied bytes: %s", r.Raw)
	}
	folderCopy := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + root + "/copy", body: map[string]any{"parent_id": nil}}), 201).data()
	if names := f.listNames("/api/dataroom/nodes?parent="+folderCopy["id"].(string), ""); strings.Join(names, ",") != "brief.txt,Salinan brief.txt" {
		t.Fatalf("folder copy: %v", names)
	}
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/nodes/" + root + "/copy", body: map[string]any{"parent_id": root}}), 400, "Folder tidak bisa disalin ke dalam dirinya sendiri")
}

func TestFileDocumentPort(t *testing.T) {
	f, _ := fileFixture(t)
	hr := f.person("HR Payroll", "hrd")
	filer := NewFiler(f.svc)
	id, err := filer.FileDocument(context.Background(), hr, "Payroll/Slip Gaji/2026", "slip-budi.pdf", "application/pdf", bytes.NewReader(samplePDF(t, "Slip")), []string{"slip-gaji", "Oktober 2026"})
	if err != nil {
		t.Fatal(err)
	}
	node, err := f.svc.Node(context.Background(), id)
	if err != nil || node == nil || node.Kind != "file" || *node.Mime != "application/pdf" || strings.Join(node.Tags, ",") != "slip-gaji,oktober 2026" || *node.CreatedByName != "HR Payroll" {
		t.Fatalf("filed node: %+v %v", node, err)
	}
	trail, _ := f.svc.Ancestors(context.Background(), id)
	if len(trail) != 4 || trail[0].Name != "Payroll" || trail[2].Name != "2026" {
		t.Fatalf("folder chain: %v", trail)
	}
	payroll := trail[0].ID
	if restricted := f.scalar(`SELECT restricted::text FROM dataroom.nodes WHERE id = $1`, payroll); restricted != "true" {
		t.Fatal("top folder not restricted")
	}
	// A second filing reuses the chain.
	if _, err := filer.FileDocument(context.Background(), hr, "payroll/slip gaji/2026", "slip-ani.pdf", "application/pdf", bytes.NewReader(samplePDF(t, "Slip")), nil); err != nil {
		t.Fatal(err)
	}
	if n := f.scalar(`SELECT count(*)::text FROM dataroom.nodes WHERE kind = 'folder'`); n != "3" {
		t.Fatalf("folders: %s", n)
	}
	// Other staff do not see the restricted chain; the owner and super admin do.
	other := f.person("Staf Lain", "pos")
	if names := f.listNames("/api/dataroom/nodes", other); len(names) != 0 {
		t.Fatalf("restricted folder leaked: %v", names)
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download", staff: other}), 403, "File ini tidak dibuka untuk departemen Anda")
	if names := f.listNames("/api/dataroom/nodes", hr); strings.Join(names, ",") != "Payroll" {
		t.Fatalf("owner listing: %v", names)
	}
	f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + id + "/download", staff: hr}), 200)
	if names := f.listNames("/api/dataroom/nodes?parent="+payroll, hr); strings.Join(names, ",") != "Slip Gaji" {
		t.Fatalf("owner subfolder: %v", names)
	}
	if _, err := filer.FileDocument(context.Background(), hr, " / ", "x.pdf", "application/pdf", bytes.NewReader([]byte("x")), nil); err == nil {
		t.Fatal("empty path accepted")
	}
}

// The real guard on the new staff routes.
func TestDriveRoutesAuth(t *testing.T) {
	t.Setenv("STORAGE_DIR", t.TempDir())
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, Ports{Directory: testDirectory{q: deps.DB}, Mailer: &fakeMailer{}, MaxFileBytes: 1 << 20, QuotaBytes: 1 << 30}))
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"dataroom": {"read"}}})
	stranger := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm": {"read"}}})
	missing := "/api/dataroom/nodes/00000000-0000-4000-8000-000000000000"
	for _, c := range []struct {
		r      *http.Request
		status int
		msg    string
	}{
		{testutil.Request("GET", "/api/dataroom/search?q=x", nil), 401, "Authentication required"},
		{testutil.AsStaff(testutil.Request("GET", "/api/dataroom/search?q=x", nil), stranger), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("GET", "/api/dataroom/search?q=x", nil), reader), 200, ""},
		{testutil.AsStaff(testutil.Request("GET", "/api/dataroom/nodes?view=trash", nil), reader), 200, ""},
		{testutil.AsStaff(testutil.Request("GET", "/api/dataroom/people?q=a", nil), stranger), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("POST", "/api/dataroom/uploads", map[string]any{"name": "a", "size": 1}), reader), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("POST", missing+"/copy", map[string]any{}), reader), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("PUT", missing+"/star", nil), reader), 404, "Item tidak ditemukan"},
		{testutil.AsStaff(testutil.Request("GET", missing+"/comments", nil), reader), 404, "Item tidak ditemukan"},
		{testutil.AsStaff(testutil.Request("PUT", missing+"/permissions", map[string]any{"grants": []any{}}), reader), 404, "Item tidak ditemukan"},
		{testutil.AsStaff(testutil.Request("DELETE", missing+"/purge", nil), reader), 403, "Insufficient permissions"},
		{testutil.AsStaff(testutil.Request("POST", missing+"/versions/00000000-0000-4000-8000-000000000000/restore", nil), reader), 403, "Insufficient permissions"},
		{testutil.Request("GET", "/api/dataroom/activity", nil), 401, "Authentication required"},
	} {
		rec, body := testutil.Do(t, mux, c.r)
		if rec.Code != c.status || (c.msg != "" && body["error"] != c.msg) {
			t.Fatalf("%s %s: %d %s", c.r.Method, c.r.URL, rec.Code, rec.Body.String())
		}
	}
}
