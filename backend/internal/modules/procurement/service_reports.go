package procurement

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Port of lib/purchasing/report-po.ts, report-supplier-performance.ts and
// report-production-in-house.ts.

// ReportParams are the shared report query params.
type ReportParams struct {
	DateFrom, DateTo, VendorID, SupplierID, Status *string
	Export                                         string
	// production-in-house
	DateField, OutputType  string
	ProductID, WarehouseID *string
}

var zoneNames = map[string]string{
	"Asia/Jakarta": "Western Indonesia Time", "Asia/Pontianak": "Western Indonesia Time",
	"Asia/Makassar": "Central Indonesia Time", "Asia/Jayapura": "Eastern Indonesia Time",
	"UTC": "Coordinated Universal Time", "Etc/UTC": "Coordinated Universal Time",
}

// jsDateString is String(date) for a node-postgres Date: the local
// Date.prototype.toString form the TS CSV templates print.
func (s *Service) jsDateString(v any) string {
	t, ok := v.(httpx.JSTime)
	if !ok {
		if v == nil {
			return ""
		}
		return jsString(v)
	}
	local := time.Time(t).In(s.loc)
	name := zoneNames[s.loc.String()]
	if name == "" {
		name, _ = local.Zone()
	}
	return local.Format("Mon Jan 02 2006 15:04:05 GMT-0700") + " (" + name + ")"
}

// orJS is `a || b` over the stringified value ("" for null).
func (s *Service) orJS(v any) string {
	if v == nil || v == "" {
		return ""
	}
	return s.jsDateString(v)
}

/* ── PO reports ──────────────────────────────────────────────────────── */

func (s *Service) reportPurchaseOrders(ctx context.Context, p ReportParams) ([]*Row, error) {
	w := newWhere()
	if set(p.DateFrom) {
		w.add("tanggal_po >= %s::text::date", *p.DateFrom)
	}
	if set(p.DateTo) {
		w.add("tanggal_po <= %s::text::date", *p.DateTo)
	}
	if set(p.VendorID) {
		w.add("supplier_id = %s::text::uuid", *p.VendorID)
	}
	if set(p.Status) {
		w.add("status = %s", strings.ToLower(*p.Status))
	}
	return s.rows.Query(ctx, s.db, `SELECT * FROM v_purchase_orders `+w.sql()+` ORDER BY tanggal_po DESC`, w.args...)
}

// poHeader is mapPoHeader (created_by kept apart for the callers' key order).
type poHeader struct {
	PoNumber, Vendor, VendorCode, Status any
	TanggalPo, TanggalDiterima           any
	Amount                               float64
	Currency, CreatedBy                  any
}

func mapPoHeader(po *Row) poHeader {
	amount := firstNumber(po, "total", "total_amount", "payable_amount")
	created := jsOrValues(po.Get("created_by_name"), po.Get("created_by"), "-")
	status := "unknown"
	if v := po.Get("status"); v != nil && v != "" {
		status = strings.ToLower(jsString(v))
	}
	return poHeader{
		PoNumber:   jsOrValues(po.Get("nomor_po"), po.Get("po_number")),
		Vendor:     jsOrValues(po.Get("nama_supplier"), po.Get("supplier_name"), po.Get("vendor_name"), "-"),
		VendorCode: jsOrValues(po.Get("supplier_kode"), po.Get("kode_supplier"), po.Get("supplier_code"), po.Get("vendor_code"), ""),
		Status:     status, TanggalPo: po.Get("tanggal_po"), TanggalDiterima: jsOrValues(po.Get("tanggal_diterima"), nil),
		Amount: amount, Currency: jsOrValues(po.Get("currency"), "IDR"), CreatedBy: created,
	}
}

type statusTotal struct {
	status string
	count  int
	total  float64
}

// summarizeByStatus is summarizePoByStatus (first-seen status order).
func summarizeByStatus(rows []poHeader) ([]*Row, float64) {
	var order []*statusTotal
	byStatus := map[string]*statusTotal{}
	grand := 0.0
	for _, r := range rows {
		grand += r.Amount
		st := r.Status.(string)
		if byStatus[st] == nil {
			byStatus[st] = &statusTotal{status: st}
			order = append(order, byStatus[st])
		}
		byStatus[st].count++
		byStatus[st].total += r.Amount
	}
	out := make([]*Row, len(order))
	for i, st := range order {
		out[i] = obj("status", st.status, "count", st.count, "total", domain.RoundMoney(st.total), "total_formatted", domain.FormatNumberID(st.total, 0))
	}
	return out, grand
}

// PoSummaryReport is buildPoSummary (+ its CSV).
func (s *Service) PoSummaryReport(ctx context.Context, p ReportParams) (any, string, error) {
	pos, err := s.reportPurchaseOrders(ctx, p)
	if err != nil {
		return nil, "", err
	}
	headers := make([]poHeader, len(pos))
	summary := make([]*Row, len(pos))
	for i, po := range pos {
		h := mapPoHeader(po)
		headers[i] = h
		summary[i] = obj("po_number", h.PoNumber, "vendor", h.Vendor, "vendor_code", h.VendorCode, "status", h.Status,
			"tanggal_po", h.TanggalPo, "tanggal_diterima", h.TanggalDiterima, "total_amount", h.Amount,
			"total_amount_formatted", domain.FormatNumberID(h.Amount, 0), "mata_uang", h.Currency,
			"item_count", toNum(jsOrValues(po.Get("item_count"), po.Get("total_items"))), "created_by", h.CreatedBy)
	}
	byStatus, grand := summarizeByStatus(headers)
	report := obj("summary", summary, "by_status", byStatus, "grand_total", domain.RoundMoney(grand))
	if p.Export != "csv" {
		return report, "", nil
	}
	var b strings.Builder
	b.WriteString("PO Number,Vendor,Vendor Code,Status,Tanggal PO,Tanggal Diterima,Total Amount,Mata Uang,Item Count,Created By\n")
	for i, h := range headers {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(s.orJS(h.PoNumber) + `,"` + s.orJS(h.Vendor) + `",` + s.orJS(h.VendorCode) + "," + jsString(h.Status) + "," +
			s.orJS(h.TanggalPo) + "," + s.orJS(h.TanggalDiterima) + "," + formatJSNumber(h.Amount) + "," + s.orJS(h.Currency) + "," +
			formatJSNumber(summary[i].Get("item_count").(float64)) + `,"` + s.orJS(h.CreatedBy) + `"`)
	}
	return nil, b.String(), nil
}

// PoDetailReport is buildPoDetail (+ its CSV rows).
func (s *Service) PoDetailReport(ctx context.Context, p ReportParams) (any, [][]string, error) {
	pos, err := s.reportPurchaseOrders(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	if len(pos) == 0 {
		return obj("summary", []*Row{}, "by_status", []*Row{}, "grand_total", 0, "grand_total_formatted", "0"), nil, nil
	}
	items, err := s.rows.Query(ctx, s.db, `SELECT id, purchase_order_id, raw_material_id, product_id, qty_ordered, qty_received, harga_satuan, subtotal, satuan_id
		FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[]) AND is_active = true`, column(pos, "id"))
	if err != nil {
		return nil, nil, err
	}
	refs := map[Entity]map[string]*Row{}
	for _, ref := range []struct {
		e   Entity
		key string
	}{{EntityRawMaterial, "raw_material_id"}, {EntityProduct, "product_id"}, {EntityUnit, "satuan_id"}} {
		m, err := s.ports.Catalog.Refs(ctx, s.db, ref.e, "id, kode, nama", uniqueStrings(column(items, ref.key)))
		if err != nil {
			return nil, nil, err
		}
		refs[ref.e] = map[string]*Row{}
		for id, raw := range m {
			if refs[ref.e][id], err = decodeRow(raw); err != nil {
				return nil, nil, err
			}
		}
	}
	field := func(r *Row, key string) any {
		if r == nil {
			return nil
		}
		return r.Get(key)
	}
	byPo := map[string][]*Row{}
	for _, it := range items {
		rm, pr, unit := refs[EntityRawMaterial][it.Str("raw_material_id")], refs[EntityProduct][it.Str("product_id")], refs[EntityUnit][it.Str("satuan_id")]
		qty, harga := it.Num("qty_ordered"), it.Num("harga_satuan")
		subtotal := it.Num("subtotal")
		if subtotal == 0 {
			subtotal = qty * harga
		}
		byPo[it.Str("purchase_order_id")] = append(byPo[it.Str("purchase_order_id")], obj(
			"id", jsOrValues(it.Get("id"), it.Get("raw_material_id"), it.Get("product_id")),
			"nama_bahan", jsOrValues(field(rm, "nama"), field(pr, "nama"), "-"),
			"kode_bahan", jsOrValues(field(rm, "kode"), field(pr, "kode"), ""),
			"qty_order", qty, "qty_received", it.Num("qty_received"), "harga_satuan", harga,
			"satuan", jsOrValues(field(unit, "nama"), field(unit, "kode"), ""), "subtotal", subtotal))
	}
	headers := make([]poHeader, len(pos))
	detailed := make([]*Row, len(pos))
	var csv [][]string
	for i, po := range pos {
		h := mapPoHeader(po)
		headers[i] = h
		list := byPo[po.Str("id")]
		if list == nil {
			list = []*Row{}
		}
		detailed[i] = obj("id", po.Get("id"), "po_number", h.PoNumber, "vendor", h.Vendor, "vendor_code", h.VendorCode, "status", h.Status,
			"tanggal_po", h.TanggalPo, "tanggal_diterima", h.TanggalDiterima, "total_amount", h.Amount,
			"total_amount_formatted", domain.FormatNumberID(h.Amount, 0), "mata_uang", h.Currency,
			"supplier_id", po.Get("supplier_id"), "item_count", len(list), "created_by", h.CreatedBy, "items", list)
		head := func(first bool) []string {
			if !first {
				return []string{"", "", "", "", ""}
			}
			return []string{s.orJS(h.PoNumber), s.orJS(h.TanggalPo), s.orJS(h.Vendor), s.orJS(h.VendorCode), jsString(h.Status)}
		}
		tail := func(first bool) []string {
			if !first {
				return []string{"", "", ""}
			}
			return []string{formatJSNumber(h.Amount), s.orJS(h.Currency), s.orJS(h.CreatedBy)}
		}
		if len(list) == 0 {
			csv = append(csv, append(append(head(true), "-", "-", "", "", "", ""), tail(true)...))
			continue
		}
		for j, it := range list {
			row := append(head(j == 0), jsString(it.Get("nama_bahan")), s.orJS(it.Get("kode_bahan")),
				formatJSNumber(it.Num("qty_order")), formatJSNumber(it.Num("qty_received")),
				formatJSNumber(it.Num("harga_satuan")), formatJSNumber(it.Num("subtotal")))
			csv = append(csv, append(row, tail(j == 0)...))
		}
	}
	byStatus, grand := summarizeByStatus(headers)
	return obj("summary", detailed, "by_status", byStatus, "grand_total", domain.RoundMoney(grand),
		"grand_total_formatted", domain.FormatNumberID(grand, 0)), csv, nil
}

// quotedCSV is quotedCsv.
func quotedCSV(header []string, rows [][]string) string {
	lines := make([]string, 0, len(rows)+1)
	h := make([]string, len(header))
	for i, v := range header {
		h[i] = `"` + v + `"`
	}
	lines = append(lines, strings.Join(h, ","))
	for _, r := range rows {
		cells := make([]string, len(r))
		for i, v := range r {
			cells[i] = `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
		}
		lines = append(lines, strings.Join(cells, ","))
	}
	return strings.Join(lines, "\n")
}

var poDetailCSVHeader = []string{"No PO", "Tanggal", "Supplier", "Supplier Code", "Status", "Nama Bahan", "Kode Bahan",
	"Qty Order", "Qty Diterima", "Harga Satuan", "Subtotal", "Total PO", "Mata Uang", "Created By"}

/* ── Supplier performance ────────────────────────────────────────────── */

type spAgg struct {
	totalPo, completedPo, onTime, late int
	value, accepted, rejected          float64
	lead                               []float64
}

// localDate parses a YYYY-MM-DD (or timestamp) text as a local Date.
func (s *Service) localDate(v string) (time.Time, bool) {
	if v == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02", v[:min(10, len(v))], s.loc)
	return t, err == nil
}

func daysBetween(from, to time.Time) float64 {
	return max(0, to.Sub(from).Hours()/24)
}

func round1(v float64) float64 { return domain.JSRound(v*10) / 10 }

// SupplierPerformance is rankSupplierPerformance over the loaders; nil
// means "no suppliers" (the empty summary).
func (s *Service) SupplierPerformance(ctx context.Context, p ReportParams) ([]*Row, error) {
	w := newWhere().add("is_active = true").add("deleted_at IS NULL")
	if set(p.SupplierID) {
		w.add("id = %s::text::uuid", *p.SupplierID)
	}
	suppliers, err := s.rows.Query(ctx, s.db, `SELECT id, kode, nama_supplier, pic_name, telepon, pic_phone, email FROM suppliers `+w.sql()+` ORDER BY nama_supplier ASC`, w.args...)
	if err != nil || len(suppliers) == 0 {
		return nil, err
	}
	pw := newWhere().add("supplier_id = ANY(%s::uuid[])", column(suppliers, "id")).add("is_active = true").add("deleted_at IS NULL")
	if set(p.DateFrom) {
		pw.add("tanggal_po >= %s::text::date", *p.DateFrom)
	}
	if set(p.DateTo) {
		pw.add("tanggal_po <= %s::text::date", *p.DateTo)
	}
	pos, err := s.rows.Query(ctx, s.db, `SELECT id, supplier_id, status, total::float8 AS total, tanggal_po::text AS tanggal_po,
		tanggal_dibutuhkan::text AS tanggal_dibutuhkan, tanggal_kirim_estimasi::text AS tanggal_kirim_estimasi FROM purchase_orders `+pw.sql(), pw.args...)
	if err != nil {
		return nil, err
	}
	var activeIDs []string
	poByID := map[string]*Row{}
	for _, po := range pos {
		if strings.ToLower(po.Str("status")) != domain.PoCancelled {
			activeIDs = append(activeIDs, po.Str("id"))
			poByID[po.Str("id")] = po
		}
	}
	var deliveries, grns []*Row
	if len(activeIDs) > 0 {
		if deliveries, err = s.rows.Query(ctx, s.db, `SELECT purchase_order_id, supplier_id, tanggal_aktual_tiba::text AS arrived, tanggal_estimasi_tiba::text AS eta
			FROM deliveries WHERE purchase_order_id = ANY($1::uuid[]) AND is_active = true`, activeIDs); err != nil {
			return nil, err
		}
		if grns, err = s.rows.Query(ctx, s.db, `SELECT id, purchase_order_id, supplier_id, tanggal_penerimaan::text AS received,
			total_item_diterima::float8 AS diterima, total_item_ditolak::float8 AS ditolak
			FROM grn WHERE purchase_order_id = ANY($1::uuid[]) AND is_active = true`, activeIDs); err != nil {
			return nil, err
		}
	}
	qc := map[string][2]float64{}
	if len(grns) > 0 {
		rows, err := s.rows.Query(ctx, s.db, `SELECT qc.grn_id, COALESCE(SUM(i.qty_inspected), 0)::float8 AS inspected, COALESCE(SUM(i.qty_rejected), 0)::float8 AS rejected
			FROM grn_qc_inspections qc LEFT JOIN grn_qc_inspection_items i ON i.qc_inspection_id = qc.id
			WHERE qc.grn_id = ANY($1::uuid[]) GROUP BY qc.id, qc.grn_id`, column(grns, "id"))
		if err == nil {
			for _, r := range rows {
				qc[r.Str("grn_id")] = [2]float64{r.Num("inspected"), r.Num("rejected")}
			}
		}
	}

	aggs := map[string]*spAgg{}
	for _, sup := range suppliers {
		aggs[sup.Str("id")] = &spAgg{}
	}
	aggFor := func(own string, po *Row) *spAgg {
		id := own
		if id == "" && po != nil {
			id = po.Str("supplier_id")
		}
		return aggs[id]
	}
	timing := func(a *spAgg, arrived, deadline time.Time) {
		if !arrived.After(deadline) {
			a.onTime++
		} else {
			a.late++
		}
	}
	firstDate := func(values ...string) (time.Time, bool) {
		for _, v := range values {
			if t, ok := s.localDate(v); ok {
				return t, true
			}
		}
		return time.Time{}, false
	}
	poField := func(po *Row, key string) string {
		if po == nil {
			return ""
		}
		return po.Str(key)
	}
	for _, id := range activeIDs {
		po := poByID[id]
		a := aggs[po.Str("supplier_id")]
		if a == nil {
			continue
		}
		a.totalPo++
		a.value += po.Num("total")
		switch strings.ToLower(po.Str("status")) {
		case "received", "partially_received", "partial":
			a.completedPo++
		}
	}
	timedPo := map[string]bool{}
	for _, d := range deliveries {
		po := poByID[d.Str("purchase_order_id")]
		a := aggFor(d.Str("supplier_id"), po)
		if d.Str("arrived") != "" {
			timedPo[d.Str("purchase_order_id")] = true
		}
		if a == nil {
			continue
		}
		start, okStart := s.localDate(poField(po, "tanggal_po"))
		arrived, okArrived := s.localDate(d.Str("arrived"))
		if okStart && okArrived {
			a.lead = append(a.lead, daysBetween(start, arrived))
		}
		if deadline, ok := firstDate(d.Str("eta"), poField(po, "tanggal_dibutuhkan"), poField(po, "tanggal_kirim_estimasi")); ok && okArrived {
			timing(a, arrived, deadline)
		}
	}
	for _, g := range grns {
		po := poByID[g.Str("purchase_order_id")]
		a := aggFor(g.Str("supplier_id"), po)
		if a == nil {
			continue
		}
		if q, ok := qc[g.Str("id")]; ok && q[0] > 0 {
			a.accepted += max(0, q[0]-q[1])
			a.rejected += q[1]
		} else {
			a.accepted += g.Num("diterima")
			a.rejected += g.Num("ditolak")
		}
		received, ok := s.localDate(g.Str("received"))
		if timedPo[g.Str("purchase_order_id")] || !ok {
			continue
		}
		if start, okStart := s.localDate(poField(po, "tanggal_po")); okStart {
			a.lead = append(a.lead, daysBetween(start, received))
		}
		if deadline, ok := firstDate(poField(po, "tanggal_dibutuhkan"), poField(po, "tanggal_kirim_estimasi")); ok {
			timing(a, received, deadline)
		}
	}

	type ranked struct {
		row   *Row
		value float64
	}
	var list []ranked
	for _, sup := range suppliers {
		a := aggs[sup.Str("id")]
		if a == nil || a.totalPo == 0 {
			continue
		}
		var onTime, onTimeRounded, avgLead any
		onTimeRate := 50.0
		if timed := a.onTime + a.late; timed > 0 {
			onTimeRate = float64(a.onTime) / float64(timed) * 100
			onTime, onTimeRounded = onTimeRate, round1(onTimeRate)
		}
		_ = onTime
		inspected := a.accepted + a.rejected
		reject := 0.0
		if inspected > 0 {
			reject = a.rejected / inspected * 100
		}
		quality := 40.0
		switch {
		case reject == 0:
			quality = 100
		case reject < 5:
			quality = 80
		case reject < 10:
			quality = 60
		}
		if len(a.lead) > 0 {
			sum := 0.0
			for _, d := range a.lead {
				sum += d
			}
			avgLead = round1(sum / float64(len(a.lead)))
		}
		telepon := jsOrValues(sup.Get("telepon"), sup.Get("pic_phone"))
		list = append(list, ranked{value: a.value, row: obj(
			"id", sup.Get("id"), "vendor_id", sup.Get("id"), "supplier_id", sup.Get("id"),
			"supplier_code", sup.Get("kode"), "vendor_code", sup.Get("kode"),
			"supplier_name", sup.Get("nama_supplier"), "vendor_name", sup.Get("nama_supplier"),
			"contact_person", sup.Get("pic_name"), "telepon", telepon, "email", sup.Get("email"),
			"total_po", a.totalPo, "completed_po", a.completedPo, "approved_po", a.completedPo,
			"on_time_count", a.onTime, "late_count", a.late, "on_time_rate", onTimeRounded, "on_time_delivery_rate", onTimeRounded,
			"reject_rate", domain.RoundMoney(reject), "avg_lead_time_days", avgLead,
			"total_value", domain.RoundMoney(a.value), "total_spent", domain.RoundMoney(a.value),
			"total_spent_formatted", domain.FormatNumberID(a.value, 0), "avg_po_value", domain.RoundMoney(a.value/float64(a.totalPo)),
			"quality_score", quality, "rating", round1((onTimeRate*0.5+quality*0.5)/20))})
	}
	sort.SliceStable(list, func(i, j int) bool {
		return list[i].row.Get("total_value").(float64) > list[j].row.Get("total_value").(float64)
	})
	out := make([]*Row, len(list))
	for i, r := range list {
		out[i] = r.row.Set("rank", i+1)
	}
	return out, nil
}

// supplierPerformanceCSV is supplierPerformanceCsv.
func supplierPerformanceCSV(ranked []*Row) string {
	var b strings.Builder
	b.WriteString("Rank,Kode,Supplier,PIC,Telepon,Email,Total PO,On-Time,Terlambat,On-Time %,Reject %,Lead Time (Hari),Total Nilai,Rating,Quality Score\n")
	str := func(v any) string {
		if v == nil || v == "" {
			return ""
		}
		return jsString(v)
	}
	num := func(v any) string {
		if v == nil {
			return ""
		}
		return formatJSNumber(toNum(v))
	}
	for i, v := range ranked {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(strconv.Itoa(v.Get("rank").(int)) + "," + str(v.Get("supplier_code")) + `,"` + str(v.Get("supplier_name")) + `","` +
			str(v.Get("contact_person")) + `","` + str(v.Get("telepon")) + `","` + str(v.Get("email")) + `",` +
			strconv.Itoa(v.Get("total_po").(int)) + "," + strconv.Itoa(v.Get("on_time_count").(int)) + "," + strconv.Itoa(v.Get("late_count").(int)) + "," +
			num(v.Get("on_time_rate")) + "," + num(v.Get("reject_rate")) + "," + num(v.Get("avg_lead_time_days")) + "," +
			num(v.Get("total_value")) + "," + num(v.Get("rating")) + "," + num(v.Get("quality_score")))
	}
	return b.String()
}

// supplierPerformanceSummary is supplierPerformanceSummary.
func supplierPerformanceSummary(ranked []*Row, p ReportParams) *Row {
	total := 0.0
	var top any
	for _, r := range ranked {
		total += r.Get("total_value").(float64)
	}
	if len(ranked) > 0 {
		top = jsOrValues(ranked[0].Get("supplier_name"), nil)
	}
	total = domain.RoundMoney(total)
	return obj("summary", obj("total_suppliers", len(ranked), "total_vendors", len(ranked),
		"period", periodOf(p), "top_supplier", top, "top_vendor", top,
		"total_spend_all_suppliers", total, "total_spend_all_vendors", total),
		"vendors", ranked, "suppliers", ranked)
}

// periodOf is { from: date_from, to: date_to } with undefined keys dropped.
func periodOf(p ReportParams) *Row {
	r := newRow()
	if p.DateFrom != nil {
		r.Set("from", *p.DateFrom)
	}
	if p.DateTo != nil {
		r.Set("to", *p.DateTo)
	}
	return r
}

/* ── Production in-house ─────────────────────────────────────────────── */

var emptyProductionReport = obj("orders", []*Row{}, "by_status", []*Row{}, "summary", obj("total_orders", 0,
	"total_planned_qty", 0, "total_actual_qty", 0, "total_hpp_value", 0, "completed_orders", 0))

func round3(v float64) float64 { return domain.JSRound(v*1000) / 1000 }

// ProductionInHouse is buildProductionInHouseReport over the loaders; the
// CSV rows come back when export=csv.
func (s *Service) ProductionInHouse(ctx context.Context, p ReportParams) (*Row, [][]string, error) {
	var productIDs []string
	if set(p.WarehouseID) {
		ids, err := s.ports.Production.WarehouseProductIDs(ctx, s.db, *p.WarehouseID)
		if err != nil {
			return nil, nil, err
		}
		if len(ids) == 0 {
			return emptyProductionReport, nil, nil
		}
		productIDs = ids
	}
	rows, err := s.ports.Production.Orders(ctx, s.db, ProductionFilter{DateFrom: p.DateFrom, DateTo: p.DateTo, Status: p.Status,
		ProductID: p.ProductID, DateField: p.DateField, OutputType: p.OutputType, ProductIDs: productIDs})
	if err != nil {
		return nil, nil, err
	}
	warehouses, err := s.ports.Production.ProductWarehouses(ctx, s.db, uniqueStrings(column(rows, "product_id")))
	if err != nil {
		return nil, nil, err
	}
	type bucket struct {
		status        string
		count         int
		qty, hppValue float64
	}
	var buckets []*bucket
	byStatus := map[string]*bucket{}
	var planned, actual, hppTotal float64
	completed := 0
	orders := make([]*Row, len(rows))
	var csv [][]string
	for i, r := range rows {
		plannedQty, actualQty, hpp := r.Num("planned_qty"), r.Num("actual_qty"), r.Num("hpp_per_unit")
		material := r.Num("planned_material_cost")
		if r.Get("actual_material_cost") != nil {
			material = r.Num("actual_material_cost")
		}
		overhead, labor, packaging, waste := r.Num("overhead_cost"), r.Num("labor_cost"), r.Num("packaging_cost"), r.Num("waste_cost")
		value := material + overhead + labor + packaging + waste
		if actualQty > 0 && hpp > 0 {
			value = actualQty * hpp
		}
		status := "UNKNOWN"
		if v := r.Get("status"); v != nil && v != "" {
			status = strings.ToUpper(jsString(v))
		}
		var wid, wname, wcode any
		if w, ok := warehouses[r.Str("product_id")]; ok && r.Str("product_id") != "" {
			wid, wname, wcode = w.Get("warehouse_id"), w.Get("warehouse_name"), w.Get("warehouse_code")
		}
		orders[i] = obj("id", r.Get("id"), "nomor_produksi", r.Get("nomor_produksi"), "product_id", r.Get("product_id"),
			"product_kode", jsOrValues(r.Get("product_kode"), r.Get("item_kode"), ""),
			"product_nama", jsOrValues(r.Get("product_nama"), r.Get("item_nama"), "-"),
			"output_type", jsOrValues(r.Get("output_type"), "FINISHED_GOOD"), "status", status,
			"planned_qty", plannedQty, "actual_qty", actualQty, "hpp_per_unit", hpp, "hpp_per_unit_formatted", domain.FormatNumberID(hpp, 0),
			"actual_material_cost", material, "overhead_cost", overhead, "labor_cost", labor, "packaging_cost", packaging, "waste_cost", waste,
			"total_hpp_value", domain.RoundMoney(value), "total_hpp_value_formatted", domain.FormatNumberID(value, 0),
			"warehouse_id", wid, "warehouse_name", wname, "warehouse_code", wcode,
			"created_at", r.Get("created_at"), "started_at", r.Get("started_at"), "completed_at", r.Get("completed_at"))
		planned += plannedQty
		actual += actualQty
		hppTotal += value
		if status == "COMPLETED" {
			completed++
		}
		b := byStatus[status]
		if b == nil {
			b = &bucket{status: status}
			byStatus[status] = b
			buckets = append(buckets, b)
		}
		b.count++
		b.qty += actualQty
		b.hppValue += value
		csv = append(csv, []string{s.orJS(r.Get("nomor_produksi")), jsString(orders[i].Get("product_kode")), jsString(orders[i].Get("product_nama")),
			jsString(orders[i].Get("output_type")), status, formatJSNumber(plannedQty), formatJSNumber(actualQty), formatJSNumber(hpp),
			formatJSNumber(domain.RoundMoney(value)), s.orJS(jsOrValues(wname, wcode, "")), s.orJS(r.Get("created_at")), s.orJS(r.Get("completed_at"))})
	}
	sort.SliceStable(buckets, func(i, j int) bool { return buckets[i].count > buckets[j].count })
	statusRows := make([]*Row, len(buckets))
	for i, b := range buckets {
		statusRows[i] = obj("status", b.status, "count", b.count, "actual_qty", round3(b.qty), "hpp_value", domain.RoundMoney(b.hppValue),
			"hpp_value_formatted", domain.FormatNumberID(b.hppValue, 0))
	}
	report := obj("orders", orders, "by_status", statusRows, "summary", obj("total_orders", len(orders),
		"total_planned_qty", round3(planned), "total_actual_qty", round3(actual), "total_hpp_value", domain.RoundMoney(hppTotal),
		"completed_orders", completed))
	if p.Export != "csv" {
		csv = nil
	} else if csv == nil {
		csv = [][]string{}
	}
	return report, csv, nil
}

var productionCSVHeader = []string{"No Produksi", "Produk Kode", "Produk Nama", "Output Type", "Status", "Qty Planned", "Qty Actual",
	"HPP / Unit", "Total HPP", "Stall", "Created At", "Completed At"}
