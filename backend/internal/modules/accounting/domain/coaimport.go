package domain

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/xlsx"
)

// Chart-of-accounts import from Excel: lib/accounting/coa-spreadsheet.ts
// (parsing), coa-types.ts (heuristics), account-code.ts (parents) and the
// pure half of coa-import.ts (preview and summary).

// CoaRow is ParsedCoaRow.
type CoaRow struct {
	Code             string
	Name             string
	ParentCode       *string
	AccountTypeCode  string
	Level            int
	IsContra         bool
	IsCashBank       bool
	CashFlowCategory *string
	Description      *string
	SourceRow        int
}

// CoaIssue is CoaParseIssue.
type CoaIssue struct {
	Row     int    `json:"row"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

// CashFlowCategories is CASH_FLOW_CATEGORIES.
var CashFlowCategories = []string{"OPERATING", "INVESTING", "FINANCING", "NON_CASH"}

// ParseCoaSpreadsheet is parseCoaSpreadsheet: the sheet named COA (any
// case) or the first one, read as the SULU layout or the standard one.
func ParseCoaSpreadsheet(data []byte) ([]CoaRow, []CoaIssue, error) {
	matrix, err := xlsx.ParseMatrix(data, xlsx.ReadOptions{PreferSheet: "coa"})
	if err != nil {
		return nil, nil, err
	}
	if len(matrix) == 0 {
		return nil, []CoaIssue{{Row: 0, Message: "Workbook tidak punya sheet"}}, nil
	}
	if isSuluCoaLayout(matrix) {
		rows, issues := parseSuluCoaSheet(matrix)
		return rows, issues, nil
	}
	rows, issues := parseStandardCoaSheet(matrix)
	return rows, issues, nil
}

func cellAt(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimFunc(row[i], IsJSSpace)
}

var codeHeader = regexp.MustCompile(`(?i)^(code$|kode)`)

// isSuluCoaLayout: the first cell is an account code, not a "code" header.
func isSuluCoaLayout(rows [][]string) bool {
	if len(rows) < 2 {
		return false
	}
	first := cellAt(rows[0], 0)
	if codeHeader.MatchString(first) {
		return false
	}
	return NormalizeAccountCode(first) != ""
}

var roundingGain = regexp.MustCompile(`(?i)rounding gain`)

func parseSuluCoaSheet(rows [][]string) ([]CoaRow, []CoaIssue) {
	issues := []CoaIssue{}
	type staged struct {
		code, name string
		sourceRow  int
	}
	var stage []staged
	seen := map[string]int{}

	for idx, row := range rows {
		sourceRow := idx + 1
		rawCode := cellAt(row, 0)
		if rawCode == "" {
			continue
		}
		code := NormalizeAccountCode(rawCode)
		if code == "" {
			issues = append(issues, CoaIssue{Row: sourceRow, Message: "Kode tidak valid: " + rawCode})
			continue
		}
		name := ""
		for c := 1; c <= 6 && name == ""; c++ {
			name = cellAt(row, c)
		}
		if name == "" {
			issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "Nama kosong — baris dilewati"})
			continue
		}
		// The SULU workbook lists Rounding Gain under Rounding Loss's code.
		if code == "8301001" && roundingGain.MatchString(name) {
			code = "8201003"
		}
		if first, dup := seen[code]; dup {
			issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "Kode duplikat (sudah di baris " + strconv.Itoa(first) + ")"})
			continue
		}
		seen[code] = sourceRow
		stage = append(stage, staged{code, name, sourceRow})
	}

	out := make([]CoaRow, len(stage))
	for i, r := range stage {
		level := InferAccountLevel(r.code)
		out[i] = CoaRow{
			Code: r.code, Name: r.name, ParentCode: resolveParentCode(r.code, seen),
			AccountTypeCode: InferAccountTypeCode(r.code), Level: level,
			IsContra: InferIsContra(r.name), IsCashBank: InferIsCashBank(r.name, r.code, level),
			CashFlowCategory: InferCashFlowCategory(r.code, r.name, level), SourceRow: r.sourceRow,
		}
	}
	return out, issues
}

var normalizeCoaHeader = xlsx.HeaderNormalizer(map[string]string{
	"account_code":      "code",
	"kode":              "code",
	"kode_akun":         "code",
	"account_name":      "name",
	"nama":              "name",
	"nama_akun":         "name",
	"parent":            "parent_code",
	"parent_account":    "parent_code",
	"parent_kode":       "parent_code",
	"account_type":      "account_type_code",
	"type":              "account_type_code",
	"tipe":              "account_type_code",
	"contra":            "is_contra",
	"is_contra_account": "is_contra",
	"cash_bank":         "is_cash_bank",
	"is_cash":           "is_cash_bank",
	"is_bank":           "is_cash_bank",
	"kas_bank":          "is_cash_bank",
	"cashflow":          "cash_flow_category",
	"cash_flow":         "cash_flow_category",
	"deskripsi":         "description",
})

// parseBool is parseBool in coa-spreadsheet.ts.
func parseBool(v string, fallback bool) bool {
	switch strings.ToLower(v) {
	case "1", "true", "yes", "y", "ya":
		return true
	case "0", "false", "no", "n", "tidak":
		return false
	}
	return fallback
}

func parseStandardCoaSheet(matrix [][]string) ([]CoaRow, []CoaIssue) {
	issues := []CoaIssue{}
	if len(matrix) < 2 {
		return nil, []CoaIssue{{Row: 1, Message: "File kosong / tanpa data"}}
	}
	headers := make([]string, len(matrix[0]))
	for i := range headers {
		headers[i] = normalizeCoaHeader(cellAt(matrix[0], i))
	}
	col := func(key string) int { return slices.Index(headers, key) }
	codeIdx, nameIdx := col("code"), col("name")
	if codeIdx < 0 || nameIdx < 0 {
		return nil, []CoaIssue{{Row: 1, Message: "Header wajib: code, name"}}
	}
	parentIdx, typeIdx, contraIdx := col("parent_code"), col("account_type_code"), col("is_contra")
	cashBankIdx, cfIdx, descIdx := col("is_cash_bank"), col("cash_flow_category"), col("description")

	var out []CoaRow
	seen := map[string]int{}
	for i := 1; i < len(matrix); i++ {
		row := matrix[i]
		sourceRow := i + 1
		rawCode, name := cellAt(row, codeIdx), cellAt(row, nameIdx)
		if rawCode == "" && name == "" {
			continue
		}
		code := NormalizeAccountCode(rawCode)
		if code == "" {
			issues = append(issues, CoaIssue{Row: sourceRow, Message: "Kode tidak valid: " + rawCode})
			continue
		}
		if name == "" {
			issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "Nama wajib diisi"})
			continue
		}
		if first, dup := seen[code]; dup {
			issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "Kode duplikat (baris " + strconv.Itoa(first) + ")"})
			continue
		}
		seen[code] = sourceRow

		level := InferAccountLevel(code)
		if level == 0 {
			issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "Level kode tidak dikenali"})
			continue
		}

		accountType := strings.ToUpper(cellAt(row, typeIdx))
		if accountType == "" {
			accountType = InferAccountTypeCode(code)
		}

		var cashFlow *string
		if cf := strings.ToUpper(cellAt(row, cfIdx)); cf != "" {
			if !slices.Contains(CashFlowCategories, cf) {
				issues = append(issues, CoaIssue{Row: sourceRow, Code: code, Message: "cash_flow_category tidak valid: " + cf})
				continue
			}
			cashFlow = &cf
		} else {
			cashFlow = InferCashFlowCategory(code, name, level)
		}

		var parent *string
		if raw := cellAt(row, parentIdx); raw != "" {
			// normalizeAccountCode(parentRaw): an unrecognised parent reads as none.
			if p := NormalizeAccountCode(raw); p != "" {
				parent = &p
			}
		}

		isContra := InferIsContra(name)
		if contraIdx >= 0 {
			isContra = parseBool(cellAt(row, contraIdx), isContra)
		}
		isCashBank := InferIsCashBank(name, code, level)
		if cashBankIdx >= 0 {
			isCashBank = parseBool(cellAt(row, cashBankIdx), isCashBank)
		}
		var desc *string
		if d := cellAt(row, descIdx); d != "" {
			desc = &d
		}

		out = append(out, CoaRow{
			Code: code, Name: name, ParentCode: parent, AccountTypeCode: accountType, Level: level,
			IsContra: isContra, IsCashBank: isCashBank, CashFlowCategory: cashFlow, Description: desc, SourceRow: sourceRow,
		})
	}

	// Rows without a parent take the nearest ancestor among the kept rows; an
	// explicit parent may live in the database, which the preview checks.
	kept := make(map[string]int, len(out))
	for _, r := range out {
		kept[r.Code] = r.SourceRow
	}
	for i := range out {
		if out[i].ParentCode == nil {
			out[i].ParentCode = resolveParentCode(out[i].Code, kept)
		}
	}
	return out, issues
}

/* ── Hierarchy (account-code.ts) ─────────────────────────────────────── */

// idealParentCode is the code one level up, "" for a level-1 code.
func idealParentCode(code string) string {
	p, ok := parseAccountCode(code)
	if !ok {
		return ""
	}
	switch InferAccountLevel(code) {
	case 2:
		return p.class + "000000"
	case 3:
		return p.class + p.group + "00000"
	case 4:
		return p.class + p.group + p.sub + "000"
	}
	return ""
}

// resolveParentCode walks up the ideal parents until one is in codes.
func resolveParentCode(code string, codes map[string]int) *string {
	for parent := idealParentCode(code); parent != ""; parent = idealParentCode(parent) {
		if _, ok := codes[parent]; ok {
			return &parent
		}
	}
	return nil
}

/* ── Heuristics (coa-types.ts) ───────────────────────────────────────── */

// InferAccountTypeCode maps the class digit to an account type; class 8
// splits on the second digit (82 is non-operating income).
func InferAccountTypeCode(code string) string {
	if code == "" {
		return "EXPENSE"
	}
	switch code[0] {
	case '1':
		return "ASSET"
	case '2':
		return "LIABILITY"
	case '3':
		return "EQUITY"
	case '4':
		return "REVENUE"
	case '5':
		return "COGS"
	case '8':
		if len(code) >= 2 && code[1] == '2' {
			return "OTHER_INCOME"
		}
		return "OTHER_EXPENSE"
	}
	return "EXPENSE"
}

var (
	depreciationAny = regexp.MustCompile(`(?i)DEPRECIATION`)
	nonCashName     = regexp.MustCompile(`DEPRECIATION|\bDE\b`)
)

// InferCashFlowCategory is the cash-flow heuristic from code and name;
// headers (level < 4) get none unless they are depreciation.
func InferCashFlowCategory(code, name string, level int) *string {
	if level < 4 && !depreciationAny.MatchString(name) {
		return nil
	}
	cat := func(s string) *string { return &s }
	has := func(prefixes ...string) bool {
		for _, p := range prefixes {
			if strings.HasPrefix(code, p) {
				return true
			}
		}
		return false
	}
	switch {
	case nonCashName.MatchString(strings.ToUpper(name)) || has("81"):
		return cat("NON_CASH")
	case has("11", "12", "13", "21"):
		return cat("OPERATING")
	case has("16", "17"):
		return cat("INVESTING")
	case has("22", "3"):
		return cat("FINANCING")
	case has("4", "5", "6", "82", "83"):
		return cat("OPERATING")
	}
	return nil
}

var contraName = regexp.MustCompile(`(?i)ACCUMULAT|ALLOWANCE FOR|CONTRA`)

// InferIsContra flags accumulated depreciation, allowances and contra accounts.
func InferIsContra(name string) bool { return contraName.MatchString(name) }

var (
	cashBankCode    = regexp.MustCompile(`^110[12]`)
	notCashBankName = regexp.MustCompile(`(?i)LOAN|INTEREST|CHARGE|MDR|RECEIVABLE|\bAR\b|TAX|PPH|COMMISION|COMMISSION`)
	cashBankName    = regexp.MustCompile(`(?i)\bCASH\b|\bBANK\b|PETTY\s*CASH|\bGIRO\b|\bREKENING\b|\bKAS\b`)
)

// InferIsCashBank is inferIsCashBank with a known level: leaf 1101xxx and
// 1102xxx accounts, else a cash or bank name that is not a loan, fee or tax.
func InferIsCashBank(name, code string, level int) bool {
	if cashBankCode.MatchString(code) {
		return level == 4
	}
	if notCashBankName.MatchString(name) {
		return false
	}
	return cashBankName.MatchString(name)
}

/* ── Preview (coa-import.ts) ─────────────────────────────────────────── */

// CoaPreviewRow is one classified import row.
type CoaPreviewRow struct {
	SourceRow       int     `json:"source_row"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	ParentCode      *string `json:"parent_code"`
	AccountTypeCode string  `json:"account_type_code"`
	Action          string  `json:"action"`
	Message         string  `json:"message,omitempty"`
}

// ExistingAccount is a live account of the company, by code.
type ExistingAccount struct{ ID, Name string }

// BuildCoaImportPreview is buildCoaImportPreview: create, update, skip or
// error per row against the company's chart. typeIDs is keyed by the
// upper-cased account type code.
func BuildCoaImportPreview(parsed []CoaRow, typeIDs map[string]string, existing map[string]ExistingAccount) []CoaPreviewRow {
	importCodes := make(map[string]bool, len(parsed))
	for _, r := range parsed {
		importCodes[r.Code] = true
	}
	out := make([]CoaPreviewRow, len(parsed))
	for i, r := range parsed {
		p := CoaPreviewRow{SourceRow: r.SourceRow, Code: r.Code, Name: r.Name, ParentCode: r.ParentCode, AccountTypeCode: r.AccountTypeCode}
		ex, found := existing[r.Code]
		switch {
		case typeIDs[r.AccountTypeCode] == "":
			p.Action, p.Message = "error", "Account type "+r.AccountTypeCode+" tidak ditemukan"
		case r.ParentCode != nil && !importCodes[*r.ParentCode] && !hasAccount(existing, *r.ParentCode):
			p.Action, p.Message = "error", "Parent "+*r.ParentCode+" tidak ditemukan"
		case !found:
			p.Action = "create"
		case ex.Name == r.Name:
			p.Action, p.Message = "skip", "Tidak berubah"
		default:
			p.Action = "update"
		}
		out[i] = p
	}
	return out
}

func hasAccount(m map[string]ExistingAccount, code string) bool {
	_, ok := m[code]
	return ok
}

// CoaImportSummary counts the preview actions.
type CoaImportSummary struct {
	Create int `json:"create"`
	Update int `json:"update"`
	Skip   int `json:"skip"`
	Error  int `json:"error"`
}

// SummarizeCoaImport is summarizeCoaImport: parse issues count as errors.
func SummarizeCoaImport(preview []CoaPreviewRow, issues []CoaIssue) CoaImportSummary {
	s := CoaImportSummary{Error: len(issues)}
	for _, p := range preview {
		switch p.Action {
		case "create":
			s.Create++
		case "update":
			s.Update++
		case "skip":
			s.Skip++
		case "error":
			s.Error++
		}
	}
	return s
}
