package investor

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	gymdomain "nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/modules/investor/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// Ringkasan: KPI tiles against the previous period, the last 90 days of
// revenue by stream and branch, and the liabilities investors ask about
// (ARK Coin balances, revenue still to earn).

const (
	overviewTTL  = 5 * time.Minute
	chartDays    = 90
	activityDays = 30
)

// Branch is a branch as the portal names it.
type Branch struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
}

// Overview is GET /api/investor/overview.
type Overview struct {
	Timezone    string `json:"timezone"`
	Today       string `json:"today"`
	GeneratedAt string `json:"generated_at"`
	Revenue     struct {
		Today domain.Compared `json:"today"`
		MTD   domain.Compared `json:"mtd"`
		YTD   domain.Compared `json:"ytd"`
		// Streams splits MTD revenue by stream.
		Streams map[string]float64 `json:"mtd_streams"`
	} `json:"revenue"`
	Members struct {
		Active         int             `json:"active"`
		PreviousActive int             `json:"previous_active"`
		New            domain.Compared `json:"new"`
		Churned        int             `json:"churned"`
		ChurnRate      float64         `json:"churn_rate"`
	} `json:"members"`
	Classes struct {
		Sessions   int     `json:"sessions"`
		CheckedIn  int     `json:"checked_in"`
		AvgFill    float64 `json:"avg_fill"`
		NoShowRate float64 `json:"no_show_rate"`
	} `json:"classes"`
	PT              domain.Compared `json:"pt_sessions"`
	ArkCoin         float64         `json:"ark_coin_outstanding"`
	DeferredRevenue struct {
		Credits float64 `json:"credits"`
		Passes  float64 `json:"passes"`
		Total   float64 `json:"total"`
	} `json:"deferred_revenue"`
	Daily    []domain.DayRevenue `json:"daily"`
	Branches []Branch            `json:"branches"`
}

// Overview builds the summary for branchID (nil for every branch, in WIB),
// from cache when the last build is fresh.
func (s *Service) Overview(ctx context.Context, branchID *string) (*Overview, bool, error) {
	key := ""
	if branchID != nil {
		key = *branchID
	}
	s.mu.Lock()
	c, ok := s.overview[key]
	s.mu.Unlock()
	if ok && s.now().Sub(c.at) < overviewTTL {
		return c.v, true, nil
	}
	o, err := s.buildOverview(ctx, branchID)
	if err != nil {
		return nil, false, err
	}
	s.mu.Lock()
	s.overview[key] = cached[*Overview]{at: s.now(), v: o}
	s.mu.Unlock()
	return o, false, nil
}

func (s *Service) buildOverview(ctx context.Context, branchID *string) (*Overview, error) {
	zone, err := localtime.BranchZone(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	w := domain.WindowsAt(now, zone)
	o := &Overview{Timezone: localtime.Name(zone), Today: w.Today, GeneratedAt: now.UTC().Format(time.RFC3339)}

	// Revenue days from the start of the previous year cover every window.
	firstDay, _ := localtime.ParseDay(w.PrevYearFrom, zone)
	lastDay, _ := localtime.ParseDay(w.Today, zone)
	daily, err := s.dailyRevenue(ctx, firstDay, lastDay.AddDate(0, 0, 1), zone, branchID)
	if err != nil {
		return nil, err
	}
	today, _ := daily.Sum(w.Today, w.Today)
	yesterday, _ := daily.Sum(w.Yesterday, w.Yesterday)
	mtd, streams := daily.Sum(w.MonthFrom, w.Today)
	prevMtd, _ := daily.Sum(w.PrevMonthFrom, w.PrevTo)
	ytd, _ := daily.Sum(w.YearFrom, w.Today)
	prevYtd, _ := daily.Sum(w.PrevYearFrom, w.PrevYTo)
	o.Revenue.Today = domain.Compare(today, yesterday)
	o.Revenue.MTD = domain.Compare(mtd, prevMtd)
	o.Revenue.YTD = domain.Compare(ytd, prevYtd)
	o.Revenue.Streams = streams
	chartFrom := lastDay.AddDate(0, 0, -(chartDays - 1)).Format(time.DateOnly)
	o.Daily = daily.Range(chartFrom, w.Today)

	activity := lastPeriod(now, activityDays, zone)
	members, err := s.ports.Gym.MemberStats(ctx, activity, branchID)
	if err != nil {
		return nil, err
	}
	o.Members.Active, o.Members.PreviousActive = members.Active, members.PreviousActive
	o.Members.Churned, o.Members.ChurnRate = members.Churned, members.ChurnRate
	monthStart, _ := localtime.ParseDay(w.MonthFrom, zone)
	prevMonthStart, _ := localtime.ParseDay(w.PrevMonthFrom, zone)
	prevMonthTo, _ := localtime.ParseDay(w.PrevTo, zone)
	mtdPeriod := gymdomain.Period{From: monthStart, To: lastDay.AddDate(0, 0, 1), Zone: zone}
	prevMtdPeriod := gymdomain.Period{From: prevMonthStart, To: prevMonthTo.AddDate(0, 0, 1), Zone: zone}
	newMtd, err := s.ports.Gym.MemberStats(ctx, mtdPeriod, branchID)
	if err != nil {
		return nil, err
	}
	newPrev, err := s.ports.Gym.MemberStats(ctx, prevMtdPeriod, branchID)
	if err != nil {
		return nil, err
	}
	o.Members.New = domain.Compare(float64(newMtd.New), float64(newPrev.New))

	classes, err := s.ports.Gym.ClassReport(ctx, activity, branchID)
	if err != nil {
		return nil, err
	}
	o.Classes.Sessions, o.Classes.CheckedIn = classes.Totals.Sessions, classes.Totals.CheckedIn
	o.Classes.AvgFill, o.Classes.NoShowRate = classes.Totals.AvgFill, classes.Totals.NoShowRate

	pt, err := s.ptSessions(ctx, mtdPeriod.From, mtdPeriod.To, branchID)
	if err != nil {
		return nil, err
	}
	ptPrev, err := s.ptSessions(ctx, prevMtdPeriod.From, prevMtdPeriod.To, branchID)
	if err != nil {
		return nil, err
	}
	o.PT = domain.Compare(float64(pt), float64(ptPrev))

	if err := s.db.QueryRow(ctx, `SELECT COALESCE(sum(ark_coin_balance), 0)::float8 FROM pos.pos_customers`).Scan(&o.ArkCoin); err != nil {
		return nil, err
	}
	if o.DeferredRevenue.Credits, o.DeferredRevenue.Passes, err = s.deferredRevenue(ctx, branchID); err != nil {
		return nil, err
	}
	o.DeferredRevenue.Total = o.DeferredRevenue.Credits + o.DeferredRevenue.Passes
	if o.Branches, err = s.Branches(ctx); err != nil {
		return nil, err
	}
	return o, nil
}

// lastPeriod is the days days ending today in zone.
func lastPeriod(now time.Time, days int, zone *time.Location) gymdomain.Period {
	end := localtime.DayStart(now, zone).AddDate(0, 0, 1)
	return gymdomain.Period{From: end.AddDate(0, 0, -days), To: end, Zone: zone}
}

// dailyRevenue is the revenue of [from, to) per local day, stream and
// branch: gym package sales on the day they were paid, refunds taken off on
// the day they were refunded, and POS orders on the day they were created.
func (s *Service) dailyRevenue(ctx context.Context, from, to time.Time, zone *time.Location, branchID *string) (domain.Daily, error) {
	zoneName := localtime.Name(zone)
	rows, err := s.db.Query(ctx, `
		SELECT to_char(cp.paid_at AT TIME ZONE $4, 'YYYY-MM-DD'), pk.kind, pk.covers_personal,
		       COALESCE(cp.branch_id::text, ''), sum(cp.total_idr)::float8
		  FROM gym.credit_purchases cp
		  JOIN gym.credit_packages pk ON pk.id = cp.package_id
		 WHERE cp.paid_at >= $1 AND cp.paid_at < $2 AND cp.status IN ('paid', 'refunded')
		   AND ($3::uuid IS NULL OR cp.branch_id = $3)
		 GROUP BY 1, 2, 3, 4
		UNION ALL
		SELECT to_char(cp.refunded_at AT TIME ZONE $4, 'YYYY-MM-DD'), pk.kind, pk.covers_personal,
		       COALESCE(cp.branch_id::text, ''), -sum(COALESCE(cp.refunded_idr, cp.total_idr))::float8
		  FROM gym.credit_purchases cp
		  JOIN gym.credit_packages pk ON pk.id = cp.package_id
		 WHERE cp.refunded_at >= $1 AND cp.refunded_at < $2 AND cp.status = 'refunded'
		   AND ($3::uuid IS NULL OR cp.branch_id = $3)
		 GROUP BY 1, 2, 3, 4`, from, to, branchID, zoneName)
	if err != nil {
		return domain.Daily{}, err
	}
	var sales []domain.SaleRow
	var r domain.SaleRow
	var kind string
	var personal bool
	if _, err := pgx.ForEachRow(rows, []any{&r.Day, &kind, &personal, &r.BranchID, &r.Amount}, func() error {
		r.Stream = domain.Stream(kind, personal)
		sales = append(sales, r)
		return nil
	}); err != nil {
		return domain.Daily{}, err
	}
	rows, err = s.db.Query(ctx, `
		SELECT to_char(created_at AT TIME ZONE $4, 'YYYY-MM-DD'), COALESCE(branch_id::text, ''), sum(total_amount)::float8
		  FROM pos.pos_orders
		 WHERE created_at >= $1 AND created_at < $2 AND status <> 'cancelled' AND voided_at IS NULL
		   AND ($3::uuid IS NULL OR branch_id = $3)
		 GROUP BY 1, 2`, from, to, branchID, zoneName)
	if err != nil {
		return domain.Daily{}, err
	}
	r = domain.SaleRow{Stream: domain.StreamPOS}
	if _, err := pgx.ForEachRow(rows, []any{&r.Day, &r.BranchID, &r.Amount}, func() error {
		sales = append(sales, r)
		return nil
	}); err != nil {
		return domain.Daily{}, err
	}
	return domain.RollUpDaily(domain.DayKeys(from, to.AddDate(0, 0, -1), zone), sales), nil
}

// ptSessions counts the personal training appointments completed in [from, to).
func (s *Service) ptSessions(ctx context.Context, from, to time.Time, branchID *string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		SELECT count(*)::int FROM gym.pt_appointments
		 WHERE status = 'completed' AND starts_at >= $1 AND starts_at < $2
		   AND ($3::uuid IS NULL OR branch_id = $3)`, from, to, branchID).Scan(&n)
	return n, err
}

// deferredRevenue estimates the money members paid for what they have not
// used yet: the unused share of paid credit lots that have not lapsed, and
// the pass revenue not yet released by day.
func (s *Service) deferredRevenue(ctx context.Context, branchID *string) (credits, passes float64, err error) {
	err = s.db.QueryRow(ctx, `
		WITH lots AS (
		  SELECT l.credits,
		         GREATEST(0, l.credits + COALESCE((SELECT sum(e.amount) FROM gym.credit_ledger e
		           WHERE e.lot_id = l.id AND NOT (e.amount > 0 AND e.type IN ('top_up', 'bonus', 'adjustment', 'transfer_in'))), 0)) AS left_credits,
		         COALESCE(l.value_sen / 100.0, p.total_idr) AS value
		    FROM gym.credit_lots l
		    JOIN gym.credit_purchases p ON p.id = l.purchase_id
		   WHERE p.status = 'paid' AND l.expires_at > $2 AND l.credits > 0
		     AND ($1::uuid IS NULL OR p.branch_id = $1)
		)
		SELECT COALESCE(sum(value * left_credits / credits), 0)::float8 FROM lots`, branchID, s.now()).Scan(&credits)
	if err != nil {
		return 0, 0, err
	}
	err = s.db.QueryRow(ctx, `
		SELECT COALESCE(sum(p.total_idr - COALESCE((SELECT sum(r.amount_idr) FROM gym.pass_revenue_releases r WHERE r.pass_id = mp.id), 0)), 0)::float8
		  FROM gym.member_passes mp
		  JOIN gym.credit_purchases p ON p.id = mp.purchase_id
		 WHERE mp.status = 'active' AND mp.ends_at > $2 AND p.status = 'paid'
		   AND ($1::uuid IS NULL OR p.branch_id = $1)`, branchID, s.now()).Scan(&passes)
	return credits, passes, err
}

// Branches lists the active branches by name.
func (s *Service) Branches(ctx context.Context) ([]Branch, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name, COALESCE(timezone, 'Asia/Jakarta')
		FROM configuration.branches WHERE is_active = true ORDER BY name`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Branch])
	if out == nil {
		out = []Branch{}
	}
	return out, err
}
