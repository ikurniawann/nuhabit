package domain

import (
	"math"
	"strings"
	"unicode/utf16"
)

// UrgentPrItem is one PR line in the owner alert.
type UrgentPrItem struct {
	Description string
	Qty         float64
	Unit        *string
}

// UrgentPr is buildPrMendesakMessage's input.
type UrgentPr struct {
	PrNumber, Status, RequesterName string
	DepartmentName                  *string
	TotalAmount                     float64
	RequiredDate, Notes             *string
	Items                           []UrgentPrItem
}

// sliceUTF16 is String.prototype.slice(0, n).
func sliceUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// formatRp is `Rp${Math.round(n).toLocaleString("id-ID")}`.
func formatRp(n float64) string { return "Rp" + FormatNumberID(JSRound(n), 0) }

// BuildPrMendesakMessage is buildPrMendesakMessage (lib/wa/notifications-messages).
func BuildPrMendesakMessage(in UrgentPr) string {
	submitted := in.Status != "draft"
	state, action := "dibuat (draft)", "meninjau"
	if submitted {
		state, action = "diajukan, menunggu persetujuan", "menyetujui"
	}
	requester := "Pemohon: " + in.RequesterName
	if in.DepartmentName != nil && *in.DepartmentName != "" {
		requester += " · " + *in.DepartmentName
	}
	required := "-"
	if in.RequiredDate != nil {
		required = *in.RequiredDate
	}
	lines := []string{"🔴 *Purchase Request MENDESAK*", "", in.PrNumber + " " + state + ".", requester,
		"Total estimasi: *" + formatRp(in.TotalAmount) + "*", "Dibutuhkan: " + required}
	if in.Notes != nil && *in.Notes != "" {
		lines = append(lines, "Catatan: "+sliceUTF16(*in.Notes, 200))
	}
	lines = append(lines, "")
	for i, it := range in.Items {
		if i == 5 {
			break
		}
		unit := ""
		if it.Unit != nil {
			unit = *it.Unit
		}
		line := "• " + sliceUTF16(it.Description, 60) + " — " + FormatNumberID(math.Round(it.Qty*1000)/1000, 3) + " " + unit
		lines = append(lines, strings.TrimRightFunc(line, func(r rune) bool { return r == ' ' || r == '\t' || r == '\n' }))
	}
	if len(in.Items) > 5 {
		lines = append(lines, "• …dan "+itoa(len(in.Items)-5)+" item lain")
	}
	return strings.Join(append(lines, "", "Buka Purchasing → Purchase Request untuk "+action+"."), "\n")
}

func itoa(n int) string { return FormatNumberID(float64(n), 0) }
