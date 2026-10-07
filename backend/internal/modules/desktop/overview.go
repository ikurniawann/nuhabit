package desktop

import (
	"context"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/desktop/domain"
)

// Overview is DesktopOverview (lib/desktop/overview.ts). The board fields
// sit in an embedded struct so the SSE hash can skip dibuatPada, which
// changes on every poll.
type Overview struct {
	DibuatPada string `json:"dibuatPada"`
	OverviewBoard
}

// OverviewBoard is every overview field but the build time, in TS order.
type OverviewBoard struct {
	Periode        domain.PeriodSummary `json:"periode"`
	OmzetPeriode   *RevenuePeriod       `json:"omzetPeriode"`
	DampakPromo    *PromoImpact         `json:"dampakPromo"`
	TamuDiMeja     *GuestsSeated        `json:"tamuDiMeja"`
	PulsaBisnis    *SalesPulse          `json:"pulsaBisnis"`
	TimHariIni     *TeamToday           `json:"timHariIni"`
	PerluKeputusan *PendingDecisions    `json:"perluKeputusan"`
	StokMenipis    *LowStock            `json:"stokMenipis"`
	Member         *CrmPulse            `json:"member"`
	// Gagal names the sections that failed to load.
	Gagal []string `json:"gagal"`
}

// RevenuePeriod is the revenue of the chosen period (F&B plus paid B2B).
type RevenuePeriod struct {
	Omzet    float64                `json:"omzet"`
	Pesanan  int                    `json:"pesanan"`
	Sumber   []domain.RevenueSource `json:"sumber"`
	Banding  OrdersTotal            `json:"banding"`
	Proyeksi float64                `json:"proyeksi"`
	AdaData  bool                   `json:"adaData"`
}

// OrdersTotal is a revenue and order count pair.
type OrdersTotal struct {
	Omzet   float64 `json:"omzet"`
	Pesanan int     `json:"pesanan"`
}

// PromoImpact is the discount given against the sales it brought.
type PromoImpact struct {
	Diskon       float64     `json:"diskon"`
	OmzetTerbawa float64     `json:"omzetTerbawa"`
	Redemption   int         `json:"redemption"`
	Efisiensi    *float64    `json:"efisiensi"`
	Teratas      []PromoLine `json:"teratas"`
	AdaData      bool        `json:"adaData"`
}

// PromoLine is one campaign of the promo card.
type PromoLine struct {
	Kampanye   string  `json:"kampanye"`
	Diskon     float64 `json:"diskon"`
	Omzet      float64 `json:"omzet"`
	Redemption int     `json:"redemption"`
}

// GuestsSeated is the guests at open table bills right now.
type GuestsSeated struct {
	Tamu      float64 `json:"tamu"`
	Meja      int     `json:"meja"`
	Kapasitas float64 `json:"kapasitas"`
	AdaData   bool    `json:"adaData"`
}

// SalesPulse is today's sales against yesterday and last week.
type SalesPulse struct {
	HariIni          SalesToday   `json:"hariIni"`
	LabaKotorHariIni *GrossProfit `json:"labaKotorHariIni"`
	Kemarin          OrdersTotal  `json:"kemarin"`
	MingguLalu       OrdersTotal  `json:"mingguLalu"`
	TujuhHari        []DaySales   `json:"tujuhHari"`
}

// SalesToday is today's totals with the average ticket.
type SalesToday struct {
	Omzet    float64 `json:"omzet"`
	Pesanan  int     `json:"pesanan"`
	RataRata float64 `json:"rataRata"`
}

// GrossProfit is today's sales minus the cost snapshot per item.
type GrossProfit struct {
	Laba           float64 `json:"laba"`
	ItemTanpaModal int     `json:"itemTanpaModal"`
}

// DaySales is one sparkline point.
type DaySales struct {
	Tanggal string  `json:"tanggal"`
	Omzet   float64 `json:"omzet"`
}

// TeamToday is today's attendance.
type TeamToday struct {
	Aktif     int `json:"aktif"`
	Hadir     int `json:"hadir"`
	Terlambat int `json:"terlambat"`
	Cuti      int `json:"cuti"`
	Belum     int `json:"belum"`
}

// PendingDecisions counts what waits for approval.
type PendingDecisions struct {
	Cuti         int `json:"cuti"`
	Lembur       int `json:"lembur"`
	Pinjaman     int `json:"pinjaman"`
	PoDraft      int `json:"poDraft"`
	KandidatBaru int `json:"kandidatBaru"`
	Total        int `json:"total"`
}

// LowStock is the raw materials at or below their minimum.
type LowStock struct {
	Jumlah  int            `json:"jumlah"`
	Teratas []LowStockItem `json:"teratas"`
}

// LowStockItem is one low raw material.
type LowStockItem struct {
	Bahan    string  `json:"bahan"`
	Tersedia float64 `json:"tersedia"`
	Minimum  float64 `json:"minimum"`
}

// CrmPulse is the last seven days of loyalty activity.
type CrmPulse struct {
	MemberBaru7Hari      int `json:"memberBaru7Hari"`
	XpTerdistribusi7Hari int `json:"xpTerdistribusi7Hari"`
	RewardDitukar7Hari   int `json:"rewardDitukar7Hari"`
}

// OverviewRoles may see the board without IAM data (owner = direksi).
var OverviewRoles = []string{"super_admin", "direksi"}

// BuildOverview is buildDesktopOverview: every section loads concurrently
// and a failing one is null and named in gagal (in section order here; the
// TS lists them in completion order). Team, decisions and stock describe
// now and ignore the period.
func (s *Service) BuildOverview(ctx context.Context, kind string) *Overview {
	summary := domain.SummarizePeriod(kind, s.now())
	board := OverviewBoard{Periode: summary, Gagal: []string{}}
	today := domain.TodayJakarta(s.now())

	sections := []struct {
		name string
		load func() error
	}{
		{"omzetPeriode", into(&board.OmzetPeriode, func() (*RevenuePeriod, error) { return s.revenuePeriod(ctx, summary) })},
		{"dampakPromo", into(&board.DampakPromo, func() (*PromoImpact, error) { return s.promoImpact(ctx, summary.Periode) })},
		{"tamuDiMeja", into(&board.TamuDiMeja, func() (*GuestsSeated, error) { return s.repo.GuestsSeated(ctx) })},
		{"pulsaBisnis", into(&board.PulsaBisnis, func() (*SalesPulse, error) { return s.salesPulse(ctx, today) })},
		{"timHariIni", into(&board.TimHariIni, func() (*TeamToday, error) { return s.teamToday(ctx, today) })},
		{"perluKeputusan", into(&board.PerluKeputusan, func() (*PendingDecisions, error) { return s.pendingDecisions(ctx) })},
		{"stokMenipis", into(&board.StokMenipis, func() (*LowStock, error) { return s.lowStock(ctx) })},
		{"member", into(&board.Member, func() (*CrmPulse, error) { return s.repo.CrmPulse(ctx) })},
	}
	failed := make([]bool, len(sections))
	var wg sync.WaitGroup
	for i, sec := range sections {
		wg.Go(func() {
			if err := sec.load(); err != nil {
				s.log.ErrorContext(ctx, "[desktop:overview] seksi "+sec.name+" gagal", "error", err)
				failed[i] = true
			}
		})
	}
	wg.Wait()
	for i, sec := range sections {
		if failed[i] {
			board.Gagal = append(board.Gagal, sec.name)
		}
	}
	return &Overview{DibuatPada: jsISO(s.now()), OverviewBoard: board}
}

// into runs a section loader and stores its result only when it succeeds,
// so a failed section stays null.
func into[T any](dst **T, load func() (*T, error)) func() error {
	return func() error {
		v, err := load()
		if err == nil {
			*dst = v
		}
		return err
	}
}

// salesPulse is fetchSalesPulse: paid, non-cancelled orders by WIB day over
// eight days (today, the sparkline week and the same day last week). The
// gross profit is null, not 0, when its query fails.
func (s *Service) salesPulse(ctx context.Context, today string) (*SalesPulse, error) {
	days, err := s.repo.SalesByDay(ctx, today)
	if err != nil {
		return nil, err
	}
	byDate := map[string]OrdersTotal{}
	for _, d := range days {
		byDate[d.Tanggal] = OrdersTotal{Omzet: d.Omzet, Pesanan: d.Pesanan}
	}
	out := &SalesPulse{TujuhHari: make([]DaySales, 0, 7)}
	for i := 6; i >= 0; i-- {
		d := domain.AddDays(today, -i)
		out.TujuhHari = append(out.TujuhHari, DaySales{Tanggal: d, Omzet: byDate[d].Omzet})
	}
	hariIni := byDate[today]
	out.HariIni = SalesToday{Omzet: hariIni.Omzet, Pesanan: hariIni.Pesanan}
	if hariIni.Pesanan > 0 {
		out.HariIni.RataRata = hariIni.Omzet / float64(hariIni.Pesanan)
	}
	out.Kemarin = byDate[out.TujuhHari[5].Tanggal]
	out.MingguLalu = byDate[domain.AddDays(today, -7)]
	if laba, err := s.repo.GrossProfitToday(ctx, today); err == nil {
		out.LabaKotorHariIni = laba
	}
	return out, nil
}

// revenuePeriod is fetchRevenuePeriod: F&B orders and paid B2B deals in the
// period and in the comparison window.
func (s *Service) revenuePeriod(ctx context.Context, summary domain.PeriodSummary) (*RevenuePeriod, error) {
	fnb, b2b, err := s.repo.RevenueTotals(ctx, summary)
	if err != nil {
		return nil, err
	}
	total, sumber := domain.BreakdownRevenue([]domain.RevenueSource{
		{Kunci: "fnb", Label: "F&B", Nilai: fnb.Omzet},
		{Kunci: "b2b", Label: "B2B", Nilai: b2b.Omzet},
	})
	return &RevenuePeriod{
		Omzet:    total,
		Pesanan:  fnb.Pesanan,
		Sumber:   sumber,
		Banding:  OrdersTotal{Omzet: fnb.BandingOmzet + b2b.BandingOmzet, Pesanan: fnb.BandingPesanan},
		Proyeksi: domain.ProjectRunRate(total, summary.Periode),
		AdaData:  fnb.Baris+b2b.Baris > 0,
	}, nil
}

// promoImpact is fetchPromoImpact over the top five campaigns.
func (s *Service) promoImpact(ctx context.Context, p domain.Period) (*PromoImpact, error) {
	lines, err := s.repo.PromoLines(ctx, p)
	if err != nil {
		return nil, err
	}
	out := &PromoImpact{Teratas: lines, AdaData: len(lines) > 0}
	for _, l := range lines {
		out.Diskon += l.Diskon
		out.OmzetTerbawa += l.Omzet
		out.Redemption += l.Redemption
	}
	out.Efisiensi = domain.PromoEfficiency(out.Diskon, out.OmzetTerbawa)
	return out, nil
}

// teamToday is fetchTeamToday; belum never goes negative.
func (s *Service) teamToday(ctx context.Context, today string) (*TeamToday, error) {
	t, err := s.repo.TeamToday(ctx, today)
	if err != nil {
		return nil, err
	}
	t.Belum = max(0, t.Aktif-t.Hadir-t.Cuti)
	return t, nil
}

func (s *Service) pendingDecisions(ctx context.Context) (*PendingDecisions, error) {
	p, err := s.repo.PendingDecisions(ctx)
	if err != nil {
		return nil, err
	}
	p.Total = p.Cuti + p.Lembur + p.Pinjaman + p.PoDraft + p.KandidatBaru
	return p, nil
}

// lowStock is fetchLowStock: the full count and the top three.
func (s *Service) lowStock(ctx context.Context) (*LowStock, error) {
	items, err := s.repo.LowStockItems(ctx)
	if err != nil {
		return nil, err
	}
	return &LowStock{Jumlah: len(items), Teratas: items[:min(3, len(items))]}, nil
}

// overviewCacheTTL matches the client's 60-second refresh.
const overviewCacheTTL = 60 * time.Second

// overviewCache is the per-process, per-period cache of the overview route;
// a result with failed sections is never cached.
type overviewCache struct {
	mu      sync.Mutex
	entries map[string]cachedOverview
}

type cachedOverview struct {
	at   time.Time
	data *Overview
}

// CachedOverview returns the period's overview and whether it came from the
// cache.
func (s *Service) CachedOverview(ctx context.Context, kind string) (*Overview, bool) {
	s.cache.mu.Lock()
	hit, ok := s.cache.entries[kind]
	s.cache.mu.Unlock()
	if ok && s.now().Sub(hit.at) < overviewCacheTTL {
		return hit.data, true
	}
	data := s.BuildOverview(ctx, kind)
	if len(data.Gagal) == 0 {
		s.cache.mu.Lock()
		s.cache.entries[kind] = cachedOverview{at: s.now(), data: data}
		s.cache.mu.Unlock()
	}
	return data, false
}

// jsISO is Date.prototype.toISOString.
func jsISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
