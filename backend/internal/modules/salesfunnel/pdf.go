package salesfunnel

import (
	"context"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/storage"
)

// GET quotations/{id}/pdf and invoices/{id}/pdf: renderQuotationPdf and
// renderInvoicePdf with the layouts of lib/sales-funnel/quotation-pdf.ts and
// invoice-pdf.ts. Company, branch and owner names are display joins in the
// module SQL, as in the TS.

const (
	pdfText   = "#111827"
	pdfMuted  = "#6b7280"
	pdfLine   = "#d1d5db"
	pdfAccent = "#00281a"
	pdfLink   = "#203b32"
	pdfBand   = "#f3f4f6"
)

func (h *handler) quotationPDF(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, _, err := h.requireQuotation(ctx, id, u); err != nil {
		return err
	}
	q, err := h.loadQuotationPDF(ctx, id)
	if err != nil {
		return err
	}
	if q.Kop, q.Logo, err = h.letterhead(ctx); err != nil {
		return err
	}
	return writePDF(w, buildQuotationPDF(q), domain.DocumentFileName(q.Number, q.OrgName, "quotation"))
}

func (h *handler) invoicePDF(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireFinance(r, true)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.requireInvoice(ctx, id, u); err != nil {
		return err
	}
	inv, err := h.loadInvoicePDF(ctx, id)
	if err != nil {
		return err
	}
	if inv.Kop, inv.Logo, err = h.letterhead(ctx); err != nil {
		return err
	}
	return writePDF(w, buildInvoicePDF(inv), domain.DocumentFileName(inv.Number, inv.OrgName, "invoice"))
}

// letterhead is the company profile and the uploaded logo's bytes; a logo
// that is not in storage is left out.
func (h *handler) letterhead(ctx context.Context) (Letterhead, []byte, error) {
	if h.ports.Company == nil {
		return Letterhead{}, nil, nil
	}
	kop, err := h.ports.Company.Letterhead(ctx, h.db)
	if err != nil || kop.LogoURL == "" {
		return kop, nil, err
	}
	path, ok := storage.FromEnv().UploadPath(kop.LogoURL)
	if !ok {
		return kop, nil, nil
	}
	logo, err := os.ReadFile(path)
	if err != nil {
		h.log.WarnContext(ctx, "[sales-funnel/pdf] logo kop tidak terbaca", "url", kop.LogoURL, "error", err)
		return kop, nil, nil
	}
	return kop, logo, nil
}

func writePDF(w http.ResponseWriter, doc *pdfgen.Doc, fileName string) error {
	data, err := doc.Bytes()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="`+fileName+`"`)
	_, err = w.Write(data)
	return err
}

/* ── Data ─────────────────────────────────────────────────────────────── */

// docHead is what both documents print in the letterhead, the info grid and
// the signature. Dates are already formatted. Kop and Logo come from the
// company profile; a zero Kop prints the company or the document name.
type docHead struct {
	Number, OrgName, PicName, DealTitle, EventLabel, CreatedAt, EventDate string
	CompanyName, BranchName, PicTitle, OwnerName, Notes                   *string
	Kop                                                                   Letterhead
	Logo                                                                  []byte
}

func headOf(row *pgrow.Row, number, notesKey string) docHead {
	label, ok := domain.EventTypeDocLabels[row.Str("event_type")]
	if !ok {
		label = "Acara"
	}
	return docHead{
		Number: number, OrgName: row.Str("org_name"), PicName: row.Str("pic_name"), DealTitle: row.Str("deal_title"),
		EventLabel: label, CreatedAt: docDate(row, "created_at"), EventDate: docDate(row, "event_date"),
		CompanyName: row.StrPtr("company_name"), BranchName: row.StrPtr("branch_name"), PicTitle: row.StrPtr("pic_title"),
		OwnerName: row.StrPtr("owner_name"), Notes: row.StrPtr(notesKey),
	}
}

// docDate is tanggal(): "—" for NULL; a "YYYY-MM-DD" text is a UTC
// midnight, as new Date() reads it.
func docDate(row *pgrow.Row, key string) string {
	if t, ok := row.Time(key); ok {
		return domain.DocDate(t)
	}
	if t, err := time.Parse("2006-01-02", row.Str(key)); err == nil {
		return domain.DocDate(t)
	}
	return "—"
}

type quotationDoc struct {
	docHead
	ValidUntil                                                        string
	UsePPN                                                            bool
	PPNPersen, Subtotal, DiscountPercent, DiscountNominal, PPN, Total float64
	Items                                                             []quotationDocItem
	Terms                                                             []quotationDocTerm
}

type quotationDocItem struct {
	Description, ItemType     string
	Qty, UnitPrice, LineTotal float64
}

type quotationDocTerm struct {
	Label           string
	Percent, Amount float64
	DueDate         string // formatted, "" when none
}

func (h *handler) loadQuotationPDF(ctx context.Context, id string) (quotationDoc, error) {
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT q.quote_number, q.use_ppn,
            q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
            q.discount_percent, q.discount_nominal,
            q.valid_until, q.created_at,
            d.title AS deal_title, d.event_type, d.event_date,
            l.org_name, l.pic_name, l.pic_title,
            u.full_name AS owner_name,
            c.name AS company_name, b.name AS branch_name
     FROM crm.crm_sales_quotations q
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN configuration.companies c ON c.id = q.company_id
     LEFT JOIN configuration.branches b ON b.id = q.branch_id
     WHERE q.id = $1 AND q.deleted_at IS NULL`, id)
	if err != nil {
		return quotationDoc{}, err
	}
	if row == nil {
		return quotationDoc{}, httpx.NotFound("Quotation tidak ditemukan")
	}
	items, err := pgrow.Query(ctx, h.db, `SELECT description, item_type, qty, unit_price, line_total
       FROM crm.crm_sales_quotation_items
       WHERE quotation_id = $1
       ORDER BY sort_order ASC`, id)
	if err != nil {
		return quotationDoc{}, err
	}
	terms, err := pgrow.Query(ctx, h.db, `SELECT label, percent, due_date::text AS due_date
       FROM crm.crm_sales_quotation_terms
       WHERE quotation_id = $1
       ORDER BY sort_order ASC`, id)
	if err != nil {
		return quotationDoc{}, err
	}
	q := quotationDoc{
		docHead: headOf(row, row.Str("quote_number"), "notes"), ValidUntil: docDate(row, "valid_until"),
		UsePPN: row.Bool("use_ppn"), PPNPersen: row.Num("ppn_persen"), Subtotal: row.Num("subtotal"),
		DiscountPercent: row.Num("discount_percent"), DiscountNominal: row.Num("discount_nominal"),
		PPN: row.Num("ppn_nominal"), Total: row.Num("total"),
	}
	for _, it := range items {
		q.Items = append(q.Items, quotationDocItem{Description: it.Str("description"), ItemType: it.Str("item_type"),
			Qty: it.Num("qty"), UnitPrice: it.Num("unit_price"), LineTotal: it.Num("line_total")})
	}
	percents := make([]float64, len(terms))
	for i, t := range terms {
		percents[i] = t.Num("percent")
	}
	amounts := domain.AllocateTermAmounts(q.Total, percents)
	for i, t := range terms {
		due := ""
		if t.Str("due_date") != "" {
			due = docDate(t, "due_date")
		}
		q.Terms = append(q.Terms, quotationDocTerm{Label: t.Str("label"), Percent: percents[i], Amount: amounts[i], DueDate: due})
	}
	return q, nil
}

type invoiceDoc struct {
	docHead
	Label, DueDate          string
	Amount, Paid, PPNPersen float64
	UsePPN                  bool
	QuoteNumber             *string
	TermPercent             *float64
}

func (h *handler) loadInvoicePDF(ctx context.Context, id string) (invoiceDoc, error) {
	row, err := pgrow.QueryOne(ctx, h.db, `SELECT i.invoice_number, i.label, i.amount,
            i.due_date::text AS due_date, i.note, i.created_at,
            `+paidSQL+` AS paid,
            q.quote_number, q.use_ppn, q.ppn_persen,
            t.percent AS term_percent,
            d.title AS deal_title, d.event_type, d.event_date,
            l.org_name, l.pic_name, l.pic_title,
            u.full_name AS owner_name,
            c.name AS company_name, b.name AS branch_name
     FROM crm.crm_sales_invoices i
     JOIN crm.crm_sales_deals d ON d.id = i.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
     LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     LEFT JOIN configuration.companies c ON c.id = i.company_id
     LEFT JOIN configuration.branches b ON b.id = i.branch_id
     WHERE i.id = $1 AND i.deleted_at IS NULL`, id)
	if err != nil {
		return invoiceDoc{}, err
	}
	if row == nil {
		return invoiceDoc{}, httpx.NotFound("Invoice tidak ditemukan")
	}
	inv := invoiceDoc{
		docHead: headOf(row, row.Str("invoice_number"), "note"), Label: row.Str("label"), DueDate: docDate(row, "due_date"),
		Amount: row.Num("amount"), Paid: row.Num("paid"), UsePPN: row.Bool("use_ppn"), PPNPersen: row.Num("ppn_persen"),
		QuoteNumber: row.StrPtr("quote_number"),
	}
	if row.Get("term_percent") != nil {
		p := row.Num("term_percent")
		inv.TermPercent = &p
	}
	return inv, nil
}

/* ── Layout ───────────────────────────────────────────────────────────── */

func newSalesDoc() *pdfgen.Doc { return pdfgen.New(pdfgen.Options{Size: "A4", Margin: 48}) }

func rule(d *pdfgen.Doc) { d.HLine(d.Y, pdfLine, 0.7) }

func truthy(s *string) bool { return s != nil && *s != "" }

// legalName is the profile's legal name, else the venue company, else the
// document's own name.
func (h docHead) legalName(fallback string) string {
	if h.Kop.LegalName != "" {
		return h.Kop.LegalName
	}
	if h.CompanyName != nil {
		if company := domain.JSTrim(*h.CompanyName); company != "" {
			return company
		}
	}
	return fallback
}

// writeKop is the letterhead (logo on the left, the company block right
// aligned) and the title band with the document number, as on screen.
func writeKop(d *pdfgen.Doc, h docHead, fallback, title string) {
	const logoW, logoH, gap = 140.0, 56.0, 16.0
	left, top, width := d.Left(), d.Y, d.ContentWidth()
	textX, textW, logoBottom := left, width, top
	if len(h.Logo) > 0 && d.Image(h.Logo, left, top, logoW, logoH) == nil {
		textX, textW, logoBottom = left+logoW+gap, width-logoW-gap, top+logoH
	}
	line := func(s string, font pdfgen.Font, size float64, color string) {
		if s == "" {
			return
		}
		d.Font(font, size).Color(color)
		d.Text(s, textX, d.Y, pdfgen.TextOpts{Width: textW, Align: pdfgen.AlignRight})
	}
	d.Y = top
	line(h.legalName(fallback), pdfgen.HelveticaBold, 13, pdfText)
	if h.BranchName != nil {
		line(*h.BranchName, pdfgen.Helvetica, 9, pdfMuted)
	}
	address := h.Kop.Address
	if h.Kop.City != "" && address != "" {
		address += ", " + h.Kop.City
	} else if h.Kop.City != "" {
		address = h.Kop.City
	}
	line(address, pdfgen.Helvetica, 8.5, pdfMuted)
	line(h.Kop.Email, pdfgen.Helvetica, 8.5, pdfLink)
	if h.Kop.Phone != "" {
		line("Telp. "+h.Kop.Phone, pdfgen.Helvetica, 8.5, pdfMuted)
	}
	if h.Kop.NPWP != "" {
		line("NPWP: "+h.Kop.NPWP, pdfgen.Helvetica, 8.5, pdfMuted)
	}
	d.Y = math.Max(d.Y, logoBottom) + 8
	rule(d)

	bandY := d.Y + 8
	d.Rect(left, bandY, width, 42, pdfBand)
	d.Font(pdfgen.HelveticaBold, 14).Color(pdfAccent)
	d.Text(title, left, bandY+7, pdfgen.TextOpts{Width: width, Align: pdfgen.AlignCenter})
	d.Font(pdfgen.Helvetica, 9).Color(pdfText)
	d.Text("Nomor : "+h.Number, left, bandY+25, pdfgen.TextOpts{Width: width, Align: pdfgen.AlignCenter})
	d.Y = bandY + 42 + 12
}

// writeInfo is the two-column info block: "LABEL : value" rows on each side
// of a vertical divider, as on the on-screen document.
func writeInfo(d *pdfgen.Doc, leftRows, rightRows [][2]string) {
	const labelW = 92.0
	top, half := d.Y, d.ContentWidth()/2
	column := func(x float64, rows [][2]string) float64 {
		y := top
		valueX, valueW := x+labelW+8, half-labelW-20
		for _, row := range rows {
			value := row[1]
			if value == "" {
				value = "—"
			}
			d.Font(pdfgen.HelveticaOblique, 7.5).Color(pdfMuted)
			d.Text(strings.ToUpper(row[0]), x, y+1, pdfgen.TextOpts{Width: labelW - 6})
			d.Text(":", x+labelW, y+1, pdfgen.TextOpts{NoWrap: true})
			d.Font(pdfgen.HelveticaBold, 9.5).Color(pdfText)
			height := d.HeightOf(value, valueW)
			d.Text(value, valueX, y, pdfgen.TextOpts{Width: valueW})
			y += math.Max(height, 12) + 6
		}
		return y
	}
	bottom := math.Max(column(d.Left(), leftRows), column(d.Left()+half+12, rightRows))
	d.Line(d.Left()+half, top-2, d.Left()+half, bottom-4, pdfLine, 0.7)
	d.Y = bottom + 2
	rule(d)
	d.MoveDown(0.5)
}

func (h docHead) pic() string {
	if truthy(h.PicTitle) {
		return h.PicName + " (" + *h.PicTitle + ")"
	}
	return h.PicName
}

func (h docHead) event() string { return h.DealTitle + " (" + h.EventLabel + ")" }

// tableHead writes the bold column captions at one y and the rule below.
func tableHead(d *pdfgen.Doc, cells func(y float64)) {
	d.Font(pdfgen.HelveticaBold, 8.5).Color(pdfMuted)
	cells(d.Y)
	d.MoveDown(0.4)
	rule(d)
	d.MoveDown(0.35)
}

// totalRow is the totals line: a right-aligned label, then the value.
func totalRow(d *pdfgen.Doc, label, value string, bold bool, labelX, labelW, valueX, valueW float64) {
	y := d.Y
	if bold {
		d.Font(pdfgen.HelveticaBold, 11).Color(pdfText)
	} else {
		d.Font(pdfgen.Helvetica, 9.5).Color(pdfMuted)
	}
	d.Text(label, labelX, y, pdfgen.TextOpts{Width: labelW, Align: pdfgen.AlignRight})
	d.Color(pdfText)
	d.Text(value, valueX, y, pdfgen.TextOpts{Width: valueW, Align: pdfgen.AlignRight})
	d.MoveDown(0.25)
}

// writeClosing is the notes block (when any) and the signature.
func writeClosing(d *pdfgen.Doc, h docHead) {
	left := d.Left()
	if truthy(h.Notes) {
		d.MoveDown(0.8)
		d.Font(pdfgen.HelveticaBold, 8.5).Color(pdfMuted)
		d.Text("CATATAN", left, d.Y, pdfgen.TextOpts{})
		d.MoveDown(0.2)
		d.Font(pdfgen.Helvetica, 9).Color(pdfText)
		d.Text(*h.Notes, left, d.Y, pdfgen.TextOpts{Width: d.ContentWidth()})
	}
	d.MoveDown(2)
	d.Font(pdfgen.Helvetica, 9.5).Color(pdfText)
	d.Text("Hormat kami,", left, d.Y, pdfgen.TextOpts{})
	d.MoveDown(3)
	signer := "Tim Sales"
	if h.OwnerName != nil {
		signer = *h.OwnerName
	} else if h.BranchName != nil {
		signer = *h.BranchName
	}
	d.Font(pdfgen.HelveticaBold, 9.5)
	d.Text(signer, left, d.Y, pdfgen.TextOpts{})
	d.Font(pdfgen.Helvetica, 8).Color(pdfMuted)
	d.MoveDown(1.2)
	d.Text("Dokumen ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan basah.", left, d.Y, pdfgen.TextOpts{Width: d.ContentWidth()})
}

func alignRight(w float64) pdfgen.TextOpts {
	return pdfgen.TextOpts{Width: w, Align: pdfgen.AlignRight}
}

func buildQuotationPDF(q quotationDoc) *pdfgen.Doc {
	d := newSalesDoc()
	left, rightX, width := d.Left(), d.Right(), d.ContentWidth()
	writeKop(d, q.docHead, "PENAWARAN HARGA", "QUOTATION")
	writeInfo(d,
		[][2]string{{"Kepada", q.OrgName}, {"PIC", q.pic()}, {"Acara", q.event()}},
		[][2]string{{"Tanggal penawaran", q.CreatedAt}, {"Tanggal acara", q.EventDate}, {"Berlaku s.d.", q.ValidUntil}})

	colQty, colPrice, colTotal := left+width*0.52, left+width*0.64, left+width*0.84
	descW, qtyW, priceW, totalW := colQty-left-8, colPrice-colQty-8, colTotal-colPrice-8, rightX-colTotal
	tableHead(d, func(y float64) {
		d.Text("DESKRIPSI", left, y, pdfgen.TextOpts{Width: descW})
		d.Text("QTY", colQty, y, alignRight(qtyW))
		d.Text("HARGA", colPrice, y, alignRight(priceW))
		d.Text("JUMLAH", colTotal, y, alignRight(totalW))
	})
	for _, it := range q.Items {
		// Measure first and break the page by hand, so a row never splits
		// its description from its numbers.
		d.Font(pdfgen.Helvetica, 9.5)
		rowHeight := math.Max(d.HeightOf(it.Description, descW), 12)
		if d.Y+rowHeight+10 > d.Bottom() {
			d.AddPage()
		}
		rowY := d.Y
		d.Color(pdfText)
		d.Text(it.Description, left, rowY, pdfgen.TextOpts{Width: descW})
		qty := pdfgen.Thousands(it.Qty)
		if it.ItemType == "produk" {
			qty += " pax"
		}
		d.Text(qty, colQty, rowY, alignRight(qtyW))
		d.Text(pdfgen.Rupiah(it.UnitPrice), colPrice, rowY, alignRight(priceW))
		d.Font(pdfgen.HelveticaBold, 9.5)
		d.Text(pdfgen.Rupiah(it.LineTotal), colTotal, rowY, alignRight(totalW))
		d.Y = rowY + rowHeight + 6
	}

	// The totals, notes and signature need room together.
	if d.Y+170 > d.Bottom() {
		d.AddPage()
	}
	rule(d)
	d.MoveDown(0.4)
	total := func(label, value string, bold bool) {
		totalRow(d, label, value, bold, colPrice-60, colTotal-colPrice+52, colTotal, totalW)
	}
	total("Subtotal", pdfgen.Rupiah(q.Subtotal), false)
	if q.DiscountNominal > 0 {
		total("Diskon "+pdfgen.Thousands(q.DiscountPercent)+"%", "- "+pdfgen.Rupiah(q.DiscountNominal), false)
	}
	if q.UsePPN {
		total("PPN "+domain.JSNumberString(q.PPNPersen)+"%", pdfgen.Rupiah(q.PPN), false)
	}
	total("TOTAL", pdfgen.Rupiah(q.Total), true)

	if len(q.Terms) > 0 {
		d.MoveDown(0.8)
		d.Font(pdfgen.HelveticaBold, 8.5).Color(pdfMuted)
		d.Text("TERMIN PEMBAYARAN", left, d.Y, pdfgen.TextOpts{})
		d.MoveDown(0.3)
		for _, t := range q.Terms {
			if d.Y+16 > d.Bottom() {
				d.AddPage()
			}
			y := d.Y
			label := t.Label + " (" + pdfgen.Thousands(t.Percent) + "%)"
			if t.DueDate != "" {
				label += " — jatuh tempo " + t.DueDate
			}
			d.Font(pdfgen.Helvetica, 9).Color(pdfText)
			d.Text(label, left, y, pdfgen.TextOpts{Width: colTotal - left - 8})
			d.Font(pdfgen.HelveticaBold, 9)
			d.Text(pdfgen.Rupiah(t.Amount), colTotal, y, alignRight(totalW))
			d.MoveDown(0.25)
		}
	}
	writeClosing(d, q.docHead)
	return d
}

func buildInvoicePDF(inv invoiceDoc) *pdfgen.Doc {
	d := newSalesDoc()
	left, rightX := d.Left(), d.Right()
	writeKop(d, inv.docHead, "INVOICE", "INVOICE")
	reference := "—"
	if truthy(inv.QuoteNumber) {
		reference = *inv.QuoteNumber
	}
	term := "Nominal bebas"
	if inv.TermPercent != nil {
		term = inv.Label + " (" + pdfgen.Thousands(*inv.TermPercent) + "%)"
	}
	writeInfo(d,
		[][2]string{{"Kepada", inv.OrgName}, {"PIC", inv.pic()}, {"Acara", inv.event()}, {"Referensi", reference}},
		[][2]string{{"Tanggal invoice", inv.CreatedAt}, {"Jatuh tempo", inv.DueDate}, {"Termin", term}, {"Tanggal acara", inv.EventDate}})

	colAmount := left + d.ContentWidth()*0.7
	descW, amountW := colAmount-left-8, rightX-colAmount
	tableHead(d, func(y float64) {
		d.Text("KETERANGAN", left, y, pdfgen.TextOpts{Width: descW})
		d.Text("JUMLAH", colAmount, y, alignRight(amountW))
	})
	rowY := d.Y
	d.Font(pdfgen.Helvetica, 9.5).Color(pdfText)
	desc := inv.Label
	if inv.TermPercent != nil {
		desc += " (" + pdfgen.Thousands(*inv.TermPercent) + "% dari nilai kesepakatan)"
	}
	if truthy(inv.QuoteNumber) {
		desc += " — sesuai " + *inv.QuoteNumber
	}
	descHeight := d.HeightOf(desc, descW)
	d.Text(desc, left, rowY, pdfgen.TextOpts{Width: descW})
	d.Font(pdfgen.HelveticaBold, 9.5)
	d.Text(pdfgen.Rupiah(inv.Amount), colAmount, rowY, alignRight(amountW))
	d.Y = rowY + math.Max(descHeight, 12) + 8
	rule(d)
	d.MoveDown(0.4)

	total := func(label, value string, bold bool) {
		totalRow(d, label, value, bold, left, descW, colAmount, amountW)
	}
	if inv.UsePPN && inv.PPNPersen > 0 {
		// The term amount includes PPN: split DPP and PPN out of it.
		dpp := jsmath.Round(inv.Amount / (1 + inv.PPNPersen/100))
		total("DPP", pdfgen.Rupiah(dpp), false)
		total("PPN "+domain.JSNumberString(inv.PPNPersen)+"%", pdfgen.Rupiah(inv.Amount-dpp), false)
	}
	total("TOTAL TAGIHAN", pdfgen.Rupiah(inv.Amount), true)
	if inv.Paid > 0 {
		total("Sudah dibayar", pdfgen.Rupiah(inv.Paid), false)
		total("SISA TAGIHAN", pdfgen.Rupiah(math.Max(0, inv.Amount-inv.Paid)), true)
	}
	writeClosing(d, inv.docHead)
	return d
}
