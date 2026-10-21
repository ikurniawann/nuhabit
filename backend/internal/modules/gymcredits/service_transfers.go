package gymcredits

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Credit transfers between members. Staff transfer from the credits page;
// members send from the member app when allowMemberCreditTransfer is on.
// Each moved lot becomes a lot of the receiver with the same package and
// expiry (see domain/transfer.go) worth what they were in the sender's lot.
// Inside one company no journal is posted: deferred revenue stays where it
// is until the receiver uses or loses the credits. Across companies the
// value moves between the two deferred revenue accounts (moveLot).

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
	moved, credits, remainders, err := s.planTransfer(ctx, tx, in, now)
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
	books, err := s.transferBooks(ctx, tx, in, moved, remainders)
	if err != nil {
		return nil, err
	}
	outNote := withNote(fmt.Sprintf("Kirim %d kredit ke %s", credits, displayName(receiver)), in.Note)
	inNote := withNote(fmt.Sprintf("Terima %d kredit dari %s", credits, displayName(sender)), in.Note)
	for _, m := range moved {
		if err := s.moveLot(ctx, tx, in, transferID, m, books, outNote, inNote, now); err != nil {
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
// returns the lots, the credits they add up to and the sender's lots as
// they stand before the transfer.
func (s *Service) planTransfer(ctx context.Context, tx database.Querier, in TransferInput, now time.Time) ([]domain.TransferLot, int, []domain.LotRemainder, error) {
	rules, err := s.Rules(ctx, tx, in.BranchID)
	if err != nil {
		return nil, 0, nil, err
	}
	if in.Channel == TransferByMember && !rules.AllowMemberCreditTransfer {
		return nil, 0, nil, transferFail(domain.TransferDisabled)
	}
	state, _, err := s.expireLapsedLots(ctx, tx, in.FromCustomerID, now)
	if err != nil {
		return nil, 0, nil, err
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	moved, problem := domain.PlanTransfer(remainders, in.Lots, in.Credits, now)
	if problem != "" {
		return nil, 0, nil, transferFail(problem)
	}
	credits := 0
	for _, m := range moved {
		credits += m.Credits
	}
	sent, err := s.repo.CreditsSentSince(ctx, tx, in.FromCustomerID, monthStart(now))
	if err != nil {
		return nil, 0, nil, err
	}
	if !domain.WithinTransferCap(rules.MaxTransferCreditsPerMonth, sent, credits) {
		return nil, 0, nil, fail(http.StatusConflict, fmt.Sprintf("%s Sisa bulan ini: %d kredit.",
			domain.TransferProblemMessages[domain.TransferMonthlyCap], max(0, rules.MaxTransferCreditsPerMonth-sent)))
	}
	demands, err := s.creditBookings(ctx, tx, in.FromCustomerID, now)
	if err != nil {
		return nil, 0, nil, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, tx)
	if err != nil {
		return nil, 0, nil, err
	}
	if !domain.CanCover(domain.AfterTransfer(remainders, moved), coverage, demands, now) {
		return nil, 0, nil, transferFail(domain.TransferReserved)
	}
	return moved, credits, remainders, nil
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

// transferBooks is what a transfer needs to value its lots: the sender's
// lot values, how many credits each lot had used, and the company the
// receiver's lots book to (the branch the transfer is made at, else the
// default company) with its zone.
type transferBooks struct {
	values     map[string]LotValue
	remainders []domain.LotRemainder
	receiver   *string
	zone       *time.Location
}

func (s *Service) transferBooks(ctx context.Context, tx database.Querier, in TransferInput, moved []domain.TransferLot, remainders []domain.LotRemainder) (transferBooks, error) {
	ids := make([]string, 0, len(moved))
	for _, m := range moved {
		ids = append(ids, m.Lot.ID)
	}
	values, err := s.repo.LotValues(ctx, tx, ids)
	if err != nil {
		return transferBooks{}, err
	}
	receiver, zone, err := s.repo.CompanyFor(ctx, tx, in.BranchID)
	if err != nil {
		return transferBooks{}, err
	}
	return transferBooks{values: values, remainders: remainders, receiver: receiver, zone: zone}, nil
}

// moveLot cuts m out of the sender's lot and gives the receiver a lot with
// the same package and expiry, linked to it and worth what the credits
// were in the sender's lot. Inside one company deferred revenue stays
// where it is. When the receiver books to another company, the value moves
// between the two companies' deferred revenue through the intercompany
// accounts (GYM_TRANSFER_OUT at the sender's company, GYM_TRANSFER_IN at
// the receiver's), keyed by the two ledger entries.
func (s *Service) moveLot(ctx context.Context, tx database.Querier, in TransferInput, transferID string, m domain.TransferLot, books transferBooks, outNote, inNote string, now time.Time) error {
	key := "gym-transfer:" + transferID + ":" + m.Lot.ID
	value, paid := books.values[m.Lot.ID]
	var sen int64
	company := value.CompanyID
	if paid {
		sen = domain.MoveValueSen(value.ValueSen, value.Credits, domain.UsedIn(books.remainders, m.Lot.ID), -m.Credits)
		if books.receiver != nil {
			company = books.receiver
		}
		trace := fmt.Sprintf(" · Transfer %s · nilai Rp %s", transferID, rupiah(sen))
		outNote, inNote = outNote+trace, inNote+trace
	}
	outID, err := s.repo.InsertEntry(ctx, tx, NewEntry{
		CustomerID: in.FromCustomerID, Type: domain.TransferOut, Amount: -m.Credits, LotID: m.Lot.ID,
		SourceType: "transfer", SourceID: transferID, Note: outNote, IdempotencyKey: key + ":out", CreatedBy: in.ActorID,
	})
	if err != nil {
		return err
	}
	lotID, err := s.repo.InsertLot(ctx, tx, NewLot{
		CustomerID: in.ToCustomerID, PackageID: m.Lot.PackageID, Credits: m.Credits, ExpiresAt: m.Lot.ExpiresAt, SourceLotID: m.Lot.ID,
	})
	if err != nil {
		return err
	}
	if paid {
		if err := s.repo.SetLotBooks(ctx, tx, lotID, sen, company); err != nil {
			return err
		}
	}
	inID, err := s.repo.InsertEntry(ctx, tx, NewEntry{
		CustomerID: in.ToCustomerID, Type: domain.TransferIn, Amount: m.Credits, LotID: lotID,
		SourceType: "transfer", SourceID: transferID, Note: inNote, IdempotencyKey: key + ":in", CreatedBy: in.ActorID,
	})
	if err != nil {
		return err
	}
	if err := s.repo.InsertTransferLot(ctx, tx, transferID, m.Lot.ID, lotID, m.Credits); err != nil {
		return err
	}
	crossCompany := paid && sen > 0 && value.CompanyID != nil && company != nil && *value.CompanyID != *company
	if !crossCompany {
		return nil
	}
	description := fmt.Sprintf("%d kredit gym pindah perusahaan, transfer %s", m.Credits, transferID)
	if err := s.publishJournal(ctx, tx, contracts.Journal{
		EventCode: "GYM_TRANSFER_OUT", DocumentType: "gym_credit_entry", DocumentID: outID, CompanyID: value.CompanyID,
		UserID: in.ActorID, EntryDate: localtime.DayKey(now, value.Zone), Amount: domain.SenToIdr(sen), Description: description,
	}); err != nil {
		return err
	}
	return s.publishJournal(ctx, tx, contracts.Journal{
		EventCode: "GYM_TRANSFER_IN", DocumentType: "gym_credit_entry", DocumentID: inID, CompanyID: company,
		UserID: in.ActorID, EntryDate: localtime.DayKey(now, books.zone), Amount: domain.SenToIdr(sen), Description: description,
	})
}

// rupiah formats sen as "1.234.567,89".
func rupiah(sen int64) string {
	whole, cents := sen/100, sen%100
	digits := strconv.FormatInt(whole, 10)
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return fmt.Sprintf("%s,%02d", b.String(), cents)
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

// normalizePhone reduces an Indonesian number to 62 + digits, so 0812...,
// +62812... and 62812... compare equal.
func normalizePhone(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	switch {
	case strings.HasPrefix(digits, "0"):
		return "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		return "62" + digits
	}
	return digits
}

// MemberTransfer sends credits from the signed-in member to the member
// with that phone number.
func (s *Service) MemberTransfer(ctx context.Context, customerID, phone string, credits int, note, key string) (*TransferResult, error) {
	want := normalizePhone(phone)
	if len(want) < 9 {
		return nil, fail(http.StatusBadRequest, "Nomor HP penerima tidak valid")
	}
	hits, err := s.ports.Members.Search(ctx, s.db, want[len(want)-9:], 20)
	if err != nil {
		return nil, err
	}
	to := ""
	for _, h := range hits {
		if normalizePhone(h.Phone) == want {
			to = h.ID
			break
		}
	}
	if to == "" {
		return nil, fail(http.StatusNotFound, "Tidak ada member dengan nomor HP itu")
	}
	return s.TransferTx(ctx, TransferInput{
		FromCustomerID: customerID, ToCustomerID: to, Credits: credits, Note: note,
		IdempotencyKey: "member:" + customerID + ":" + key, Channel: TransferByMember,
	})
}
