package gymcredits

import (
	"context"
	"fmt"
	"time"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/outbox"
)

// Gym package journals go to accounting as outbox events in the caller's
// transaction, so they commit with the ledger write. Accounting posts them
// later; a mapping it cannot post is logged there and never blocks a sale.
//
// Money paid for a package sits in deferred revenue until the member uses
// it. A lot is valued in sen (domain/valuation.go): each credit that leaves
// it (used, taken by an admin adjustment, expired, transferred to another
// company) or comes back is worth the difference of the lot's cumulative
// share, so the journals of a lot net to zero when its last credit goes. A
// purchase refund pays whole rupiah; the sen left over is posted when the
// lot closes. Passes release revenue by day through SweepPassRevenue. Bonus
// and adjustment lots carry no money and post nothing. Journal dates are
// calendar dates in the zone of the purchase's branch.

// memberZone is the zone of member-level dates without a branch: pass and
// credit expiry notices, renewals and the monthly transfer cap.
var memberZone = localtime.Jakarta

// localDay is t's calendar day in zone, as midnight UTC, for day counts.
func localDay(t time.Time, zone *time.Location) time.Time {
	y, m, d := t.In(zone).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// paymentGroup is the journal suffix of a payment method; "" posts nothing
// (complimentary and free purchases total zero).
func paymentGroup(method string) string {
	switch method {
	case "cash":
		return "CASH"
	case "card", "transfer":
		return "BANK"
	case "qris", "invoice":
		return "QRIS"
	case "ark_coin":
		return "ARK_COIN"
	}
	return ""
}

func (s *Service) publishJournal(ctx context.Context, q database.Querier, j contracts.Journal) error {
	if j.Amount <= 0 {
		return nil
	}
	return outbox.Publish(ctx, q, contracts.TopicJournal, j.EventCode+":"+j.DocumentID, j)
}

// publishPurchaseJournal posts the sale (GYM_SALE_*) or the refund
// (GYM_REFUND_*) of purchase p for amount, keyed by the purchase.
func (s *Service) publishPurchaseJournal(ctx context.Context, q database.Querier, p *Purchase, refund bool, amount float64, userID string) error {
	group := paymentGroup(deref(p.PaymentMethod))
	if group == "" || amount <= 0 {
		return nil
	}
	company, zone, err := s.repo.PurchaseBooks(ctx, q, p.ID)
	if err != nil {
		return err
	}
	prefix, label := "GYM_SALE_", "Penjualan"
	if refund {
		prefix, label = "GYM_REFUND_", "Refund"
	}
	return s.publishJournal(ctx, q, contracts.Journal{
		EventCode: prefix + group, DocumentType: "gym_purchase", DocumentID: p.ID, CompanyID: company,
		UserID: userID, EntryDate: localtime.DayKey(s.clock(), zone), Amount: amount, Description: label + " paket gym " + p.PackageName,
	})
}

// lotMove is a ledger entry that moved credits of one lot. UsedBefore is
// how many of the lot's credits had left it before this move.
type lotMove struct {
	EntryID    string
	LotID      string
	Type       domain.EntryType
	Amount     int
	UsedBefore int
}

// lotMoveEvent is the journal of a lot move: credits used (deduction, a
// reversed refund), taken by an admin adjustment, given back (refund, a
// reversed deduction) or expired.
func lotMoveEvent(m lotMove) (event, label string) {
	switch {
	case m.Type == domain.Expiration:
		return "GYM_CREDIT_BREAKAGE", "kedaluwarsa"
	case m.Type == domain.Adjustment && m.Amount < 0:
		return "GYM_CREDIT_ADJUSTMENT", "dikurangi admin"
	case m.Amount < 0:
		return "GYM_CREDIT_USAGE", "terpakai"
	}
	return "GYM_CREDIT_USAGE_REVERSAL", "dikembalikan"
}

// publishLotJournals values each move against its lot and posts it, keyed
// by the ledger entry. Moves of unpaid lots post nothing.
func (s *Service) publishLotJournals(ctx context.Context, q database.Querier, moves []lotMove, userID string, at time.Time) error {
	ids := make([]string, 0, len(moves))
	for _, m := range moves {
		if m.LotID != "" {
			ids = append(ids, m.LotID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	values, err := s.repo.LotValues(ctx, q, ids)
	if err != nil {
		return err
	}
	for _, m := range moves {
		v, ok := values[m.LotID]
		// No entry id: a concurrent writer already wrote the entry and its journal.
		if !ok || m.EntryID == "" {
			continue
		}
		credits := max(m.Amount, -m.Amount)
		event, label := lotMoveEvent(m)
		if err := s.publishJournal(ctx, q, contracts.Journal{
			EventCode: event, DocumentType: "gym_credit_entry", DocumentID: m.EntryID, CompanyID: v.CompanyID,
			UserID: userID, EntryDate: localtime.DayKey(at, v.Zone),
			Amount:      domain.SenToIdr(domain.MoveValueSen(v.ValueSen, v.Credits, m.UsedBefore, m.Amount)),
			Description: fmt.Sprintf("%d kredit gym %s", credits, label),
		}); err != nil {
			return err
		}
	}
	return nil
}

// lotClose is the entry that took the last unused credits of a lot at a
// purchase refund, with the credits it took.
type lotClose struct {
	EntryID string
	LotID   string
	Credits int
}

// publishRefundResidual closes the books of a refunded lot: the deferred
// revenue its unused credits held minus the whole rupiah paid back is a few
// sen, posted as breakage when positive and as a usage reversal when the
// refund paid more, so the lot nets to zero.
func (s *Service) publishRefundResidual(ctx context.Context, q database.Querier, c lotClose, refundIdr float64, userID string) error {
	if c.LotID == "" {
		return nil
	}
	values, err := s.repo.LotValues(ctx, q, []string{c.LotID})
	if err != nil {
		return err
	}
	v, ok := values[c.LotID]
	if !ok {
		return nil
	}
	residual := domain.UnusedValueSen(v.ValueSen, v.Credits, v.Credits-c.Credits) - domain.LotValueSen(refundIdr)
	event := "GYM_CREDIT_BREAKAGE"
	if residual < 0 {
		event, residual = "GYM_CREDIT_USAGE_REVERSAL", -residual
	}
	return s.publishJournal(ctx, q, contracts.Journal{
		EventCode: event, DocumentType: "gym_credit_entry", DocumentID: c.EntryID, CompanyID: v.CompanyID,
		UserID: userID, EntryDate: localtime.DayKey(s.clock(), v.Zone), Amount: domain.SenToIdr(residual),
		Description: "Pembulatan refund paket gym",
	})
}
