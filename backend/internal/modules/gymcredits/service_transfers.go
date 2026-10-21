package gymcredits

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Credit transfers between members. Staff transfer from the credits page;
// members send from the member app when allowMemberCreditTransfer is on.
// Each moved lot becomes a lot of the receiver with the same package and
// expiry (see domain/transfer.go). Credits keep their purchase value, so no
// journal is posted: deferred revenue stays where it is until the receiver
// uses or loses them.

// Values of gym.credit_transfers.channel.
const (
	TransferByStaff  = "staff"
	TransferByMember = "member"
)

// UpcomingBookings is an optional Directory method: the credits the
// member's confirmed bookings for classes after now will draw.
type UpcomingBookings interface {
	UpcomingBookings(ctx context.Context, db database.Querier, customerID string, now time.Time) ([]domain.Demand, error)
}

// TransferAllowance is what the wallet shows about sending credits:
// whether members may, the monthly cap (0 = none) and what was sent this
// Jakarta calendar month.
type TransferAllowance struct {
	MemberEnabled bool `json:"member_enabled"`
	MonthlyCap    int  `json:"monthly_cap"`
	SentThisMonth int  `json:"sent_this_month"`
}

// TransferInput is one transfer request. Lots picks the sender's lots; when
// empty, Credits come from the live lots earliest expiry first.
type TransferInput struct {
	FromCustomerID string
	ToCustomerID   string
	Credits        int
	Lots           []domain.TransferPick
	Note           string
	IdempotencyKey string
	Channel        string
	ActorID        string
	BranchID       *string
}

// TransferResult is the body of a transfer route. Replayed is true when the
// idempotency key was already used and nothing moved again.
type TransferResult struct {
	TransferID     string `json:"transferId"`
	FromCustomerID string `json:"fromCustomerId"`
	ToCustomerID   string `json:"toCustomerId"`
	Credits        int    `json:"credits"`
	Replayed       bool   `json:"replayed"`
}

func transferFail(p domain.TransferProblem) error {
	status := http.StatusConflict
	switch p {
	case domain.TransferNoCredits, domain.TransferToSelf:
		status = http.StatusBadRequest
	case domain.TransferDisabled:
		status = http.StatusForbidden
	}
	return fail(status, domain.TransferProblemMessages[p])
}

// monthStart is the first instant of t's calendar month in memberZone: the
// cap belongs to the member, not a branch.
func monthStart(t time.Time) time.Time {
	w := t.In(memberZone)
	return time.Date(w.Year(), w.Month(), 1, 0, 0, 0, 0, memberZone)
}

// TransferTx is Transfer in a new transaction.
func (s *Service) TransferTx(ctx context.Context, in TransferInput) (res *TransferResult, err error) {
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err = s.Transfer(ctx, tx, in)
		return err
	})
	return res, err
}

// Transfer moves credits from one member to another in the caller's
// transaction and notifies both.
func (s *Service) Transfer(ctx context.Context, tx database.Querier, in TransferInput) (*TransferResult, error) {
	if in.FromCustomerID == in.ToCustomerID {
		return nil, transferFail(domain.TransferToSelf)
	}
	// Both members' ledgers are locked, in a fixed order so two opposite
	// transfers cannot deadlock.
	first, second := in.FromCustomerID, in.ToCustomerID
	if second < first {
		first, second = second, first
	}
	for _, id := range []string{first, second} {
		if err := s.repo.LockMemberCredits(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	prior, err := s.repo.TransferByKey(ctx, tx, in.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	if prior != nil {
		if prior.FromCustomerID != in.FromCustomerID || prior.ToCustomerID != in.ToCustomerID {
			return nil, fail(http.StatusConflict, "Kunci transfer ini sudah dipakai untuk transfer lain")
		}
		return &TransferResult{
			TransferID: prior.ID, FromCustomerID: prior.FromCustomerID, ToCustomerID: prior.ToCustomerID,
			Credits: prior.Credits, Replayed: true,
		}, nil
	}
	sender, receiver, err := s.transferParties(ctx, tx, in)
	if err != nil {
		return nil, err
	}
	now := s.clock()
	moved, credits, err := s.planTransfer(ctx, tx, in, now)
	if err != nil {
		return nil, err
	}
	transferID, err := s.repo.InsertTransfer(ctx, tx, NewTransfer{
		FromCustomerID: in.FromCustomerID, ToCustomerID: in.ToCustomerID, Credits: credits, Channel: in.Channel,
		Note: strings.TrimSpace(in.Note), IdempotencyKey: in.IdempotencyKey, CreatedBy: in.ActorID,
	})
	if err != nil {
		return nil, err
	}
	if transferID == "" {
		return nil, fail(http.StatusConflict, "Transfer ini sedang diproses, coba lagi")
	}
	outNote := withNote(fmt.Sprintf("Kirim %d kredit ke %s", credits, displayName(receiver)), in.Note)
	inNote := withNote(fmt.Sprintf("Terima %d kredit dari %s", credits, displayName(sender)), in.Note)
	for _, m := range moved {
		if err := s.moveLot(ctx, tx, in, transferID, m, outNote, inNote); err != nil {
			return nil, err
		}
	}
	if err := s.notifyTransfer(ctx, tx, in, credits, sender, receiver); err != nil {
		return nil, err
	}
	return &TransferResult{TransferID: transferID, FromCustomerID: in.FromCustomerID, ToCustomerID: in.ToCustomerID, Credits: credits}, nil
}

// transferParties checks that both members exist and the receiver is active.
func (s *Service) transferParties(ctx context.Context, tx database.Querier, in TransferInput) (sender, receiver *MemberProfile, err error) {
	if sender, err = s.ports.Members.Profile(ctx, tx, in.FromCustomerID); err != nil {
		return nil, nil, err
	}
	if receiver, err = s.ports.Members.Profile(ctx, tx, in.ToCustomerID); err != nil {
		return nil, nil, err
	}
	switch {
	case sender == nil:
		return nil, nil, fail(http.StatusNotFound, "Member pengirim tidak ditemukan")
	case receiver == nil:
		return nil, nil, fail(http.StatusNotFound, "Member penerima tidak ditemukan")
	case !receiver.IsActive:
		return nil, nil, fail(http.StatusConflict, "Keanggotaan penerima tidak aktif")
	}
	return sender, receiver, nil
}

// planTransfer applies the rules (member transfers on, monthly cap) and
// picks the lots, keeping what the sender's upcoming bookings need. It
// returns the lots and the credits they add up to.
func (s *Service) planTransfer(ctx context.Context, tx database.Querier, in TransferInput, now time.Time) ([]domain.TransferLot, int, error) {
	rules, err := s.Rules(ctx, tx, in.BranchID)
	if err != nil {
		return nil, 0, err
	}
	if in.Channel == TransferByMember && !rules.AllowMemberCreditTransfer {
		return nil, 0, transferFail(domain.TransferDisabled)
	}
	state, _, err := s.expireLapsedLots(ctx, tx, in.FromCustomerID, now)
	if err != nil {
		return nil, 0, err
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	moved, problem := domain.PlanTransfer(remainders, in.Lots, in.Credits, now)
	if problem != "" {
		return nil, 0, transferFail(problem)
	}
	credits := 0
	for _, m := range moved {
		credits += m.Credits
	}
	sent, err := s.repo.CreditsSentSince(ctx, tx, in.FromCustomerID, monthStart(now))
	if err != nil {
		return nil, 0, err
	}
	if !domain.WithinTransferCap(rules.MaxTransferCreditsPerMonth, sent, credits) {
		return nil, 0, fail(http.StatusConflict, fmt.Sprintf("%s Sisa bulan ini: %d kredit.",
			domain.TransferProblemMessages[domain.TransferMonthlyCap], max(0, rules.MaxTransferCreditsPerMonth-sent)))
	}
	demands, err := s.creditBookings(ctx, tx, in.FromCustomerID, now)
	if err != nil {
		return nil, 0, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, tx)
	if err != nil {
		return nil, 0, err
	}
	if !domain.CanCover(domain.AfterTransfer(remainders, moved), coverage, demands, now) {
		return nil, 0, transferFail(domain.TransferReserved)
	}
	return moved, credits, nil
}

// creditBookings is what the member's upcoming bookings will draw, leaving
// out the classes a pass covers.
func (s *Service) creditBookings(ctx context.Context, tx database.Querier, customerID string, now time.Time) ([]domain.Demand, error) {
	source, ok := s.ports.Directory.(UpcomingBookings)
	if !ok {
		return nil, nil
	}
	all, err := source.UpcomingBookings(ctx, tx, customerID, now)
	if err != nil {
		return nil, err
	}
	var out []domain.Demand
	for _, d := range all {
		pass, err := s.repo.ActivePassAt(ctx, tx, customerID, d.At)
		if err != nil {
			return nil, err
		}
		if pass == nil {
			out = append(out, d)
		}
	}
	return out, nil
}

// moveLot cuts m out of the sender's lot and gives the receiver a lot with
// the same package and expiry, linked to it.
func (s *Service) moveLot(ctx context.Context, tx database.Querier, in TransferInput, transferID string, m domain.TransferLot, outNote, inNote string) error {
	key := "gym-transfer:" + transferID + ":" + m.Lot.ID
	if _, err := s.repo.InsertEntry(ctx, tx, NewEntry{
		CustomerID: in.FromCustomerID, Type: domain.TransferOut, Amount: -m.Credits, LotID: m.Lot.ID,
		SourceType: "transfer", SourceID: transferID, Note: outNote, IdempotencyKey: key + ":out", CreatedBy: in.ActorID,
	}); err != nil {
		return err
	}
	lotID, err := s.repo.InsertLot(ctx, tx, NewLot{
		CustomerID: in.ToCustomerID, PackageID: m.Lot.PackageID, Credits: m.Credits, ExpiresAt: m.Lot.ExpiresAt, SourceLotID: m.Lot.ID,
	})
	if err != nil {
		return err
	}
	if _, err := s.repo.InsertEntry(ctx, tx, NewEntry{
		CustomerID: in.ToCustomerID, Type: domain.TransferIn, Amount: m.Credits, LotID: lotID,
		SourceType: "transfer", SourceID: transferID, Note: inNote, IdempotencyKey: key + ":in", CreatedBy: in.ActorID,
	}); err != nil {
		return err
	}
	return s.repo.InsertTransferLot(ctx, tx, transferID, m.Lot.ID, lotID, m.Credits)
}

func (s *Service) notifyTransfer(ctx context.Context, tx database.Querier, in TransferInput, credits int, sender, receiver *MemberProfile) error {
	if s.ports.Notifier == nil {
		return nil
	}
	if err := s.ports.Notifier.NotifyMember(ctx, tx, in.FromCustomerID, Notice{
		Type: "gym_credit_transfer", Title: fmt.Sprintf("%d kredit terkirim", credits),
		Body: fmt.Sprintf("%d kredit kelas dikirim ke %s.", credits, displayName(receiver)),
	}); err != nil {
		return err
	}
	return s.ports.Notifier.NotifyMember(ctx, tx, in.ToCustomerID, Notice{
		Type: "gym_credit_transfer", Title: fmt.Sprintf("Kamu menerima %d kredit", credits),
		Body: fmt.Sprintf("%s mengirim %d kredit kelas. Masa berlaku dan jenis kelasnya mengikuti kredit asal.", displayName(sender), credits),
	})
}

func displayName(p *MemberProfile) string {
	if p.Name != nil && strings.TrimSpace(*p.Name) != "" {
		return strings.TrimSpace(*p.Name)
	}
	return p.Phone
}

func withNote(base, note string) string {
	if note = strings.TrimSpace(note); note != "" {
		return base + ": " + note
	}
	return base
}

/* ── Member app ──────────────────────────────────────────────────────── */

// MemberTransfer sends credits from the signed-in member to the member
// with that phone number (see service_transfer_lookup.go).
func (s *Service) MemberTransfer(ctx context.Context, customerID, phone string, credits int, note, key string) (*TransferResult, error) {
	to, err := s.findTransferReceiver(ctx, phone)
	if err != nil {
		return nil, err
	}
	return s.TransferTx(ctx, TransferInput{
		FromCustomerID: customerID, ToCustomerID: to, Credits: credits, Note: note,
		IdempotencyKey: "member:" + customerID + ":" + key, Channel: TransferByMember,
	})
}
