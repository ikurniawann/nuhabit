package hris

import (
	"bytes"
	"testing"
)

func TestNodeBase64(t *testing.T) {
	for in, want := range map[string]string{
		"QUJD!REVG": "ABCDEF", "QUJD REVG": "ABCDEF", "QUJD=REVG": "ABC", "QUJ": "AB", "Q": "",
		"QUJD-_": "ABC\xfb", "QU JD\nRE": "ABCD",
	} {
		if got := nodeBase64(in); !bytes.Equal(got, []byte(want)) {
			t.Errorf("nodeBase64(%q) = %x, want %x", in, got, want)
		}
	}
}

func TestParseImageDataURL(t *testing.T) {
	if mime, data, ok := parseImageDataURL("data:image/webp;base64,QUJD"); !ok || mime != "image/webp" || string(data) != "ABC" {
		t.Fatal(mime, data, ok)
	}
	for _, bad := range []string{"data:image/gif;base64,QUJD", "data:image/png;base64,", "data:image/png;base64,QU\nJD",
		"data:image/png;base64,QU JD", " data:image/png;base64,QUJD"} {
		if _, _, ok := parseImageDataURL(bad); ok {
			t.Errorf("%q accepted", bad)
		}
	}
}
