package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Port of frontend/src/lib/purchasing/receipt-scan.ts: OCR text of a vendor
// receipt mapped to payment form fields. Pure text heuristics; the user
// corrects whatever OCR misread.

// ReceiptFields is ReceiptFields: nil fields were not found.
type ReceiptFields struct {
	Nomor   *string  `json:"nomor"`
	Tanggal *string  `json:"tanggal"` // YYYY-MM-DD
	Total   *float64 `json:"total"`   // whole rupiah
}

// jsSpace is JavaScript's \s, which also covers Unicode spaces (Go's \s is
// ASCII only).
const jsSpace = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

var receiptMonths = map[string]int{
	"jan": 1, "januari": 1,
	"feb": 2, "februari": 2, "pebruari": 2,
	"mar": 3, "maret": 3,
	"apr": 4, "april": 4,
	"mei": 5, "may": 5,
	"jun": 6, "juni": 6,
	"jul": 7, "juli": 7,
	"agu": 8, "agustus": 8, "aug": 8,
	"sep": 9, "september": 9,
	"okt": 10, "oktober": 10, "oct": 10,
	"nov": 11, "november": 11, "nop": 11, "nopember": 11,
	"des": 12, "desember": 12, "dec": 12,
}

var (
	rpPrefix      = regexp.MustCompile(`(?i)rp`)
	notAmountChar = regexp.MustCompile(`[^\d.,]`)
	dmyDate       = regexp.MustCompile(`\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b`)
	ymdDate       = regexp.MustCompile(`\b(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})\b`)
	namedDate     = regexp.MustCompile(`\b(\d{1,2})` + jsSpace + `+([a-zA-Z]{3,9})\.?` + jsSpace + `+(\d{2,4})\b`)
	receiptNumber = regexp.MustCompile(`(?i:no(?:mor)?|invoice|faktur|nota|struk|ref(?:erensi)?|inv)` + jsSpace + `*[.:#]?` + jsSpace +
		`*((?:[A-Za-z0-9][A-Za-z0-9/\-.]*)?\d[A-Za-z0-9/\-.]*)`)
	trailingDots  = regexp.MustCompile(`[.:]+$`)
	pureDate      = regexp.MustCompile(`^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$`)
	totalKeywords = regexp.MustCompile(`(?i)\b(?:grand` + jsSpace + `*total|total(?:` + jsSpace + `*(?:tagihan|bayar|belanja|akhir|harga))?|jumlah(?:` +
		jsSpace + `*(?:bayar|tagihan))?|tagihan)\b`)
	lineAmounts = regexp.MustCompile(`(?i)(?:rp` + jsSpace + `*)?\d[\d.,]*`)
	lineBreaks  = regexp.MustCompile(`\n+`)
)

// JSTrim is String.prototype.trim.
func JSTrim(s string) string { return jsTrim(s) }

func validReceiptDate(y, m, d int) *string {
	if y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31 {
		return nil
	}
	t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	if int(t.Month()) != m || t.Day() != d {
		return nil
	}
	out := t.Format("2006-01-02")
	return &out
}

// ParseAmount is parseAmount: "Rp 1.234.567", "1,234,567.00",
// "Rp1.234.567,50". A last separator followed by one or two digits is the
// decimal point; the others group thousands.
func ParseAmount(raw string) *float64 {
	cleaned := notAmountChar.ReplaceAllString(rpPrefix.ReplaceAllString(raw, ""), "")
	if !strings.ContainsAny(cleaned, "0123456789") {
		return nil
	}
	normalized := cleaned
	if sep := max(strings.LastIndex(cleaned, "."), strings.LastIndex(cleaned, ",")); sep != -1 {
		after := len(cleaned) - sep - 1
		integer, decimal := cleaned, ""
		if after > 0 && after <= 2 {
			integer, decimal = cleaned[:sep], cleaned[sep+1:]
		}
		normalized = strings.NewReplacer(".", "", ",", "").Replace(integer)
		if decimal != "" {
			normalized += "." + decimal
		}
	}
	value, err := strconv.ParseFloat(normalized, 64)
	if err != nil || math.IsInf(value, 0) || value <= 0 {
		return nil
	}
	rounded := math.Floor(value + 0.5)
	return &rounded
}

// FindDate is findDate: dd/mm/yyyy (or mm/dd when dd/mm is invalid),
// yyyy-mm-dd, then "12 Juli 2026".
func FindDate(text string) *string {
	if m := dmyDate.FindStringSubmatch(text); m != nil {
		d, mo, y := atoi(m[1]), atoi(m[2]), atoi(m[3])
		if y < 100 {
			y += 2000
		}
		if parsed := validReceiptDate(y, mo, d); parsed != nil {
			return parsed
		}
		if parsed := validReceiptDate(y, d, mo); parsed != nil {
			return parsed
		}
	}
	if m := ymdDate.FindStringSubmatch(text); m != nil {
		if parsed := validReceiptDate(atoi(m[1]), atoi(m[2]), atoi(m[3])); parsed != nil {
			return parsed
		}
	}
	if m := namedDate.FindStringSubmatch(text); m != nil {
		y := atoi(m[3])
		if y < 100 {
			y += 2000
		}
		if month := receiptMonths[strings.ToLower(m[2])]; month != 0 {
			if parsed := validReceiptDate(y, month, atoi(m[1])); parsed != nil {
				return parsed
			}
		}
	}
	return nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// FindNumber is findNumber: the first labelled number (No/Nomor/Invoice/
// Faktur/Nota/Struk/Ref) of 3 to 40 characters that is not a bare date.
// Every candidate is tried, since a letterhead "Jl. Merdeka No. 12" comes
// first.
func FindNumber(text string) *string {
	for _, m := range receiptNumber.FindAllStringSubmatch(text, -1) {
		value := jsTrim(trailingDots.ReplaceAllString(m[1], ""))
		if pureDate.MatchString(value) {
			continue
		}
		if len(value) >= 3 && len(value) <= 40 {
			upper := strings.ToUpper(value)
			return &upper
		}
	}
	return nil
}

// FindTotal is findTotal: on every line with a total keyword take the
// rightmost amount, and keep the largest (grand total beats subtotal).
func FindTotal(text string) *float64 {
	var best *float64
	for _, line := range lineBreaks.Split(text, -1) {
		if !totalKeywords.MatchString(line) {
			continue
		}
		numbers := lineAmounts.FindAllString(line, -1)
		if len(numbers) == 0 {
			continue
		}
		if v := ParseAmount(numbers[len(numbers)-1]); v != nil && (best == nil || *v > *best) {
			best = v
		}
	}
	return best
}

// ParseReceiptText is parseReceiptText.
func ParseReceiptText(text string) ReceiptFields {
	source := jsTrim(text)
	if source == "" {
		return ReceiptFields{}
	}
	return ReceiptFields{Nomor: FindNumber(source), Tanggal: FindDate(source), Total: FindTotal(source)}
}
