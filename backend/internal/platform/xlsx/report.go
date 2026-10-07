package xlsx

import (
	"time"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
)

// Fmt is a column's number format (CellFmt in lib/pos/report-excel/workbook.ts).
type Fmt string

const (
	FmtText     Fmt = "text"
	FmtRp       Fmt = "rp"
	FmtNum      Fmt = "num"
	FmtQty      Fmt = "qty"
	FmtPct      Fmt = "pct"
	FmtDatetime Fmt = "datetime"
)

var numFmts = map[Fmt]string{
	FmtRp:  `"Rp "#,##0`,
	FmtNum: "#,##0",
	FmtQty: "#,##0.##",
	FmtPct: `0.0"%"`,
}

// Colors of the TS report helpers (ARGB without the alpha byte).
const (
	colorTitle  = "111827"
	colorMuted  = "6B7280"
	colorLabel  = "374151"
	colorHeader = "1F2937"
	colorZebra  = "F9FAFB"
	colorTotal  = "E5E7EB"
	colorBorder = "D1D5DB"
)

// style is everything a report cell can carry; it is comparable so equal
// styles share one excelize style id.
type style struct {
	bold        bool
	size        float64
	color, fill string
	border      bool
	horiz, vert string
	wrap        bool
	numFmt      string
}

// Report is a styled workbook like newWorkbook() + the add* helpers: title
// blocks, dark-header tables with thin borders, Rupiah and percent formats,
// totals rows and column widths. Rows are 1-based as in ExcelJS. The first
// error is kept and returned by Bytes.
type Report struct {
	f      *excelize.File
	styles map[style]int
	sheets int
	err    error
}

// NewReport starts a workbook with the TS creator and creation time.
func NewReport(now time.Time) *Report {
	f := excelize.NewFile()
	r := &Report{f: f, styles: map[style]int{}}
	r.keep(f.SetDocProps(&excelize.DocProperties{
		Creator: "NüHabit — Arkiv OS",
		Created: now.UTC().Format(time.RFC3339),
	}))
	return r
}

func (r *Report) keep(err error) {
	if r.err == nil && err != nil {
		r.err = err
	}
}

// Bytes renders the workbook.
func (r *Report) Bytes() ([]byte, error) {
	defer r.f.Close()
	if r.err != nil {
		return nil, r.err
	}
	return writeBytes(r.f)
}

// Sheet adds a worksheet.
func (r *Report) Sheet(name string) *Sheet {
	r.keep(addSheet(r.f, r.sheets, name))
	r.sheets++
	return &Sheet{r: r, name: name, widths: map[int]float64{}}
}

// Sheet is one worksheet of a Report.
type Sheet struct {
	r      *Report
	name   string
	widths map[int]float64
}

func (s *Sheet) set(row, col int, v any, st style) {
	if v == nil {
		v = ""
	}
	ref := cellName(col-1, row-1)
	s.r.keep(s.r.f.SetCellValue(s.name, ref, v))
	if st == (style{}) {
		return
	}
	id, ok := s.r.styles[st]
	if !ok {
		var err error
		id, err = s.r.f.NewStyle(st.excelize())
		s.r.keep(err)
		s.r.styles[st] = id
	}
	s.r.keep(s.r.f.SetCellStyle(s.name, ref, ref, id))
}

func (st style) excelize() *excelize.Style {
	out := &excelize.Style{}
	if st.bold || st.size > 0 || st.color != "" {
		out.Font = &excelize.Font{Bold: st.bold, Size: st.size, Color: st.color}
	}
	if st.fill != "" {
		out.Fill = excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{st.fill}}
	}
	if st.border {
		for _, side := range []string{"top", "left", "bottom", "right"} {
			out.Border = append(out.Border, excelize.Border{Type: side, Color: colorBorder, Style: 1})
		}
	}
	if st.horiz != "" || st.vert != "" || st.wrap {
		out.Alignment = &excelize.Alignment{Horizontal: st.horiz, Vertical: st.vert, WrapText: st.wrap}
	}
	if st.numFmt != "" {
		f := st.numFmt
		out.CustomNumFmt = &f
	}
	return out
}

// widen is column.width = max(column.width ?? 0, width).
func (s *Sheet) widen(col int, width float64) {
	if width <= s.widths[col] {
		return
	}
	s.widths[col] = width
	name, _ := excelize.ColumnNumberToName(col)
	s.r.keep(s.r.f.SetColWidth(s.name, name, name, width))
}

// TitleBlock is addTitleBlock: a bold 14pt title in A1 and grey lines
// below it. It returns the next row after one blank row.
func (s *Sheet) TitleBlock(title string, lines ...string) int {
	s.set(1, 1, title, style{bold: true, size: 14, color: colorTitle})
	s.r.keep(s.r.f.SetRowHeight(s.name, 1, 22))
	for i, line := range lines {
		s.set(2+i, 1, line, style{size: 10, color: colorMuted})
	}
	return 2 + len(lines) + 1
}

// SectionTitle is addSectionTitle: bold 11pt text in column A; it returns
// the next row.
func (s *Sheet) SectionTitle(row int, text string) int {
	s.set(row, 1, text, style{bold: true, size: 11, color: colorTitle})
	return row + 1
}

// Pair is one label-value line of KeyValues.
type Pair struct {
	Label string
	Value any
	Fmt   Fmt
}

// KeyValues is addKeyValues: bordered label/value pairs in columns A and B.
// It returns the next row after one blank row.
func (s *Sheet) KeyValues(startRow int, pairs []Pair) int {
	for i, p := range pairs {
		r := startRow + i
		s.set(r, 1, p.Label, style{color: colorLabel, border: true, fill: colorZebra})
		v := style{bold: true, border: true, horiz: alignFor(p.Value), numFmt: numFmts[p.Fmt]}
		s.set(r, 2, p.Value, v)
	}
	s.widen(1, 30)
	s.widen(2, 20)
	return startRow + len(pairs) + 1
}

// Col is a table column (TableCol): Align overrides the default (right for
// numbers, left otherwise); Width 0 sizes from the header.
type Col struct {
	Header string
	Width  float64
	Fmt    Fmt
	Align  string
}

// TableOpts are addTable's options. StartCol is 1-based (0 means 1).
type TableOpts struct {
	Totals       []any
	FreezeHeader bool
	StartCol     int
}

// Table is addTable: a dark header row, thin borders, per-column number
// formats on numeric cells, zebra rows and an optional bold totals row. It
// returns the next row after one blank row.
func (s *Sheet) Table(startRow int, cols []Col, rows [][]any, opts TableOpts) int {
	c0 := max(opts.StartCol, 1)
	for i, col := range cols {
		h := col.Align
		if h == "" {
			h = "left"
			if col.Fmt != "" && col.Fmt != FmtText && col.Fmt != FmtDatetime {
				h = "right"
			}
		}
		s.set(startRow, c0+i, col.Header, style{bold: true, color: "FFFFFF", fill: colorHeader, border: true, horiz: h, vert: "center", wrap: true})
		w := col.Width
		if w == 0 {
			w = float64(min(40, max(10, utf8.RuneCountInString(col.Header)+4)))
		}
		s.widen(c0+i, w)
	}
	s.r.keep(s.r.f.SetRowHeight(s.name, startRow, 20))

	for ri, values := range rows {
		for i, col := range cols {
			var v any
			if i < len(values) {
				v = values[i]
			}
			st := style{border: true, vert: "top", horiz: col.Align}
			if st.horiz == "" {
				st.horiz = alignFor(v)
			}
			if isNumber(v) {
				st.numFmt = numFmts[col.Fmt]
			}
			if str, ok := v.(string); ok && (col.Fmt == "" || col.Fmt == FmtText) && utf8.RuneCountInString(str) > 40 {
				st.wrap = true
			}
			if ri%2 == 1 {
				st.fill = colorZebra
			}
			s.set(startRow+1+ri, c0+i, v, st)
		}
	}

	next := startRow + 1 + len(rows)
	if opts.Totals != nil {
		for i, col := range cols {
			var v any
			if i < len(opts.Totals) {
				v = opts.Totals[i]
			}
			st := style{bold: true, fill: colorTotal, border: true, horiz: col.Align}
			if st.horiz == "" {
				st.horiz = alignFor(v)
			}
			if isNumber(v) {
				st.numFmt = numFmts[col.Fmt]
			}
			s.set(next, c0+i, v, st)
		}
		next++
	}
	if opts.FreezeHeader {
		s.r.keep(s.r.f.SetPanes(s.name, &excelize.Panes{
			Freeze: true, YSplit: startRow, TopLeftCell: cellName(0, startRow), ActivePane: "bottomLeft",
		}))
	}
	return next + 1
}

func alignFor(v any) string {
	if isNumber(v) {
		return "right"
	}
	return "left"
}

func isNumber(v any) bool {
	switch v.(type) {
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return true
	}
	return false
}
