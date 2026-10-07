package domain

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// PR statuses (purchasing.purchase_requests.status).
const (
	PrDraft       = "draft"
	PrPendingHead = "pending_head"
	PrApproved    = "approved"
	PrRejected    = "rejected"
	PrConverted   = "converted"
)

// prEditorRoles may edit or revise another user's PR.
var prEditorRoles = []string{"purchasing_manager", "purchasing_admin", "super_admin", "admin"}

// CanEditPrOf: the requester or an editor role (status is checked apart).
func CanEditPrOf(requesterID, userID, role string) bool {
	return requesterID == userID || slices.Contains(prEditorRoles, role)
}

// IsAwaitingPrApproval: one approval level, only pending_head is decidable.
func IsAwaitingPrApproval(status string) bool { return status == PrPendingHead }

// IsFinalPr: approved, rejected and converted PRs cannot be decided again.
func IsFinalPr(status string) bool {
	return status == PrApproved || status == PrRejected || status == PrConverted
}

// SeesOnlyOwnPrs: hiring managers list only their own PRs.
func SeesOnlyOwnPrs(role string) bool { return role == "hiring_manager" }

// PrPermissions is the `permissions` block of the PR detail.
type PrPermissions struct {
	CanEdit     bool `json:"canEdit"`
	CanApprove  bool `json:"canApprove"`
	CanCreatePO bool `json:"canCreatePO"`
}

// BuildPrPermissions mirrors buildPrPermissions.
func BuildPrPermissions(status, requesterID string, convertedPoID *string, userID, role string, hasApprovalGrant bool) PrPermissions {
	return PrPermissions{
		CanEdit:     status == PrDraft && CanEditPrOf(requesterID, userID, role),
		CanApprove:  hasApprovalGrant && IsAwaitingPrApproval(status),
		CanCreatePO: status == PrApproved && (convertedPoID == nil || *convertedPoID == ""),
	}
}

// NextPrStatus: "submit" goes straight to the department head.
func NextPrStatus(action string) string {
	if action == "submit" {
		return PrPendingHead
	}
	return PrDraft
}

// ApprovalLevelFor is current_approval_level for a freshly written PR.
func ApprovalLevelFor(status string) *string {
	if status == PrPendingHead {
		level := "head_dept"
		return &level
	}
	return nil
}

// PrLine is one validated PR item amount.
type PrLine struct {
	Qty, EstimatedPrice, Total float64
}

// NormalizePrLine rounds qty, clamps the price and computes the line total.
func NormalizePrLine(qty, price float64) PrLine {
	q := NormalizePrQty(qty)
	p := ClampMoney(price)
	return PrLine{Qty: q, EstimatedPrice: p, Total: RoundMoney(q * p)}
}

// SumPrTotal is sumPrTotalAmount.
func SumPrTotal(lines []PrLine) float64 {
	sum := 0.0
	for _, l := range lines {
		sum += l.Total
	}
	return ClampMoney(sum)
}

// MapPrPgErrorMessage is mapPrPgErrorMessage.
func MapPrPgErrorMessage(message string) string {
	switch {
	case strings.Contains(message, "numeric field overflow"):
		return "Nilai qty atau harga estimasi terlalu besar. Periksa kembali angka pada item PR."
	case strings.Contains(message, "pr_items_satuan_id_fkey"):
		return "Satuan pada item PR tidak valid. Pilih ulang satuan bahan baku."
	case strings.Contains(message, "pr_items_raw_material_id_fkey"):
		return "Bahan baku pada item PR tidak valid."
	case strings.Contains(message, "pr_items_product_id_fkey"):
		return "Product on PR item is invalid."
	case strings.Contains(message, "pr_items_supply_item_id_fkey"):
		return "Barang operasional pada item PR tidak valid."
	case strings.Contains(message, "department_id"):
		return "Departemen tidak valid."
	case strings.Contains(message, "purchase_requests_pr_number_key"):
		return "Nomor PR bentrok, silakan coba lagi."
	}
	return message
}

// ModuleType is parsePurchasingModuleType with the raw_material fallback.
func ModuleType(v string) string {
	if v == "product" || v == "general" {
		return v
	}
	return "raw_material"
}

// DailyPrefix is getDailyPrefix: PREFIX-YYYYMMDD in the process time zone.
func DailyPrefix(prefix string, now time.Time) string {
	return fmt.Sprintf("%s-%04d%02d%02d", prefix, now.Year(), int(now.Month()), now.Day())
}

// MonthlyPrefix is the PO-YYYYMM prefix of manually created POs.
func MonthlyPrefix(prefix string, now time.Time) string {
	return fmt.Sprintf("%s-%04d%02d", prefix, now.Year(), int(now.Month()))
}

// NextDocumentNumber is `${prefix}-${pad4(seq)}` where seq follows the last
// number's trailing segment (parseInt semantics; garbage restarts at 1).
func NextDocumentNumber(prefix string, last *string) string {
	seq := 1
	if last != nil && *last != "" {
		parts := strings.Split(*last, "-")
		if n, ok := JSParseInt(parts[len(parts)-1]); ok {
			seq = n + 1
		}
	}
	return fmt.Sprintf("%s-%04d", prefix, seq)
}

// JSParseInt is parseInt(s, 10): leading whitespace and sign, then digits.
func JSParseInt(s string) (int, bool) {
	s = strings.TrimLeft(s, " \t\n\r")
	end := 0
	if end < len(s) && (s[end] == '-' || s[end] == '+') {
		end++
	}
	start := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	n, err := strconv.Atoi(s[:end])
	return n, err == nil
}

// IsUrgentPriority is isUrgentPriority (case-insensitive "urgent").
func IsUrgentPriority(priority string) bool { return strings.EqualFold(priority, "urgent") }

var npwpFormat = regexp.MustCompile(`^\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}$`)

// ValidNPWP is NPWP_FORMAT: XX.XXX.XXX.X-XXX.XXX.
func ValidNPWP(s string) bool { return npwpFormat.MatchString(s) }

// NextVendorCode is generateVendorCode: V-YYYY-NNNN after the last code's
// third segment (parseInt; garbage yields the TS "NaN" sequence).
func NextVendorCode(year int, last *string) string {
	if last == nil || *last == "" {
		return fmt.Sprintf("V-%d-0001", year)
	}
	parts := strings.Split(*last, "-")
	seg := ""
	if len(parts) > 2 {
		seg = parts[2]
	}
	n, ok := JSParseInt(seg)
	if !ok {
		return fmt.Sprintf("V-%d-0NaN", year)
	}
	return fmt.Sprintf("V-%d-%04d", year, n+1)
}
