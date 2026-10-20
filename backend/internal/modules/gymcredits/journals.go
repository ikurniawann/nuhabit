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
// it: a credit at the unit price of its lot (purchase total over the lot's
// credits) when deducted, breakage when it expires, a pass by day through
// SweepPassRevenue. Bonus and adjustment lots carry no money and post
// nothing. Journal dates are calendar dates in the zone of the purchase's
// branch.

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

// lotMove is a ledger entry that moved credits of one lot.
type lotMove struct {
	EntryID string
	LotID   string
	Type    domain.EntryType
	Amount  int
}

// lotMoveEvent is the journal of a lot move: credits used (deduction, a
// reversed refund), given back (refund, a reversed deduction) or expired.
func lotMoveEvent(m lotMove) (event, label string) {
	switch {
	case m.Type == domain.Expiration:
		return "GYM_CREDIT_BREAKAGE", "kedaluwarsa"
	case m.Amount < 0:
		return "GYM_CREDIT_USAGE", "terpakai"
	}
	return "GYM_CREDIT_USAGE_REVERSAL", "dikembalikan"
}

// publishLotJournals values each move at its lot's unit price and posts it,
// keyed by the ledger entry. Moves of unpaid lots post nothing.
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
			UserID: userID, EntryDate: localtime.DayKey(at, v.Zone), Amount: domain.UnitValue(v.TotalIdr, v.Credits, credits),
			Description: fmt.Sprintf("%d kredit gym %s", credits, label),
		}); err != nil {
			return err
		}
	}
	return nil
}
