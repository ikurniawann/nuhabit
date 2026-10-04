package insights

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/jsmath"
)

// Executive dashboard (app/api/dashboard/executive, lib/dashboard/
// executive.ts and gym-pulse.ts): the desktop overview (a port) plus 14-day
// trend, top products, stock value, purchasing, payroll, contracts, outlet
// split, month to date and the gym pulse. Every section fails on its own:
// a failed query leaves it null and names it in gagal. Results without
// failures are cached in memory for 60 seconds.

const executiveTTL = 60 * time.Second

type trendPoint struct {
	Tanggal string  `json:"tanggal"`
	Omzet   float64 `json:"omzet"`
	Pesanan float64 `json:"pesanan"`
}

type topProduct struct {
	Produk string  `json:"produk"`
	Qty    float64 `json:"qty"`
	Omzet  float64 `json:"omzet"`
}

type statusCount struct {
	Status string  `json:"status"`
	Jumlah float64 `json:"jumlah"`
}

type purchasingMonth struct {
	JumlahPo   float64       `json:"jumlahPo"`
	NilaiTotal float64       `json:"nilaiTotal"`
	PerStatus  []statusCount `json:"perStatus"`
}

type payrollLast struct {
	RunName  string  `json:"runName"`
	Periode  string  `json:"periode"`
	Status   string  `json:"status"`
	TotalNet float64 `json:"totalNet"`
	PaidAt   *string `json:"paidAt"`
}

type outletSales struct {
	Outlet         string  `json:"outlet"`
	OmzetHariIni   float64 `json:"omzetHariIni"`
	PesananHariIni float64 `json:"pesananHariIni"`
	Omzet7Hari     float64 `json:"omzet7Hari"`
}

type monthToDate struct {
	Omzet   float64 `json:"omzet"`
	Pesanan float64 `json:"pesanan"`
}

type gymSession struct {
	ID        string  `json:"id"`
	Kelas     string  `json:"kelas"`
	Coach     *string `json:"coach"`
	Mulai     string  `json:"mulai"`
	Terisi    float64 `json:"terisi"`
	Kapasitas float64 `json:"kapasitas"`
	Waitlist  float64 `json:"waitlist"`
	Status    string  `json:"status"`
}

type gymPulse struct {
	KelasHariIni          int          `json:"kelasHariIni"`
	BookingHariIni        float64      `json:"bookingHariIni"`
	CheckinHariIni        float64      `json:"checkinHariIni"`
	IsiKelasPersen        float64      `json:"isiKelasPersen"`
	WaitlistHariIni       float64      `json:"waitlistHariIni"`
	PaketTerjual30Hari    float64      `json:"paketTerjual30Hari"`
	PendapatanPaket30Hari float64      `json:"pendapatanPaket30Hari"`
	KreditBeredar         float64      `json:"kreditBeredar"`
	Sesi                  []gymSession `json:"sesi"`
}

type executiveDashboard struct {
	DibuatPada         string           `json:"dibuatPada"`
	Overview           json.RawMessage  `json:"overview"`
	Tren14Hari         []trendPoint     `json:"tren14Hari"`
	TopProduk7Hari     []topProduct     `json:"topProduk7Hari"`
	NilaiPersediaan    *float64         `json:"nilaiPersediaan"`
	PurchasingBulanIni *purchasingMonth `json:"purchasingBulanIni"`
	PayrollTerakhir    *payrollLast     `json:"payrollTerakhir"`
	KontrakHabis30Hari *float64         `json:"kontrakHabis30Hari"`
	OmzetPerOutlet     []outletSales    `json:"omzetPerOutlet"`
	BulanBerjalan      *monthToDate     `json:"bulanBerjalan"`
	Gym                *gymPulse        `json:"gym"`
	Gagal              []string         `json:"gagal"`
}

type executiveCached struct {
	at     time.Time
	data   executiveDashboard
	target domain.SalesTarget
}

type executiveResponse struct {
	Data   executiveDashboard `json:"data"`
	Target domain.SalesTarget `json:"target"`
	Cached bool               `json:"cached"`
}

func (s *Service) executive(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.auth.RequireMenuPrefix(r, iam.Dashboard...); err != nil {
		return err
	}
	s.execMu.Lock()
	c := s.execCache
	s.execMu.Unlock()
	if c != nil && s.now().Sub(c.at) < executiveTTL {
		return httpx.JSON(w, http.StatusOK, executiveResponse{Data: c.data, Target: c.target, Cached: true})
	}

	ctx := r.Context()
	var (
		data      executiveDashboard
		dataErr   error
		raw       *string
		targetErr error
	)
	s.parallel(
		func() { data, dataErr = s.buildExecutive(ctx) },
		func() {
			targetErr = s.db.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, domain.SalesTargetSettingKey).Scan(&raw)
			if database.IsNoRows(targetErr) {
				targetErr = nil
			}
		},
	)
	if dataErr != nil {
		return dataErr
	}
	if targetErr != nil {
		return targetErr
	}
	target := domain.ParseSalesTarget(raw)
	if len(data.Gagal) == 0 {
		s.execMu.Lock()
		s.execCache = &executiveCached{at: s.now(), data: data, target: target}
		s.execMu.Unlock()
	}
	return httpx.JSON(w, http.StatusOK, executiveResponse{Data: data, Target: target})
}

// todayJakarta is the WIB calendar date (lib/desktop/overview todayJakarta).
func todayJakarta(now time.Time) string { return now.In(domain.WIB).Format("2006-01-02") }

func (s *Service) buildExecutive(ctx context.Context) (executiveDashboard, error) {
	today := todayJakarta(s.now())
	d := executiveDashboard{DibuatPada: domain.ISO(s.now())}
	var (
		overviewGagal []string
		overviewErr   error
		failed        = make([]bool, 9)
	)
	// section records a failure; ok results are stored by the closure.
	section := func(i int, fn func() error) func() {
		return func() {
			if err := fn(); err != nil {
				s.log.ErrorContext(ctx, "dashboard executive: section failed", "section", executiveSections[i], "error", err)
				failed[i] = true
			}
		}
	}
	s.parallel(
		func() { d.Overview, overviewGagal, overviewErr = s.ports.Overview.Build(ctx) },
		section(0, func() (err error) { d.Tren14Hari, err = s.trend14(ctx, today); return }),
		section(1, func() (err error) { d.TopProduk7Hari, err = s.topProducts(ctx, today); return }),
		section(2, func() (err error) { d.NilaiPersediaan, err = s.inventoryValue(ctx); return }),
		section(3, func() (err error) { d.PurchasingBulanIni, err = s.purchasingMonth(ctx, today); return }),
		section(4, func() (err error) { d.PayrollTerakhir, err = s.payrollLast(ctx); return }),
		section(5, func() (err error) { d.KontrakHabis30Hari, err = s.expiringContracts(ctx, today); return }),
		section(6, func() (err error) { d.OmzetPerOutlet, err = s.outletBreakdown(ctx, today); return }),
		section(7, func() (err error) { d.BulanBerjalan, err = s.monthToDate(ctx, today); return }),
		section(8, func() (err error) { d.Gym, err = s.gymPulse(ctx, today); return }),
	)
	if overviewErr != nil {
		return d, overviewErr
	}
	d.Gagal = []string{}
	for i, f := range failed {
		if f {
			d.Gagal = append(d.Gagal, executiveSections[i])
		}
	}
	for _, g := range overviewGagal {
		d.Gagal = append(d.Gagal, "overview:"+g)
	}
	return d, nil
}

var executiveSections = []string{"tren14", "topProduk", "nilaiPersediaan", "purchasing", "payroll", "kontrak", "outlet", "bulanBerjalan", "gym"}

// trend14 fills the 14 WIB days ending today; days without orders are 0.
func (s *Service) trend14(ctx context.Context, today string) ([]trendPoint, error) {
	rows, err := s.db.Query(ctx, `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS tanggal,
	        COALESCE(sum(total_amount), 0)::float8 AS omzet,
	        count(*)::int AS pesanan
	   FROM pos.pos_orders
	  WHERE created_at >= ($1::date - interval '13 days')
	    AND created_at < ($1::date + interval '1 day')
	    AND status <> 'cancelled'
	    AND voided_at IS NULL
	  GROUP BY 1
	  ORDER BY 1`, today)
	if err != nil {
		return nil, err
	}
	byDate := map[string]trendPoint{}
	var p trendPoint
	if _, err := pgx.ForEachRow(rows, []any{&p.Tanggal, &p.Omzet, &p.Pesanan}, func() error {
		byDate[p.Tanggal] = p
		return nil
	}); err != nil {
		return nil, err
	}
	day, _ := time.Parse("2006-01-02", today)
	out := make([]trendPoint, 0, 14)
	for i := 13; i >= 0; i-- {
		t := day.AddDate(0, 0, -i).Format("2006-01-02")
		row := byDate[t]
		out = append(out, trendPoint{Tanggal: t, Omzet: row.Omzet, Pesanan: row.Pesanan})
	}
	return out, nil
}

func (s *Service) topProducts(ctx context.Context, today string) ([]topProduct, error) {
	rows, err := s.db.Query(ctx, `SELECT i.product_name AS produk,
	        COALESCE(sum(i.quantity), 0)::float8 AS qty,
	        COALESCE(sum(i.total_amount), 0)::float8 AS omzet
	   FROM pos.pos_order_items i
	   JOIN pos.pos_orders o ON o.id = i.order_id
	  WHERE o.created_at >= ($1::date - interval '6 days')
	    AND o.created_at < ($1::date + interval '1 day')
	    AND o.status <> 'cancelled'
	    AND o.voided_at IS NULL
	  GROUP BY 1
	  ORDER BY omzet DESC
	  LIMIT 5`, today)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (topProduct, error) {
		var p topProduct
		return p, row.Scan(&p.Produk, &p.Qty, &p.Omzet)
	})
}

func (s *Service) inventoryValue(ctx context.Context) (*float64, error) {
	var v float64
	err := s.db.QueryRow(ctx, `SELECT COALESCE(sum(qty_available * unit_cost), 0)::float8 AS nilai
	   FROM inventory.inventory
	  WHERE is_active`).Scan(&v)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Service) purchasingMonth(ctx context.Context, today string) (*purchasingMonth, error) {
	rows, err := s.db.Query(ctx, `SELECT status, count(*)::int AS jumlah,
	        COALESCE(sum(total), 0)::float8 AS nilai
	   FROM purchase_orders
	  WHERE created_at >= date_trunc('month', $1::date)
	    AND created_at < (date_trunc('month', $1::date) + interval '1 month')
	    AND status <> 'cancelled'
	  GROUP BY status
	  ORDER BY jumlah DESC`, today)
	if err != nil {
		return nil, err
	}
	out := &purchasingMonth{PerStatus: []statusCount{}}
	var c statusCount
	var nilai float64
	if _, err := pgx.ForEachRow(rows, []any{&c.Status, &c.Jumlah, &nilai}, func() error {
		out.JumlahPo += c.Jumlah
		out.NilaiTotal += nilai
		out.PerStatus = append(out.PerStatus, c)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

var monthNamesID = []string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

func (s *Service) payrollLast(ctx context.Context) (*payrollLast, error) {
	var p payrollLast
	var month, year *int
	err := s.db.QueryRow(ctx, `SELECT run_name, period_month, period_year, status,
	        COALESCE(total_net, 0)::float8 AS total_net, paid_at::text
	   FROM payroll_runs
	  ORDER BY period_year DESC, period_month DESC, created_at DESC
	  LIMIT 1`).Scan(&p.RunName, &month, &year, &p.Status, &p.TotalNet, &p.PaidAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// MONTH_NAMES[(month - 1 + 12) % 12] with JS null arithmetic (null is 0).
	name, yearText := "undefined", "null"
	m := 0
	if month != nil {
		m = *month
	}
	if i := (m - 1 + 12) % 12; i >= 0 {
		name = monthNamesID[i]
	}
	if year != nil {
		yearText = strconv.Itoa(*year)
	}
	p.Periode = name + " " + yearText
	return &p, nil
}

func (s *Service) expiringContracts(ctx context.Context, today string) (*float64, error) {
	var n float64
	err := s.db.QueryRow(ctx, `SELECT count(*)::int AS jumlah
	   FROM hris.employment_contracts
	  WHERE status = 'active'
	    AND end_date IS NOT NULL
	    AND end_date BETWEEN $1::date AND ($1::date + interval '30 days')`, today).Scan(&n)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (s *Service) outletBreakdown(ctx context.Context, today string) ([]outletSales, error) {
	rows, err := s.db.Query(ctx, `SELECT b.name AS outlet,
	        COALESCE(sum(o.total_amount) FILTER (
	          WHERE o.created_at >= $1::date AND o.created_at < ($1::date + interval '1 day')
	        ), 0)::float8 AS omzet_hari_ini,
	        COALESCE(count(*) FILTER (
	          WHERE o.created_at >= $1::date AND o.created_at < ($1::date + interval '1 day')
	        ), 0)::int AS pesanan_hari_ini,
	        COALESCE(sum(o.total_amount), 0)::float8 AS omzet_7_hari
	   FROM pos.pos_orders o
	   LEFT JOIN configuration.branches b ON b.id = o.branch_id
	  WHERE o.created_at >= ($1::date - interval '6 days')
	    AND o.created_at < ($1::date + interval '1 day')
	    AND o.status <> 'cancelled'
	    AND o.voided_at IS NULL
	  GROUP BY b.name
	  ORDER BY omzet_7_hari DESC`, today)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (outletSales, error) {
		var o outletSales
		var name *string
		err := row.Scan(&name, &o.OmzetHariIni, &o.PesananHariIni, &o.Omzet7Hari)
		o.Outlet = "Tanpa outlet"
		if name != nil {
			o.Outlet = *name
		}
		return o, err
	})
}

func (s *Service) monthToDate(ctx context.Context, today string) (*monthToDate, error) {
	var m monthToDate
	err := s.db.QueryRow(ctx, `SELECT COALESCE(sum(total_amount), 0)::float8 AS omzet, count(*)::int AS pesanan
	   FROM pos.pos_orders
	  WHERE created_at >= date_trunc('month', $1::date)
	    AND created_at < ($1::date + interval '1 day')
	    AND status <> 'cancelled'
	    AND voided_at IS NULL`, today).Scan(&m.Omzet, &m.Pesanan)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// gymPulse is nil, not a failure, while the gym schema is not migrated.
func (s *Service) gymPulse(ctx context.Context, today string) (*gymPulse, error) {
	var ready *bool
	if err := s.db.QueryRow(ctx, `SELECT to_regclass('gym.class_sessions') IS NOT NULL
	    AND to_regclass('gym.credit_purchases') IS NOT NULL AS ok`).Scan(&ready); err != nil {
		return nil, err
	}
	if ready == nil || !*ready {
		return nil, nil
	}
	g := &gymPulse{Sesi: []gymSession{}}
	var sesiErr, kreditErr error
	var kapasitas float64
	s.parallel(
		func() {
			rows, err := s.db.Query(ctx, `SELECT s.id::text, t.name AS kelas, c.name AS coach, s.starts_at AS mulai, s.capacity AS kapasitas, s.status,
			        count(b.id) FILTER (WHERE b.status IN ('confirmed','checked_in','completed'))::int AS terisi,
			        count(b.id) FILTER (WHERE b.status = 'waitlist')::int AS waitlist,
			        count(b.id) FILTER (WHERE b.status IN ('checked_in','completed'))::int AS checkin
			   FROM gym.class_sessions s
			   JOIN gym.class_types t ON t.id = s.class_type_id
			   LEFT JOIN gym.coaches c ON c.id = s.coach_id
			   LEFT JOIN gym.bookings b ON b.session_id = s.id
			  WHERE s.starts_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Jakarta')
			    AND s.starts_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
			    AND s.status <> 'cancelled' AND s.status <> 'draft'
			  GROUP BY s.id, t.name, c.name
			  ORDER BY s.starts_at`, today)
			if err != nil {
				sesiErr = err
				return
			}
			var x gymSession
			var mulai time.Time
			var checkin float64
			var capacity *float64
			_, sesiErr = pgx.ForEachRow(rows, []any{&x.ID, &x.Kelas, &x.Coach, &mulai, &capacity, &x.Status, &x.Terisi, &x.Waitlist, &checkin}, func() error {
				x.Mulai = domain.ISO(mulai)
				x.Kapasitas = 0
				if capacity != nil {
					x.Kapasitas = *capacity
				}
				kapasitas += x.Kapasitas
				g.BookingHariIni += x.Terisi
				g.WaitlistHariIni += x.Waitlist
				g.CheckinHariIni += checkin
				g.Sesi = append(g.Sesi, x)
				return nil
			})
		},
		func() {
			kreditErr = s.db.QueryRow(ctx, `SELECT (SELECT count(*) FROM gym.credit_purchases
			            WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::int AS terjual,
			          (SELECT COALESCE(sum(total_idr), 0) FROM gym.credit_purchases
			            WHERE status = 'paid' AND paid_at >= now() - interval '30 days')::float8 AS pendapatan,
			          (SELECT COALESCE(sum(amount), 0) FROM gym.credit_ledger)::int AS beredar`).
				Scan(&g.PaketTerjual30Hari, &g.PendapatanPaket30Hari, &g.KreditBeredar)
		},
	)
	if sesiErr != nil {
		return nil, sesiErr
	}
	if kreditErr != nil {
		return nil, kreditErr
	}
	g.KelasHariIni = len(g.Sesi)
	if kapasitas > 0 {
		g.IsiKelasPersen = jsmath.Round(g.BookingHariIni / kapasitas * 100)
	}
	return g, nil
}
