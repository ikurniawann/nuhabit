package gymcredits

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Staff take a transfer back ("Tarik kembali transfer") while the receiver
// has not used the credits, so a refund of the sender's purchase can be
// made whole first. See domain/transfer_reclaim.go for the ledger shape.

// SourceTransferReclaim is the source_type of the reclaim's ledger entries.
const SourceTransferReclaim = "transfer_reclaim"

// ReclaimResult is the body of the reclaim route.
type ReclaimResult struct {
	TransferID string `json:"transferId"`
	Credits    int    `json:"credits"`
}

// ReclaimTransferTx is ReclaimTransfer in a new transaction.
func (s *Service) ReclaimTransferTx(ctx context.Context, transferID, reason, actorID string) (res *ReclaimResult, err error) {
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err = s.ReclaimTransfer(ctx, tx, transferID, reason, actorID)
		return err
	})
	return res, err
}

// ReclaimTransfer returns the unused part of a transfer to the sender's
// lots, writes both sides of the ledger and notifies both members.
func (s *Service) ReclaimTransfer(ctx context.Context, tx database.Querier, transferID, reason, actorID string) (*ReclaimResult, error) {
	if len([]rune(strings.TrimSpace(reason))) < domain.MinReasonLength {
		return nil, fail(http.StatusBadRequest, "Alasan penarikan wajib diisi")
	}
	transfer, err := s.repo.TransferForReclaim(ctx, tx, transferID)
	if err != nil {
		return nil, err
	}
	if transfer == nil {
		return nil, fail(http.StatusNotFound, "Transfer kredit tidak ditemukan")
	}
	first, second := transfer.FromCustomerID, transfer.ToCustomerID
	if second < first {
		first, second = second, first
	}
	for _, id := range []string{first, second} {
		if err := s.repo.LockMemberCredits(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	now := s.clock()
	receiver, _, err := s.expireLapsedLots(ctx, tx, transfer.ToCustomerID, now)
	if err != nil {
		return nil, err
	}
	plan := domain.PlanReclaim(transfer.Lots, domain.LotRemainders(receiver.lots, receiver.entries), now)
	if len(plan) == 0 {
		return nil, fail(http.StatusConflict, domain.TransferReclaimNothing)
	}
	// Unlike a transfer, a reclaim goes through for an inactive receiver:
	// that is one reason to take the credits back.
	sender, err := s.ports.Members.Profile(ctx, tx, transfer.FromCustomerID)
	if err != nil {
		return nil, err
	}
	receiverProfile, err := s.ports.Members.Profile(ctx, tx, transfer.ToCustomerID)
	if err != nil {
		return nil, err
	}
	if sender == nil || receiverProfile == nil {
		return nil, fail(http.StatusNotFound, "Member transfer tidak ditemukan")
	}
	total := domain.ReclaimTotal(plan)
	note := strings.TrimSpace(reason)
	outNote := withNote(fmt.Sprintf("Transfer ditarik kembali staf: %d kredit ke %s", total, displayName(sender)), note)
	inNote := withNote(fmt.Sprintf("Tarik kembali transfer: %d kredit dari %s", total, displayName(receiverProfile)), note)
	for _, p := range plan {
		key := fmt.Sprintf("gym-transfer-reclaim:%s:%d", p.ID, p.Reclaimed)
		if _, err := s.repo.InsertEntry(ctx, tx, NewEntry{
			CustomerID: transfer.ToCustomerID, Type: domain.TransferOut, Amount: -p.Credits, LotID: p.TargetLotID,
			SourceType: SourceTransferReclaim, SourceID: transferID, Note: outNote, IdempotencyKey: key + ":out", CreatedBy: actorID,
		}); err != nil {
			return nil, err
		}
		if _, err := s.repo.InsertEntry(ctx, tx, NewEntry{
			CustomerID: transfer.FromCustomerID, Type: domain.Refund, Amount: p.Credits, LotID: p.SourceLotID,
			SourceType: SourceTransferReclaim, SourceID: transferID, Note: inNote, IdempotencyKey: key + ":in", CreatedBy: actorID,
		}); err != nil {
			return nil, err
		}
		if err := s.repo.AddReclaimed(ctx, tx, p.ID, p.Credits); err != nil {
			return nil, err
		}
	}
	// Credits returned to a lot that lapsed since expire again at once.
	if _, _, err := s.expireLapsedLots(ctx, tx, transfer.FromCustomerID, now); err != nil {
		return nil, err
	}
	if err := s.notifyReclaim(ctx, tx, transfer, total, sender, receiverProfile); err != nil {
		return nil, err
	}
	return &ReclaimResult{TransferID: transferID, Credits: total}, nil
}

func (s *Service) notifyReclaim(ctx context.Context, tx database.Querier, t *TransferDetail, credits int, sender, receiver *MemberProfile) error {
	if s.ports.Notifier == nil {
		return nil
	}
	if err := s.ports.Notifier.NotifyMember(ctx, tx, t.ToCustomerID, Notice{
		Type: "gym_credit_transfer_reclaimed", Title: fmt.Sprintf("%d kredit transfer ditarik kembali", credits),
		Body: fmt.Sprintf("Staf menarik kembali %d kredit kelas yang dikirim %s.", credits, displayName(sender)),
	}); err != nil {
		return err
	}
	return s.ports.Notifier.NotifyMember(ctx, tx, t.FromCustomerID, Notice{
		Type: "gym_credit_transfer_reclaimed", Title: fmt.Sprintf("%d kredit kembali ke saldo", credits),
		Body: fmt.Sprintf("Staf menarik kembali %d kredit kelas dari %s ke saldo Anda.", credits, displayName(receiver)),
	})
}

/* ── Transfer history on the staff credits page ─────────────────────── */

// TransferParty is the other member of a transfer.
type TransferParty struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Phone string  `json:"phone"`
}

// TransferView is one transfer as the staff credits page lists it.
// Direction is "out" (the member sent) or "in" (the member received).
// ReclaimableCredits is what a reclaim would take back now.
type TransferView struct {
	ID                 string        `json:"id"`
	Direction          string        `json:"direction"`
	Counterparty       TransferParty `json:"counterparty"`
	Credits            int           `json:"credits"`
	ReclaimedCredits   int           `json:"reclaimed_credits"`
	ReclaimableCredits int           `json:"reclaimable_credits"`
	Channel            string        `json:"channel"`
	Note               *string       `json:"note"`
	CreatedByName      *string       `json:"created_by_name"`
	CreatedAt          JSTime        `json:"created_at"`
}

// TransferHistory lists the member's transfers with what each can still
// give back.
func (s *Service) TransferHistory(ctx context.Context, q database.Querier, customerID string, limit int) ([]TransferView, error) {
	transfers, err := s.repo.TransfersOf(ctx, q, customerID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]TransferView, 0, len(transfers))
	if len(transfers) == 0 {
		return out, nil
	}
	var partyIDs, staffIDs []string
	for _, t := range transfers {
		partyIDs = append(partyIDs, t.FromCustomerID, t.ToCustomerID)
		if t.CreatedBy != nil {
			staffIDs = append(staffIDs, *t.CreatedBy)
		}
	}
	members, err := s.ports.Members.ByIDs(ctx, q, partyIDs)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]MemberSummary, len(members))
	for _, m := range members {
		byID[m.ID] = m
	}
	staff, err := s.ports.Directory.StaffNames(ctx, q, staffIDs)
	if err != nil {
		return nil, err
	}
	now := s.clock()
	remainders := map[string][]domain.LotRemainder{}
	for _, t := range transfers {
		if _, ok := remainders[t.ToCustomerID]; !ok {
			state, err := s.loadState(ctx, q, t.ToCustomerID)
			if err != nil {
				return nil, err
			}
			remainders[t.ToCustomerID] = domain.LotRemainders(state.lots, state.entries)
		}
		v := TransferView{
			ID: t.ID, Direction: "out", Credits: t.Credits, Channel: t.Channel, Note: t.Note, CreatedAt: JSTime(t.CreatedAt),
			ReclaimableCredits: domain.ReclaimTotal(domain.PlanReclaim(t.Lots, remainders[t.ToCustomerID], now)),
		}
		other := t.ToCustomerID
		if t.ToCustomerID == customerID {
			v.Direction, other = "in", t.FromCustomerID
		}
		party := byID[other]
		v.Counterparty = TransferParty{ID: other, Name: party.Name, Phone: party.Phone}
		for _, l := range t.Lots {
			v.ReclaimedCredits += l.Reclaimed
		}
		if t.CreatedBy != nil {
			v.CreatedByName = staff[*t.CreatedBy]
		}
		out = append(out, v)
	}
	return out, nil
}
