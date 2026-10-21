package gymcredits

import (
	"context"
	"fmt"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Credits a member transferred out of a purchase's lot are not refunded to
// them: the receiver holds them. The quote and the refund note say so, and
// staff can reclaim the transfer first (ReclaimTransfer) when the receiver
// has not used them.

// TransferredCredits is credits of a purchase's lot that a transfer moved
// to another member and no reclaim brought back.
type TransferredCredits struct {
	TransferID string  `json:"transfer_id"`
	CustomerID string  `json:"customer_id"`
	Name       *string `json:"name"`
	Phone      string  `json:"phone"`
	Credits    int     `json:"credits"`
}

// transferredFromPurchase lists what left the purchase's lot by transfer.
func (s *Service) transferredFromPurchase(ctx context.Context, q database.Querier, p *Purchase) ([]TransferredCredits, error) {
	out := []TransferredCredits{}
	topUpID, err := s.repo.EntryIDByKey(ctx, q, topUpKey(p.ID))
	if err != nil || topUpID == "" {
		return out, err
	}
	topUp, err := s.repo.Entry(ctx, q, topUpID)
	if err != nil || topUp == nil || topUp.LotID == "" {
		return out, err
	}
	moved, err := s.repo.LotTransfersOut(ctx, q, topUp.LotID)
	if err != nil || len(moved) == 0 {
		return out, err
	}
	ids := make([]string, 0, len(moved))
	for _, m := range moved {
		ids = append(ids, m.ToCustomerID)
	}
	members, err := s.ports.Members.ByIDs(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]MemberSummary, len(members))
	for _, m := range members {
		byID[m.ID] = m
	}
	for _, m := range moved {
		receiver := byID[m.ToCustomerID]
		out = append(out, TransferredCredits{
			TransferID: m.TransferID, CustomerID: m.ToCustomerID, Name: receiver.Name, Phone: receiver.Phone, Credits: m.Credits,
		})
	}
	return out, nil
}

func transferredTotal(list []TransferredCredits) int {
	total := 0
	for _, t := range list {
		total += t.Credits
	}
	return total
}

// transferredNote is "N kredit sudah ditransfer ke <member>" per
// transfer, joined; "" when nothing was transferred.
func transferredNote(list []TransferredCredits) string {
	parts := make([]string, 0, len(list))
	for _, t := range list {
		name := t.Phone
		if t.Name != nil && strings.TrimSpace(*t.Name) != "" {
			name = strings.TrimSpace(*t.Name)
		}
		parts = append(parts, fmt.Sprintf("%d kredit sudah ditransfer ke %s", t.Credits, name))
	}
	return strings.Join(parts, ", ")
}
