package domain

import (
	"math"
	"strings"
)

// Journal mapping enums (journal-mapping-types.ts).
var (
	JournalModules       = []string{"POS", "PURCHASING", "PAYROLL", "PINJAMAN", "SALES", "INVENTORY"}
	JournalSides         = []string{Debit, Credit}
	JournalAmountSources = []string{"TOTAL", "SUBTOTAL", "TAX", "COGS", "PAID", "DISCOUNT", "SERVICE_CHARGE"}
)

// EventNames is JOURNAL_EVENT_META: the default name and description of
// each journal event code.
var EventNames = map[string][2]string{
	"POS_SALE_CASH":             {"POS Sale — Cash", "Penjualan POS dibayar tunai"},
	"POS_SALE_QRIS":             {"POS Sale — QRIS", "Penjualan POS dibayar QRIS"},
	"POS_SALE_DEBIT":            {"POS Sale — Debit", "Penjualan POS kartu debit"},
	"POS_SALE_CREDIT":           {"POS Sale — Credit", "Penjualan POS kartu kredit"},
	"POS_SALE_ARK_COIN":         {"POS Sale — ARK Coin", "Penjualan POS pakai ARK Coin"},
	"POS_SALE_GIFT_CARD":        {"POS Sale — Gift Card", "Penjualan POS pakai gift card"},
	"POS_SALE_MEMBER_BILL":      {"POS Sale — Tagihan Member", "Order member ditutup dari saldo cicilan (Uang Muka Member ↔ Penjualan)"},
	"POS_MEMBER_DEPOSIT_CASH":   {"Tagihan Member — Cicilan Tunai", "Cicilan tagihan member diterima tunai (Kas ↔ Uang Muka Member)"},
	"POS_MEMBER_DEPOSIT_QRIS":   {"Tagihan Member — Cicilan QRIS", "Cicilan tagihan member via QRIS (Bank ↔ Uang Muka Member)"},
	"POS_MEMBER_DEPOSIT_CARD":   {"Tagihan Member — Cicilan Kartu/Transfer", "Cicilan tagihan member via kartu / non-tunai (Bank ↔ Uang Muka Member)"},
	"POS_COGS_RELIEF":           {"POS COGS Relief", "Pemakaian HPP / relief inventory saat penjualan"},
	"POS_REFUND":                {"POS Refund", "Pengembalian penjualan POS"},
	"PURCHASE_GRN":              {"Purchase GRN", "Penerimaan barang (GRN) ke inventory"},
	"PURCHASE_AP_INVOICE":       {"Purchase AP Invoice", "Invoice hutang vendor"},
	"PURCHASE_PAYMENT":          {"Purchase Payment", "Pembayaran hutang vendor"},
	"PURCHASE_RETURN":           {"Purchase Return", "Retur pembelian ke vendor"},
	"PAYROLL_ACCRUAL":           {"Payroll Accrual", "Pengakuan beban gaji (expense) dan hutang gaji"},
	"PAYROLL_PAYMENT":           {"Payroll Payment", "Pembayaran gaji bersih ke karyawan via bank/kas"},
	"PAYROLL_PPH21_WITHHOLDING": {"Payroll PPh 21 Withholding", "Potongan PPh 21 dari payroll"},
	"PAYROLL_LOAN_DEDUCTION":    {"Payroll Loan Deduction", "Potongan cicilan pinjaman lewat payroll"},
	"PAYROLL_BPJS_TK_EMPLOYER":  {"Payroll BPJS Ketenagakerjaan (Pemberi Kerja)", "Iuran BPJS Ketenagakerjaan bagian perusahaan (beban dan hutang BPJS)"},
	"PAYROLL_BPJS_KES_EMPLOYER": {"Payroll BPJS Kesehatan (Pemberi Kerja)", "Iuran BPJS Kesehatan bagian perusahaan (beban dan hutang BPJS)"},
	"PINJAMAN_DISBURSEMENT":     {"Pinjaman — Pencairan", "Pencairan pinjaman karyawan ke rekening/kas"},
	"PINJAMAN_REPAYMENT":        {"Pinjaman — Pelunasan/Cicilan", "Cicilan atau pelunasan pinjaman di luar payroll"},
	"SALE_AR_INVOICE":           {"Sale AR Invoice", "Pengakuan piutang dari invoice B2B / sales"},
	"SALE_AR_RECEIPT":           {"Sale AR Receipt", "Penerimaan pembayaran piutang customer"},
	"STOCK_OPNAME_SHORTAGE":     {"Stock Opname — Shortage", "Selisih opname kurang (spoil/waste vs inventori)"},
	"STOCK_OPNAME_SURPLUS":      {"Stock Opname — Surplus", "Selisih opname lebih (inventori vs koreksi spoil)"},
	"STOCK_ADJUSTMENT_SHORTAGE": {"Stock Adjustment — Shortage", "Penyesuaian stok kurang"},
	"STOCK_ADJUSTMENT_SURPLUS":  {"Stock Adjustment — Surplus", "Penyesuaian stok lebih"},
	"STOCK_TRANSFER":            {"Stock Transfer", "Transfer stok antar gudang (audit nilai inventori)"},
}

// Amounts is a JournalAmountBag: amount source -> value. A missing key is 0.
type Amounts map[string]float64

// AmountFromSource is resolveAmountFromSource: non-positive or non-finite
// values are 0, the rest rounded to cents.
func AmountFromSource(source string, amounts Amounts) float64 {
	v := amounts[source]
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return 0
	}
	return Round2(v)
}

// MappingLine is one template line of a journal mapping.
type MappingLine struct {
	Side         string
	AccountID    *string
	AmountSource string
	SortOrder    int
	IsRequired   bool
	LineRole     string
}

// HasRequiredAccounts is mappingHasRequiredAccounts.
func HasRequiredAccounts(lines []MappingLine) bool {
	for _, l := range lines {
		if l.IsRequired && (l.AccountID == nil || *l.AccountID == "") {
			return false
		}
	}
	return true
}

// BuildFromMapping is buildJournalLinesFromMapping: the journal lines a
// mapping produces for an amount bag, or the reason it is not ready.
func BuildFromMapping(lines []MappingLine, amounts Amounts, memo *string) ([]Line, string) {
	if !HasRequiredAccounts(lines) {
		return nil, "Journal mapping belum lengkap (akun COA wajib belum diisi)"
	}
	out := []Line{}
	for _, l := range lines {
		amount := AmountFromSource(l.AmountSource, amounts)
		if amount <= 0 {
			if l.IsRequired {
				return nil, "Amount source " + l.AmountSource + " untuk role " + l.LineRole + " bernilai 0"
			}
			continue
		}
		// An optional role (DISCOUNT/TAX/SC) with a value but no account would
		// unbalance the journal, so it is not skipped silently.
		if l.AccountID == nil || *l.AccountID == "" {
			return nil, "Akun COA untuk role " + l.LineRole + " belum diisi (nilai " + l.AmountSource + "=" + FormatNumber(amount) + ")"
		}
		sort := l.SortOrder
		out = append(out, Line{AccountID: *l.AccountID, Side: l.Side, Amount: amount, Memo: memo, SortOrder: &sort})
	}
	if len(out) < 2 {
		return nil, "Baris jurnal dari mapping kurang dari 2 setelah amount dihitung"
	}
	return out, ""
}

// Post result statuses.
const (
	PostPosted  = "posted"
	PostDraft   = "draft"
	PostSkipped = "skipped"
)

// AlreadyExists is the reason of an idempotent repeat post.
const AlreadyExists = "already_exists"

// PostResult is MappingPostResult.
type PostResult struct {
	Status  string `json:"status"`
	EntryID string `json:"entryId,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// Summarize is summarizeResults: the human note appended to a response
// message, "" when there is nothing to say.
func Summarize(results ...PostResult) string {
	var notes []string
	seen := map[string]bool{}
	add := func(n string) {
		if !seen[n] {
			seen[n] = true
			notes = append(notes, n)
		}
	}
	for _, r := range results {
		switch {
		case r.Status == PostPosted:
			add("jurnal posted")
		case r.Status == PostDraft:
			add("jurnal draft: " + orDefault(r.Reason, "mapping belum lengkap"))
		case r.Status == PostSkipped && r.Reason != AlreadyExists:
			add("jurnal dilewati: " + orDefault(r.Reason, "tidak ada mapping"))
		}
	}
	return strings.Join(notes, "; ")
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// ReverseLines flips every side for a reversing journal (AP payment void).
func ReverseLines(sides []string) []string {
	out := make([]string, len(sides))
	for i, s := range sides {
		if s == Debit {
			out[i] = Credit
		} else {
			out[i] = Debit
		}
	}
	return out
}
