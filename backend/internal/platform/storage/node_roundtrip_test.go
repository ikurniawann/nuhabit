package storage

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestNextRoundTrip runs the real lib/storage.ts and lib/storage-private.ts
// under Node (type stripping, Node >= 23) against the same directory: files
// Next writes must resolve and read in Go, and files Go writes must read and
// delete in Next. It skips when node is not installed.
func TestNextRoundTrip(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	_, here, _, _ := runtime.Caller(0)
	lib, _ := filepath.Abs(filepath.Join(filepath.Dir(here), "..", "..", "..", "..", "frontend", "src", "lib"))
	if _, err := os.Stat(filepath.Join(lib, "storage.ts")); err != nil {
		t.Skip("frontend checkout not found")
	}

	cwd := t.TempDir() // Next's process.cwd(); storage lives in cwd/storage
	s := New(filepath.Join(cwd, "storage"))
	goURL, err := s.Upload("candidates", "cvs", []byte("%PDF-1.7 go"), "application/pdf", "cv.pdf")
	if err != nil {
		t.Fatal(err)
	}
	goRel, err := s.SavePrivateDocument([]byte("%PDF-1.7 go private"), "faktur-pajak")
	if err != nil {
		t.Fatal(err)
	}

	script := `
const [lib, goURL, goRel] = process.argv.slice(1);
const pub = await import(lib + "/storage.ts");
const priv = await import(lib + "/storage-private.ts");
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(16)]);
const up = await pub.uploadFile("member-photos", new File([png], "x.svg", { type: "image/png" }), "cust-1");
const pr = await priv.savePrivateImage(png, "image/png", "attendance/e1");
const read = await priv.readPrivateFile(goRel);
const del = await pub.deleteFile("candidates", goURL);
console.log(JSON.stringify({ url: up.url, rel: pr.path, goMime: read.mime, goBody: read.data && read.data.toString(), delErr: del.error }));
`
	cmd := exec.Command(node, "--no-warnings", "--input-type=module", "-e", script, lib, goURL, goRel)
	cmd.Dir = cwd
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v %s", err, stderr.String())
	}
	var got struct{ URL, Rel, GoMime, GoBody, DelErr string }
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("%s: %v", out, err)
	}

	// Next -> Go
	abs, ok := s.UploadPath(got.URL)
	if !ok {
		t.Fatalf("Next URL %q not resolved", got.URL)
	}
	if data, _ := os.ReadFile(abs); !bytes.HasPrefix(data, pngMagic) {
		t.Fatal("Next upload unreadable from Go")
	}
	if data, mime, err := s.ReadPrivate(got.Rel); err != nil || mime != "image/png" || !bytes.HasPrefix(data, pngMagic) {
		t.Fatalf("Next private file: %q %v", mime, err)
	}
	// Go -> Next
	if got.GoMime != "application/pdf" || got.GoBody != "%PDF-1.7 go private" {
		t.Fatalf("Go private file read by Next: %+v", got)
	}
	if got.DelErr != "" {
		t.Fatalf("Next could not delete the Go upload: %s", got.DelErr)
	}
	if goAbs, _ := s.UploadPath(goURL); fileExists(goAbs) {
		t.Fatal("Go upload still present after Next deleteFile")
	}
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }
