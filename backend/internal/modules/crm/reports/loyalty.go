package reports

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reports/domain"
)

type periodLabel struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type topSpender struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Phone          string  `json:"phone"`
	MembershipTier string  `json:"membership_tier"`
	MemberType     string  `json:"member_type"`
	OrderCount     float64 `json:"order_count"`
	TotalSpend     float64 `json:"total_spend"`
	ArkSpend       float64 `json:"ark_spend"`
	// LastOrderAt is always null: the TS mapper's asText drops the Date
	// node-postgres returns. Kept for parity.
	LastOrderAt *string `json:"last_order_at"`
}

type frequentVisitor struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Phone          string  `json:"phone"`
	MembershipTier string  `json:"membership_tier"`
	MemberType     string  `json:"member_type"`
	OrderCount     float64 `json:"order_count"`
	VisitDays      float64 `json:"visit_days"`
	LifetimeVisits float64 `json:"lifetime_visits"`
	LastVisitAt    *string `json:"last_visit_at"` // always null, as LastOrderAt
}

type reconciliation struct {
	Venues              []domain.Reconciliation `json:"venues"`
	Totals              domain.Totals           `json:"totals"`
	OutstandingBalance  float64                 `json:"outstanding_balance"`
	UntaggedTopupAmount float64                 `json:"untagged_topup_amount"`
	UntaggedTopupCount  float64                 `json:"untagged_topup_count"`
}

type memberCounts struct {
	Card       float64 `json:"card"`
	Registered float64 `json:"registered"`
}

type loyaltyReport struct {
	Period           periodLabel       `json:"period"`
	TopSpenders      []topSpender      `json:"topSpenders"`
	FrequentVisitors []frequentVisitor `json:"frequentVisitors"`
	Reconciliation   reconciliation    `json:"reconciliation"`
	Members          memberCounts      `json:"members"`
}

func textOrNil(v any) *string {
	if s := domain.AsText(v, ""); s != "" {
		return &s
	}
	return nil
}

func get(row *kit.Row, key string) any {
	if row == nil {
		return nil
	}
	return row.Get(key)
}

func (h *handler) loyalty(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReports); err != nil {
		return err
	}
	period, err := h.requirePeriod(r)
	if err != nil {
		return err
	}
	ctx, from, to := r.Context(), period.FromISO, period.ToISO
	spenders, err := h.pos.TopSpenders(ctx, h.db, from, to)
	if err != nil {
		return err
	}
	visitors, err := h.pos.FrequentVisitors(ctx, h.db, from, to)
	if err != nil {
		return err
	}
	venues, err := h.pos.VenueReconciliation(ctx, h.db, from, to)
	if err != nil {
		return err
	}
	untagged, err := h.pos.UntaggedTopups(ctx, h.db, from, to)
	if err != nil {
		return err
	}
	summary, err := h.pos.MemberSummary(ctx, h.db)
	if err != nil {
		return err
	}

	out := loyaltyReport{
		Period:           periodLabel{From: period.FromDate, To: period.ToDate},
		TopSpenders:      []topSpender{},
		FrequentVisitors: []frequentVisitor{},
	}
	for _, row := range spenders {
		out.TopSpenders = append(out.TopSpenders, topSpender{
			ID: domain.AsText(row.Get("id"), ""), Name: domain.AsText(row.Get("name"), "Customer"),
			Phone: domain.AsText(row.Get("phone"), ""), MembershipTier: domain.AsText(row.Get("membership_tier"), "regular"),
			MemberType: domain.AsText(row.Get("member_type"), "registered"), OrderCount: row.Num("order_count"),
			TotalSpend: row.Num("total_spend"), ArkSpend: row.Num("ark_spend"), LastOrderAt: textOrNil(row.Get("last_order_at")),
		})
	}
	for _, row := range visitors {
		out.FrequentVisitors = append(out.FrequentVisitors, frequentVisitor{
			ID: domain.AsText(row.Get("id"), ""), Name: domain.AsText(row.Get("name"), "Customer"),
			Phone: domain.AsText(row.Get("phone"), ""), MembershipTier: domain.AsText(row.Get("membership_tier"), "regular"),
			MemberType: domain.AsText(row.Get("member_type"), "registered"), OrderCount: row.Num("order_count"),
			VisitDays: row.Num("visit_days"), LifetimeVisits: row.Num("lifetime_visits"), LastVisitAt: textOrNil(row.Get("last_visit_at")),
		})
	}
	out.Reconciliation.Venues = []domain.Reconciliation{}
	for _, row := range venues {
		topup, bonus, foc, spend := row.Num("topup_amount"), row.Num("bonus_amount"), row.Num("foc_topup_amount"), row.Num("spend_amount")
		out.Reconciliation.Venues = append(out.Reconciliation.Venues, domain.Reconciliation{
			CompanyID: textOrNil(row.Get("company_id")), BranchID: textOrNil(row.Get("branch_id")),
			CompanyName: domain.AsText(row.Get("company_name"), "Tanpa venue"), BranchName: domain.AsText(row.Get("branch_name"), "-"),
			TopupAmount: topup, BonusAmount: bonus, FocTopupAmount: foc, SpendAmount: spend,
			OtherAmount: row.Num("other_amount"), TopupCount: row.Num("topup_count"),
			FocTopupCount: row.Num("foc_topup_count"), PaymentCount: row.Num("payment_count"),
			NetFlow: domain.NetFlow(topup, bonus, foc, spend),
		})
	}
	out.Reconciliation.Totals = domain.SumReconciliation(out.Reconciliation.Venues)
	out.Reconciliation.OutstandingBalance = kit.ToNumber(get(summary, "outstanding_balance"))
	out.Reconciliation.UntaggedTopupAmount = kit.ToNumber(get(untagged, "topup_amount"))
	out.Reconciliation.UntaggedTopupCount = kit.ToNumber(get(untagged, "topup_count"))
	out.Members = memberCounts{Card: kit.ToNumber(get(summary, "card_members")), Registered: kit.ToNumber(get(summary, "registered_members"))}
	return kit.OK(w, out)
}
