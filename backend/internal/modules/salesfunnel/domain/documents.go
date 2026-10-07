package domain

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Helpers of lib/sales-funnel/quotation-pdf.ts and invoice-pdf.ts.

// EventTypeDocLabels is EVENT_TYPE_DOC_LABELS (title case, on documents).
var EventTypeDocLabels = map[string]string{
	"gathering": "Gathering", "field-trip": "Field Trip", "ulang-tahun": "Ulang Tahun",
	"buyout-venue": "Buyout Venue", "lainnya": "Acara",
}

// DocDate is the PDFs' tanggal(): toLocaleDateString("id-ID", {day:
// "numeric", month: "long", year: "numeric"}) in the process time zone,
// "7 November 2026".
func DocDate(t time.Time) string {
	t = t.In(time.Local)
	return strconv.Itoa(t.Day()) + " " + monthsLong[t.Month()-1] + " " + strconv.Itoa(t.Year())
}

var (
	unsafeFileChars = regexp.MustCompile(`[^a-zA-Z0-9 -]`)
	spaceRuns       = regexp.MustCompile(` +`)
)

// DocumentFileName is quotationFileName/invoiceFileName: the number, then the
// organisation in ASCII letters, digits and hyphens (fallback when none is
// left), then ".pdf".
func DocumentFileName(number, orgName, fallback string) string {
	org := strings.Trim(unsafeFileChars.ReplaceAllString(orgName, ""), " ")
	org = spaceRuns.ReplaceAllString(org, "-")
	if org == "" {
		org = fallback
	}
	return number + "-" + org + ".pdf"
}
