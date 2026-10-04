package domain

import "testing"

// Ported from the MIME, watermark and quota cases of
// lib/dataroom/config.test.ts, plus resolveMime in lib/dataroom/storage.ts.

func TestFileTypes(t *testing.T) {
	for _, c := range []struct{ got, want string }{
		{MimeFromExtension("Foto.JPG"), "image/jpeg"},
		{MimeFromExtension("tanpa-ekstensi"), ""},
		{MimeFromExtension("arsip.tar.gz"), ""},
		{ExtensionForStorage("image/jpeg", "x.jpeg"), "jpg"},
		{ExtensionForStorage("image/tiff", "x.tiff"), "tif"},
		{ExtensionForStorage("application/x-unknown", "arsip.tar"), "tar"},
		{ExtensionForStorage("application/x-unknown", "noext"), "bin"},
		{ExtensionForStorage("application/x-unknown", "a.toolong7"), "bin"},
		{ExtensionForStorage("application/x-unknown", "a.EXE"), "exe"},
		// Sniffed bytes win over the name, the name over the client's claim.
		{ResolveMime([]byte("%PDF-1.7 ..."), "foto.png", "image/png"), "application/pdf"},
		{ResolveMime([]byte("hello"), "catatan.md", "text/html"), "text/markdown"},
		{ResolveMime([]byte("hello"), "x", " Text/HTML "), "text/html"},
		{ResolveMime([]byte("hello"), "x", "text/html; charset=utf-8"), "application/octet-stream"},
		{ResolveMime([]byte("hello"), "x", ""), "application/octet-stream"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
	if !IsWatermarkable("image/png") || IsWatermarkable("image/gif") || !IsWatermarkable("application/pdf") {
		t.Error("watermarkable")
	}
	if !IsPreviewable("image/gif") || !IsPreviewable("application/pdf") || IsPreviewable("image/svg+xml") || IsPreviewable("text/plain") {
		t.Error("previewable")
	}
}

func TestQuotaAndBytes(t *testing.T) {
	if !FitsQuota(10, 5, 15) || FitsQuota(10, 6, 15) {
		t.Error("fitsQuota")
	}
	for in, want := range map[float64]string{
		512: "512 B", 1536: "1.5 KB", 1280: "1.3 KB", 10239: "10.0 KB", 100 * 1024 * 1024: "100 MB",
		50 * 1024 * 1024 * 1024: "50 GB", 0.5 * 1024 * 1024 * 1024: "512 MB",
	} {
		if got := FormatBytes(in); got != want {
			t.Errorf("FormatBytes(%v) = %q, want %q", in, got, want)
		}
	}
}
