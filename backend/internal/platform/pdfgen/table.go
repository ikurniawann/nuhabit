package pdfgen

// Column is one table column.
type Column struct {
	Header string
	Width  float64
	Align  Align
}

// Table is the header-and-rows layout the TS documents draw by hand (the
// attendance report, quotation and invoice items): a filled header row,
// wrapped cells, optional zebra fill and a rule under every row. Rows that
// do not fit move to a new page under a repeated header.
type Table struct {
	Columns []Column
	// X is the left edge; 0 is the left margin.
	X float64
	// FontSize of the cells (header too); 0 is 8.
	FontSize float64
	// Padding inside each cell; 0 is 4.
	Padding float64
	// MinRowHeight is the least height of a body row.
	MinRowHeight float64
	// HeaderFill and HeaderColor style the header; empty is #1f3864 on white.
	HeaderFill, HeaderColor string
	// Zebra fills every second body row when set ("#f3f5fa").
	Zebra string
	// LineColor of the rule under each row; empty is #d1d5db.
	LineColor string
	// TextColor of the body cells; empty is #111827.
	TextColor string
}

func (t Table) withDefaults(d *Doc) Table {
	if t.X == 0 {
		t.X = d.Left()
	}
	if t.FontSize == 0 {
		t.FontSize = 8
	}
	if t.Padding == 0 {
		t.Padding = 4
	}
	if t.HeaderFill == "" {
		t.HeaderFill = "#1f3864"
	}
	if t.HeaderColor == "" {
		t.HeaderColor = "#ffffff"
	}
	if t.LineColor == "" {
		t.LineColor = "#d1d5db"
	}
	if t.TextColor == "" {
		t.TextColor = "#111827"
	}
	return t
}

func (t Table) width() float64 {
	w := 0.0
	for _, c := range t.Columns {
		w += c.Width
	}
	return w
}

// DrawTable draws t at Y with rows of cell text and leaves Y under the
// table.
func (d *Doc) DrawTable(t Table, rows [][]string) {
	t = t.withDefaults(d)
	d.tableHeader(t)
	for i, row := range rows {
		d.Font(Helvetica, t.FontSize)
		h := t.MinRowHeight
		for c, col := range t.Columns {
			if c < len(row) {
				h = max(h, d.HeightOf(row[c], col.Width-2*t.Padding)+2*t.Padding)
			}
		}
		if d.EnsureSpace(h) {
			d.tableHeader(t)
			d.Font(Helvetica, t.FontSize)
		}
		y := d.Y
		if t.Zebra != "" && i%2 == 1 {
			d.Rect(t.X, y, t.width(), h, t.Zebra)
		}
		d.Color(t.TextColor)
		x := t.X
		for c, col := range t.Columns {
			if c < len(row) {
				d.Text(row[c], x+t.Padding, y+t.Padding, TextOpts{Width: col.Width - 2*t.Padding, Align: col.Align, Height: h})
			}
			x += col.Width
		}
		d.Line(t.X, y+h, t.X+t.width(), y+h, t.LineColor, 0.5)
		d.X, d.Y = d.Left(), y+h
	}
}

func (d *Doc) tableHeader(t Table) {
	h := t.FontSize*metrics[HelveticaBold].lineHeight + 2*t.Padding + 4
	d.EnsureSpace(h)
	top := d.Y
	d.Rect(t.X, top, t.width(), h, t.HeaderFill)
	d.Font(HelveticaBold, t.FontSize).Color(t.HeaderColor)
	x := t.X
	for _, col := range t.Columns {
		d.Text(col.Header, x+t.Padding, top+(h-d.LineHeight())/2, TextOpts{Width: col.Width - 2*t.Padding, Align: col.Align, NoWrap: true})
		x += col.Width
	}
	d.X, d.Y = d.Left(), top+h
}
