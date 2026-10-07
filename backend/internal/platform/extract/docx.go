package extract

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"path"
	"strings"
)

const (
	nsWord     = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsMarkup   = "http://schemas.openxmlformats.org/markup-compatibility/2006"
	nsMath     = "http://schemas.openxmlformats.org/officeDocument/2006/math"
	relTypeDoc = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
)

// maxDocumentXML bounds the decompressed document part (zip bomb guard).
const maxDocumentXML = 64 << 20

// ErrNotDOCX is a file that is not a Word 2007+ package (a legacy .doc
// included, which mammoth rejects as well).
var ErrNotDOCX = errors.New("extract: not a .docx file")

// DOCXText is mammoth.extractRawText: the main document's text with "\n\n"
// after every paragraph (table cells included) and "\t" for tabs. Deleted
// revisions, field codes, DrawingML shapes and equations are left out;
// mc:AlternateContent is read from its fallback; line breaks add nothing.
func DOCXText(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", ErrNotDOCX
	}
	f := findPart(zr, mainDocumentPath(zr))
	if f == nil {
		return "", ErrNotDOCX
	}
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()

	dec := xml.NewDecoder(io.LimitReader(rc, maxDocumentXML))
	var b strings.Builder
	skip := 0 // depth inside an ignored subtree
	inText := false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return b.String(), nil
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if skip > 0 || ignored(t.Name) {
				skip++
				continue
			}
			if t.Name.Space != nsWord {
				continue
			}
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				b.WriteByte('\t')
			case "noBreakHyphen":
				b.WriteString("\u2011")
			case "softHyphen":
				b.WriteString("\u00ad")
			}
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			if t.Name.Space == nsWord {
				switch t.Name.Local {
				case "t":
					inText = false
				case "p":
					b.WriteString("\n\n")
				}
			}
		case xml.CharData:
			if inText && skip == 0 {
				b.Write(t)
			}
		}
	}
}

// ignored are subtrees mammoth does not read for text.
func ignored(n xml.Name) bool {
	switch n.Space {
	case nsWord:
		switch n.Local {
		case "del", "instrText", "sdtPr", "drawing", "pPr", "rPr":
			return true
		}
	case nsMarkup:
		return n.Local == "Choice"
	case nsMath:
		return true
	}
	return false
}

// mainDocumentPath follows _rels/.rels to the officeDocument part.
func mainDocumentPath(zr *zip.Reader) string {
	const fallback = "word/document.xml"
	f := findPart(zr, "_rels/.rels")
	if f == nil {
		return fallback
	}
	rc, err := f.Open()
	if err != nil {
		return fallback
	}
	defer rc.Close()
	var rels struct {
		Rel []struct {
			Type   string `xml:"Type,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	if xml.NewDecoder(io.LimitReader(rc, 1<<20)).Decode(&rels) != nil {
		return fallback
	}
	for _, r := range rels.Rel {
		if r.Type == relTypeDoc {
			return strings.TrimPrefix(path.Clean("/"+r.Target), "/")
		}
	}
	return fallback
}

func findPart(zr *zip.Reader, name string) *zip.File {
	for _, f := range zr.File {
		if strings.EqualFold(f.Name, name) {
			return f
		}
	}
	return nil
}
