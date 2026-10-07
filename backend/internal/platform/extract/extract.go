// Package extract pulls plain text out of uploaded files the way the TS
// helpers do (lib/attachments/extract.ts, lib/recruitment/cv-extract.ts):
// PDF like unpdf, DOCX like mammoth.extractRawText, spreadsheets as CSV per
// sheet like exceljs-safe, images through OCR. Pure Go: no cgo.
package extract

import (
	"context"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"nuhabit/backend/internal/platform/xlsx"
)

// Method says how the text was obtained.
type Method string

const (
	MethodPDF         Method = "pdf"
	MethodOCR         Method = "ocr"
	MethodDOCX        Method = "docx"
	MethodSpreadsheet Method = "spreadsheet"
	MethodText        Method = "text"
)

const (
	// MaxChars is MAX_EXTRACT_CHARS, in UTF-16 units like String.length.
	MaxChars = 20_000
	// MaxAttachmentBytes is MAX_ATTACHMENT_BYTES.
	MaxAttachmentBytes = 10 * 1024 * 1024
	// scannedPDFChars is the threshold below which a PDF counts as a scan.
	scannedPDFChars = 40
)

// OCR recognizes text in an image (ocr.Tesseract). ext is the file's
// extension with the dot, used for the temporary file.
type OCR interface {
	Recognize(ctx context.Context, data []byte, ext string) (string, error)
}

// ErrNoText is the TS message when nothing readable came out.
var ErrNoText = errors.New("Tidak ada teks yang bisa dibaca dari file ini")

var (
	imageExt = []string{".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
	sheetExt = []string{".xlsx", ".xls", ".xlsm"}
	textExt  = []string{".csv", ".txt", ".md", ".log", ".tsv"}
)

func has(list []string, ext string) bool {
	for _, e := range list {
		if e == ext {
			return true
		}
	}
	return false
}

// IsSupportedAttachment is isSupportedAttachment.
func IsSupportedAttachment(fileName string) bool {
	ext := strings.ToLower(filepath.Ext(fileName))
	return ext == ".pdf" || ext == ".docx" || ext == ".doc" || has(imageExt, ext) || has(sheetExt, ext) || has(textExt, ext)
}

// Result is ExtractResult.
type Result struct {
	Text      string `json:"text"`
	Method    Method `json:"method"`
	Truncated bool   `json:"truncated"`
}

// Attachment is extractAttachmentText: text by extension, a PDF with under
// 40 characters falls back to OCR (keeping the PDF text if OCR fails),
// cleaned and cut to MaxChars. ocr may be nil when OCR is unavailable; an
// image then fails with the OCR error.
func Attachment(ctx context.Context, data []byte, fileName string, ocr OCR) (Result, error) {
	ext := strings.ToLower(filepath.Ext(fileName))
	var raw string
	var method Method
	var err error
	switch {
	case ext == ".pdf":
		raw, method, err = pdfWithOCRFallback(ctx, data, ocr)
	case ext == ".docx" || ext == ".doc":
		raw, err = DOCXText(data)
		method = MethodDOCX
	case has(imageExt, ext):
		raw, err = recognize(ctx, ocr, data, ext)
		method = MethodOCR
	case has(sheetExt, ext):
		raw, err = SpreadsheetText(data)
		method = MethodSpreadsheet
	case has(textExt, ext):
		raw = strings.ToValidUTF8(string(data), "\ufffd")
		method = MethodText
	default:
		if ext == "" {
			ext = "tanpa ekstensi"
		}
		return Result{}, errors.New("Format tidak didukung: " + ext)
	}
	if err != nil {
		return Result{}, err
	}
	cleaned := Clean(raw)
	if cleaned == "" {
		return Result{}, ErrNoText
	}
	text, truncated := truncateUTF16(cleaned, MaxChars)
	return Result{Text: text, Method: method, Truncated: truncated}, nil
}

// CV is extractCvText after the file is read from storage: PDF (OCR when
// scanned), DOC/DOCX, JPG/PNG through OCR; other formats are rejected.
func CV(ctx context.Context, data []byte, fileName string, ocr OCR) (string, Method, error) {
	ext := strings.ToLower(filepath.Ext(fileName))
	var text string
	var method Method
	var err error
	switch ext {
	case ".pdf":
		text, method, err = pdfWithOCRFallback(ctx, data, ocr)
	case ".docx", ".doc":
		text, err = DOCXText(data)
		method = MethodDOCX
	case ".jpg", ".jpeg", ".png":
		text, err = recognize(ctx, ocr, data, ext)
		method = MethodOCR
	default:
		return "", "", errors.New("Format CV tidak didukung untuk ekstraksi: " + ext)
	}
	if err != nil {
		return "", "", err
	}
	cleaned := Clean(text)
	if cleaned == "" {
		return "", "", errors.New("Tidak ada teks yang bisa diekstrak dari CV")
	}
	return cleaned, method, nil
}

func pdfWithOCRFallback(ctx context.Context, data []byte, ocr OCR) (string, Method, error) {
	text, err := PDFText(data)
	if err != nil {
		return "", "", err
	}
	if len([]rune(strings.TrimSpace(text))) >= scannedPDFChars {
		return text, MethodPDF, nil
	}
	if ocrText, err := recognize(ctx, ocr, data, ".pdf"); err == nil {
		return ocrText, MethodOCR, nil
	}
	return text, MethodPDF, nil
}

func recognize(ctx context.Context, ocr OCR, data []byte, ext string) (string, error) {
	if ocr == nil {
		return "", errors.New("OCR tidak tersedia")
	}
	return ocr.Recognize(ctx, data, ext)
}

// SpreadsheetText renders every sheet as "### Sheet: <name>\n<csv>",
// sheets separated by a blank line.
func SpreadsheetText(data []byte) (string, error) {
	parts, err := xlsx.ParseCSVParts(data, xlsx.Limits{})
	if err != nil {
		return "", err
	}
	out := make([]string, len(parts))
	for i, p := range parts {
		out[i] = "### Sheet: " + p.Name + "\n" + p.CSV
	}
	return strings.Join(out, "\n\n"), nil
}

var (
	trailingBlanks = regexp.MustCompile(`[ \t]+\n`)
	manyNewlines   = regexp.MustCompile(`\n{3,}`)
)

// Clean is cleanText: drop CR, trailing spaces on lines, runs of blank
// lines, then trim.
func Clean(raw string) string {
	s := strings.ReplaceAll(raw, "\r", "")
	s = trailingBlanks.ReplaceAllString(s, "\n")
	s = manyNewlines.ReplaceAllString(s, "\n\n")
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' })
}

// truncateUTF16 is s.slice(0, n) on a JavaScript string.
func truncateUTF16(s string, n int) (string, bool) {
	units := 0
	for i, r := range s {
		w := 1
		if r > 0xffff {
			w = 2
		}
		if units+w > n {
			return s[:i], true
		}
		units += w
	}
	return s, false
}
