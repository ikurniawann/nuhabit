package domain

import (
	"math"
	"strings"
)

// Journal sides, statuses and entry types.
const (
	Debit  = "DEBIT"
	Credit = "CREDIT"

	StatusDraft  = "DRAFT"
	StatusPosted = "POSTED"
	StatusVoid   = "VOID"

	EntryManual  = "MANUAL"
	EntryOpening = "OPENING"
	EntryAuto    = "AUTO"
)

// Line is one journal line to write.
type Line struct {
	AccountID string
	Side      string
	Amount    float64
	Memo      *string
	SortOrder *int
}

// Rejection is a business-rule failure with the TS status and message.
type Rejection struct {
	Status  int
	Message string
}

func (r *Rejection) Error() string { return r.Message }

func bad(msg string) *Rejection { return &Rejection{Status: 400, Message: msg} }

// ValidateBalanced is validateLines: at least two lines, both sides
// present, every amount > 0, and debit = credit after rounding to cents.
func ValidateBalanced(lines []Line) error {
	if len(lines) < 2 {
		return bad("Minimal 2 baris jurnal (debit dan credit)")
	}
	var debit, credit float64
	var hasDebit, hasCredit bool
	for _, l := range lines {
		if l.AccountID == "" {
			return bad("Setiap baris harus punya akun COA")
		}
		if l.Side != Debit && l.Side != Credit {
			return bad("entry_side harus DEBIT atau CREDIT")
		}
		if math.IsNaN(l.Amount) || math.IsInf(l.Amount, 0) || l.Amount <= 0 {
			return bad("Amount harus lebih dari 0")
		}
		if l.Side == Debit {
			debit += l.Amount
			hasDebit = true
		} else {
			credit += l.Amount
			hasCredit = true
		}
	}
	if !hasDebit || !hasCredit {
		return bad("Harus ada minimal satu baris Debit dan satu baris Credit")
	}
	if Round2(debit) != Round2(credit) {
		return bad("Jurnal tidak balance: Debit " + FormatNumber(Round2(debit)) + " ≠ Credit " + FormatNumber(Round2(credit)))
	}
	return nil
}

// NormalizeEntryType maps a stored entry_type to MANUAL/OPENING/AUTO.
func NormalizeEntryType(t string) string {
	switch t {
	case EntryOpening, EntryAuto:
		return t
	}
	return EntryManual
}

// CanEdit is the form-editable flag: only manual, non-recon drafts.
func CanEdit(status string, isRecon bool, entryType string) bool {
	return status == StatusDraft && !isRecon && entryType == EntryManual
}

// AssertMutable is the update/delete guard of a journal entry.
func AssertMutable(entryType, status string, isRecon bool) error {
	switch {
	case entryType == EntryOpening:
		return bad("Beginning balance (OPENING) dikelola lewat menu Beginning Balance")
	case entryType == EntryAuto:
		return bad("Journal entry AUTO dari modul operasional tidak bisa diubah dari sini")
	case status == StatusPosted:
		return bad("Journal entry POSTED tidak bisa diubah/dihapus")
	case isRecon:
		return bad("Journal entry dengan flag recon tidak bisa diubah/dihapus")
	}
	return nil
}

// AssertPostable is the DRAFT -> POSTED transition guard (postJournalEntry).
func AssertPostable(status string, lineCount int, totalDebit, totalCredit float64) error {
	switch {
	case status == StatusPosted:
		return bad("Journal entry sudah POSTED")
	case lineCount < 2:
		return bad("Minimal 2 baris jurnal sebelum post")
	case Round2(totalDebit) != Round2(totalCredit):
		return bad("Jurnal tidak balance")
	}
	return nil
}

// Totals sums debit and credit lines, each rounded to cents.
func Totals(sides []string, amounts []float64) (debit, credit float64) {
	for i, side := range sides {
		if side == Debit {
			debit += amounts[i]
		} else if side == Credit {
			credit += amounts[i]
		}
	}
	return Round2(debit), Round2(credit)
}

// AccountCheck is what assertPostableAccounts reads per account.
type AccountCheck struct {
	ID         string
	IsPostable bool
	CompanyID  *string
	Deleted    bool
}

// CheckPostableAccounts validates journal (or mapping) accounts: all found,
// not deleted, postable and in companyID. headerMsg differs between journal
// entries and mappings.
func CheckPostableAccounts(want int, rows []AccountCheck, companyID *string, headerMsg string) error {
	if len(rows) != want {
		return &Rejection{Status: 404, Message: "Satu atau lebih akun COA tidak ditemukan"}
	}
	for _, r := range rows {
		if r.Deleted {
			return bad("Akun COA sudah dihapus")
		}
		if !r.IsPostable {
			return bad(headerMsg)
		}
		if companyID == nil || r.CompanyID == nil || *r.CompanyID != *companyID {
			return bad("Akun COA harus dalam company yang sama")
		}
	}
	return nil
}

// UniqueIDs drops empty and duplicate ids, keeping first-seen order.
func UniqueIDs(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// NextSequenceNo is the "<prefix>NNNN" numbering: the last number's tail
// parsed as an integer plus one (parseInt semantics), padded to 4.
func NextSequenceNo(prefix, last string) string {
	seq := 1
	if last != "" {
		if n, ok := parseIntPrefix(strings.TrimPrefix(last, prefix)); ok {
			seq = n + 1
		}
	}
	return prefix + pad4(seq)
}

// parseIntPrefix is Number.parseInt(s, 10): optional sign, leading digits.
func parseIntPrefix(s string) (int, bool) {
	s = strings.TrimLeftFunc(s, IsJSSpace)
	neg := false
	if s != "" && (s[0] == '-' || s[0] == '+') {
		neg = s[0] == '-'
		s = s[1:]
	}
	n, digits := 0, 0
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
		digits++
	}
	if digits == 0 {
		return 0, false
	}
	if neg {
		n = -n
	}
	return n, true
}

func pad4(n int) string {
	s := FormatNumber(float64(n))
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
