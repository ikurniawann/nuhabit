package domain

import (
	"sort"
	"time"
)

// Ticketing report aggregation (reports.ts). Money is the NET of the
// ticket_visit_charges ledger; voids are already attributed to the type
// and context of the line they reverse by the query.

// LedgerRow is net per day × effective charge type (debit +, kredit −).
type LedgerRow struct {
	Day     string
	EffType string
	Net     float64
	Qty     float64
}

// TicketContextRow is the ticket net per price context.
type TicketContextRow struct {
	VariantID       *string
	ChannelID       *string
	SeasonKind      *string
	BundleProductID *string
	Net             float64
	Qty             float64
}

// MethodRow is cash per charge type × payment method.
type MethodRow struct {
	ChargeType string  `json:"charge_type"`
	Method     string  `json:"method"`
	Total      float64 `json:"total"`
}

// CountRow is a keyed count (Day is set for gate traffic).
type CountRow struct {
	Day string
	Key string
	N   int
}

// HangingTab is an open visit with a positive outstanding.
type HangingTab struct {
	ID          string  `json:"id"`
	ContactName string  `json:"contact_name"`
	PaymentMode string  `json:"payment_mode"`
	OpenedAt    JSDate  `json:"opened_at"`
	Outstanding float64 `json:"outstanding"`
}

// JSDate marshals like a JS Date in JSON: toISOString in UTC.
type JSDate time.Time

// MarshalJSON writes the toISOString form.
func (t JSDate) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// VariantName labels a variant in the breakdown.
type VariantName struct{ VariantName, ProductName string }

// ReportRows is every query result buildTicketingReport needs.
type ReportRows struct {
	Ledger         []LedgerRow
	TicketContexts []TicketContextRow
	Methods        []MethodRow
	GateDaily      []CountRow
	VisitDaily     []CountRow
	BandsRecap     []CountRow
	Hanging        []HangingTab
	VariantNames   map[string]VariantName
	ChannelNames   map[string]string
	BundleNames    map[string]string
	DepositCount   int
	DepositTotal   float64
	ForfeitedCount int
	ForfeitedTotal float64
}

// Agg is one breakdown line.
type Agg struct {
	Label string  `json:"label"`
	Qty   float64 `json:"qty"`
	Net   float64 `json:"net"`
}

type aggMap struct {
	order []string
	byKey map[string]*Agg
}

func newAggMap() *aggMap { return &aggMap{byKey: map[string]*Agg{}} }

func (m *aggMap) add(key, label string, row TicketContextRow) {
	a, ok := m.byKey[key]
	if !ok {
		a = &Agg{Label: label}
		m.byKey[key] = a
		m.order = append(m.order, key)
	}
	a.Qty += row.Qty
	a.Net += row.Net
}

// finish rounds and sorts by net descending; ties keep insertion order,
// as Array.prototype.sort is stable.
func (m *aggMap) finish() []Agg {
	out := make([]Agg, len(m.order))
	for i, k := range m.order {
		a := *m.byKey[k]
		a.Net = Round2(a.Net)
		out[i] = a
	}
	sort.SliceStable(out, func(i, j int) bool { return out[j].Net < out[i].Net })
	return out
}

// TicketBreakdown is the ticket revenue per product, channel, season and bundle.
type TicketBreakdown struct {
	Products []Agg `json:"products"`
	Channels []Agg `json:"channels"`
	Seasons  []Agg `json:"seasons"`
	Bundles  []Agg `json:"bundles"`
}

func orDash(s *string) string {
	if s == nil {
		return "-"
	}
	return *s
}

func ticketBreakdown(rows ReportRows) TicketBreakdown {
	products, channels, seasons, bundles := newAggMap(), newAggMap(), newAggMap(), newAggMap()
	for _, r := range rows.TicketContexts {
		label := "(tanpa konteks)"
		if r.VariantID != nil {
			if v, ok := rows.VariantNames[*r.VariantID]; ok {
				label = v.ProductName + " — " + v.VariantName
			}
		}
		products.add(orDash(r.VariantID), label, r)

		// (channel_id && name) ?? "(tanpa kanal)": an empty id stays "".
		channelLabel := "(tanpa kanal)"
		if r.ChannelID != nil {
			if *r.ChannelID == "" {
				channelLabel = ""
			} else if name, ok := rows.ChannelNames[*r.ChannelID]; ok {
				channelLabel = name
			}
		}
		channels.add(orDash(r.ChannelID), channelLabel, r)

		hasBundle := r.BundleProductID != nil && *r.BundleProductID != ""
		seasonKey, seasonLabel := "-", "(tanpa musim)"
		switch {
		case r.SeasonKind != nil:
			seasonKey, seasonLabel = *r.SeasonKind, *r.SeasonKind
		case hasBundle:
			seasonKey, seasonLabel = "paket", "alokasi paket"
		}
		seasons.add(seasonKey, seasonLabel, r)

		if hasBundle {
			name, ok := rows.BundleNames[*r.BundleProductID]
			if !ok {
				name = "(paket terhapus)"
			}
			bundles.add(*r.BundleProductID, name, r)
		}
	}
	return TicketBreakdown{Products: products.finish(), Channels: channels.finish(), Seasons: seasons.finish(), Bundles: bundles.finish()}
}

// ReportDay is one day of the daily series.
type ReportDay struct {
	Date      string  `json:"date"`
	Visits    int     `json:"visits"`
	Masuk     int     `json:"masuk"`
	MasukLagi int     `json:"masuk_lagi"`
	TiketNet  float64 `json:"tiket_net"`
	FnbNet    float64 `json:"fnb_net"`
	UangMasuk float64 `json:"uang_masuk"`
}

// ReportSummary is the headline numbers.
type ReportSummary struct {
	VisitsOpened  int     `json:"visits_opened"`
	OrangMasuk    int     `json:"orang_masuk"`
	MasukLagi     int     `json:"masuk_lagi"`
	MasukKaryawan int     `json:"masuk_karyawan"`
	TapDitolak    int     `json:"tap_ditolak"`
	TiketNet      float64 `json:"tiket_net"`
	FnbNet        float64 `json:"fnb_net"`
	DendaNet      float64 `json:"denda_net"`
	UangMasuk     float64 `json:"uang_masuk"`
	RefundKeluar  float64 `json:"refund_keluar"`
	DiskonPromo   float64 `json:"diskon_promo"`
}

// BookingRecognition is deferred (titipan) and forfeited (hangus) revenue.
type BookingRecognition struct {
	TitipanCount int     `json:"titipan_count"`
	TitipanTotal float64 `json:"titipan_total"`
	HangusCount  int     `json:"hangus_count"`
	HangusTotal  float64 `json:"hangus_total"`
}

// BandCount is the current band count per status.
type BandCount struct {
	Status string `json:"status"`
	N      int    `json:"n"`
}

// Report is buildTicketingReport's result.
type Report struct {
	Range struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"range"`
	Summary ReportSummary      `json:"summary"`
	Methods []MethodRow        `json:"methods"`
	Daily   []ReportDay        `json:"daily"`
	Tickets TicketBreakdown    `json:"tickets"`
	Booking BookingRecognition `json:"booking"`
	Bands   []BandCount        `json:"bands"`
	Hanging HangingSummary     `json:"hanging"`
}

// HangingSummary totals the hanging tabs.
type HangingSummary struct {
	Count int          `json:"count"`
	Total float64      `json:"total"`
	Items []HangingTab `json:"items"`
}

// BuildTicketingReport is buildTicketingReport for [from..to].
func BuildTicketingReport(from, to string, rows ReportRows) Report {
	netByType := map[string]float64{}
	type money struct{ tiket, fnb, uang float64 }
	daily := map[string]*money{}
	for _, r := range rows.Ledger {
		netByType[r.EffType] += r.Net
		m, ok := daily[r.Day]
		if !ok {
			m = &money{}
			daily[r.Day] = m
		}
		switch r.EffType {
		case "tiket":
			m.tiket += r.Net
		case "fnb":
			m.fnb += r.Net
		case "deposit", "pembayaran":
			m.uang += -r.Net
		}
	}

	gateByDay := map[string]map[string]int{}
	var masuk, masukLagi, masukKaryawan, ditolak int
	for _, r := range rows.GateDaily {
		if gateByDay[r.Day] == nil {
			gateByDay[r.Day] = map[string]int{}
		}
		gateByDay[r.Day][r.Key] = r.N
		switch r.Key {
		case "masuk":
			masuk += r.N
		case "masuk-lagi":
			masukLagi += r.N
		case "masuk-karyawan":
			masukKaryawan += r.N
		default:
			ditolak += r.N
		}
	}
	visitsByDay := map[string]int{}
	visitsOpened := 0
	for _, r := range rows.VisitDaily {
		visitsByDay[r.Key] = r.N
		visitsOpened += r.N
	}

	var rep Report
	rep.Range.From, rep.Range.To = from, to
	for _, d := range EachDayISO(from, to) {
		day := ReportDay{Date: d, Visits: visitsByDay[d], Masuk: gateByDay[d]["masuk"], MasukLagi: gateByDay[d]["masuk-lagi"]}
		if m, ok := daily[d]; ok {
			day.TiketNet, day.FnbNet, day.UangMasuk = Round2(m.tiket), Round2(m.fnb), Round2(m.uang)
		}
		rep.Daily = append(rep.Daily, day)
	}
	if rep.Daily == nil {
		rep.Daily = []ReportDay{}
	}

	rep.Summary = ReportSummary{
		VisitsOpened: visitsOpened, OrangMasuk: masuk, MasukLagi: masukLagi, MasukKaryawan: masukKaryawan, TapDitolak: ditolak,
		TiketNet:     Round2(netByType["tiket"]),
		FnbNet:       Round2(netByType["fnb"]),
		DendaNet:     Round2(netByType["denda"]),
		UangMasuk:    Round2(-netByType["deposit"] - netByType["pembayaran"]),
		RefundKeluar: Round2(netByType["refund-deposit"]),
		DiskonPromo:  Round2(-netByType["diskon"]),
	}
	rep.Methods = rows.Methods
	if rep.Methods == nil {
		rep.Methods = []MethodRow{}
	}
	rep.Tickets = ticketBreakdown(rows)
	rep.Booking = BookingRecognition{
		TitipanCount: rows.DepositCount, TitipanTotal: Round2(rows.DepositTotal),
		HangusCount: rows.ForfeitedCount, HangusTotal: Round2(rows.ForfeitedTotal),
	}
	rep.Bands = make([]BandCount, len(rows.BandsRecap))
	for i, b := range rows.BandsRecap {
		rep.Bands[i] = BandCount{Status: b.Key, N: b.N}
	}
	total := 0.0
	for _, h := range rows.Hanging {
		total += h.Outstanding
	}
	items := rows.Hanging
	if items == nil {
		items = []HangingTab{}
	}
	rep.Hanging = HangingSummary{Count: len(items), Total: Round2(total), Items: items}
	return rep
}
