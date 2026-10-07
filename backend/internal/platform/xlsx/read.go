package xlsx

import (
	"bytes"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/xuri/excelize/v2"

	"nuhabit/backend/internal/platform/jsmath"
)

// Limits bound what a parse reads (ParseLimits). Zero fields take the TS
// defaults: 15 MB, 100 000 rows, 512 columns.
type Limits struct {
	MaxBytes int
	MaxRows  int
	MaxCols  int
}

func (l Limits) withDefaults() Limits {
	if l.MaxBytes <= 0 {
		l.MaxBytes = 15 * 1024 * 1024
	}
	if l.MaxRows <= 0 {
		l.MaxRows = 100_000
	}
	if l.MaxCols <= 0 {
		l.MaxCols = 512
	}
	return l
}

// ErrTooLarge is the TS message for a file over Limits.MaxBytes.
var ErrTooLarge = errors.New("File spreadsheet terlalu besar untuk diproses")

// ReadOptions pick the sheet and limits of ParseMatrix.
type ReadOptions struct {
	// PreferSheet selects the sheet with this name, compared
	// case-insensitively, falling back to the first sheet.
	PreferSheet string
	Limits      Limits
}

// ParseMatrix is parseXlsxToMatrix: one sheet as a rectangular matrix of
// trimmed strings (row 0 is the header), as wide as the widest row up to
// MaxCols, rows past MaxRows dropped. Cells read as ExcelJS values do:
// numbers in JavaScript form, date-formatted numbers as ISO timestamps,
// booleans as "true"/"false", formulas as their cached result.
func ParseMatrix(data []byte, opts ReadOptions) ([][]string, error) {
	lim := opts.Limits.withDefaults()
	if len(data) > lim.MaxBytes {
		return nil, ErrTooLarge
	}
	b, err := openBook(data)
	if err != nil {
		return nil, err
	}
	defer b.f.Close()
	sheets := b.f.GetSheetList()
	if len(sheets) == 0 {
		return [][]string{}, nil
	}
	sheet := sheets[0]
	for _, name := range sheets {
		if opts.PreferSheet != "" && strings.EqualFold(name, opts.PreferSheet) {
			sheet = name
			break
		}
	}
	rows, err := b.rows(sheet, lim, true)
	if err != nil {
		return nil, err
	}
	width := 0
	for _, r := range rows {
		width = max(width, len(r))
	}
	width = min(width, lim.MaxCols)
	out := make([][]string, len(rows))
	for i, r := range rows {
		out[i] = make([]string, width)
		copy(out[i], r)
	}
	return out, nil
}

// SheetCSV is one sheet of ParseCSVParts.
type SheetCSV struct {
	Name string
	CSV  string
}

// ParseCSVParts is parseXlsxToCsvParts: every non-empty sheet as CSV (cells
// quoted only when they hold a quote, comma or newline), for attachment text
// extraction. Empty rows are skipped.
func ParseCSVParts(data []byte, limits Limits) ([]SheetCSV, error) {
	lim := limits.withDefaults()
	if len(data) > lim.MaxBytes {
		return nil, ErrTooLarge
	}
	b, err := openBook(data)
	if err != nil {
		return nil, err
	}
	defer b.f.Close()
	var parts []SheetCSV
	for _, name := range b.f.GetSheetList() {
		rows, err := b.rows(name, lim, false)
		if err != nil {
			return nil, err
		}
		lines := make([]string, 0, len(rows))
		for _, r := range rows {
			cells := make([]string, len(r))
			for i, c := range r {
				cells[i] = plainCSVCell(c)
			}
			lines = append(lines, strings.Join(cells, ","))
		}
		if csv := jsTrim(strings.Join(lines, "\n")); csv != "" {
			parts = append(parts, SheetCSV{Name: name, CSV: csv})
		}
	}
	return parts, nil
}

func plainCSVCell(s string) string {
	if strings.ContainsAny(s, "\",\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

type book struct {
	f        *excelize.File
	date1904 bool
	dateFmt  map[int]bool // style id -> number format is a date
}

func openBook(data []byte) (*book, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := &book{f: f, dateFmt: map[int]bool{}}
	if props, err := f.GetWorkbookProps(); err == nil && props.Date1904 != nil {
		b.date1904 = *props.Date1904
	}
	return b, nil
}

// rows reads up to MaxRows rows of up to MaxCols cells. keepEmpty keeps
// empty rows (ExcelJS eachRow includeEmpty) so row numbers line up.
func (b *book) rows(sheet string, lim Limits, keepEmpty bool) ([][]string, error) {
	raw, err := b.f.GetRows(sheet, excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, err
	}
	var out [][]string
	for r, cells := range raw {
		if r >= lim.MaxRows {
			break
		}
		if len(cells) > lim.MaxCols {
			cells = cells[:lim.MaxCols]
		}
		row := make([]string, len(cells))
		empty := true
		for c, v := range cells {
			row[c] = b.cell(sheet, c, r, v)
			empty = empty && v == ""
		}
		// ExcelJS row.values ends at the last non-empty cell.
		for len(row) > 0 && cells[len(row)-1] == "" {
			row = row[:len(row)-1]
		}
		if empty && !keepEmpty {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// cell is cellToString over the ExcelJS value of one raw cell.
func (b *book) cell(sheet string, col, row int, raw string) string {
	if raw == "" {
		return ""
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return jsTrim(raw)
	}
	ref := cellName(col, row)
	switch t, _ := b.f.GetCellType(sheet, ref); t {
	case excelize.CellTypeBool:
		return strconv.FormatBool(raw == "1")
	case excelize.CellTypeNumber, excelize.CellTypeUnset, excelize.CellTypeFormula:
		if b.isDate(sheet, ref) {
			return excelToDate(n, b.date1904).Format("2006-01-02T15:04:05.000Z")
		}
		return JSNumber(n)
	}
	return jsTrim(raw)
}

func (b *book) isDate(sheet, ref string) bool {
	id, err := b.f.GetCellStyle(sheet, ref)
	if err != nil || id == 0 {
		return false
	}
	if v, ok := b.dateFmt[id]; ok {
		return v
	}
	isDate := false
	if st, err := b.f.GetStyle(id); err == nil {
		if st.CustomNumFmt != nil {
			isDate = isDateFmt(*st.CustomNumFmt)
		} else {
			isDate = builtinDateFmt(st.NumFmt)
		}
	}
	b.dateFmt[id] = isDate
	return isDate
}

// builtinDateFmt covers the built-in number formats ExcelJS maps to date
// codes (defaultnumformats.js).
func builtinDateFmt(id int) bool {
	return id >= 14 && id <= 22 || id >= 27 && id <= 36 || id >= 45 && id <= 47 || id >= 50 && id <= 58
}

var (
	bracketed = regexp.MustCompile(`\[[^\]]*]`)
	quoted    = regexp.MustCompile(`"[^"]*"`)
	dateChars = regexp.MustCompile(`[ymdhMsb]`)
)

// isDateFmt is ExcelJS utils.isDateFmt.
func isDateFmt(code string) bool {
	code = quoted.ReplaceAllString(bracketed.ReplaceAllString(code, ""), "")
	return dateChars.MatchString(code)
}

// excelToDate is ExcelJS utils.excelToDate (UTC).
func excelToDate(v float64, date1904 bool) time.Time {
	offset := 0.0
	if date1904 {
		offset = 1462
	}
	ms := jsmath.Round(float64(float64(float64((v-25569+offset)*24)*3600) * 1000))
	return time.UnixMilli(int64(ms)).UTC()
}

// JSNumber formats n like JavaScript's String(n).
func JSNumber(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n == 0:
		return "0"
	}
	abs := math.Abs(n)
	if abs >= 1e-6 && abs < 1e21 {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	s := strconv.FormatFloat(n, 'e', -1, 64) // 1.5e-08
	mant, exp, _ := strings.Cut(s, "e")
	sign, digits := exp[:1], strings.TrimLeft(exp[1:], "0")
	return mant + "e" + sign + digits
}

// jsTrim is String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' })
}
