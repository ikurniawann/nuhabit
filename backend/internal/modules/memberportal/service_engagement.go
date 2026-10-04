package memberportal

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// EngagementRepository is promos, events, challenges, reviews and the tab.
type EngagementRepository interface {
	MemberPromoRows(ctx context.Context, customerID string) ([]domain.PromoRow, error)
	OpenEvents(ctx context.Context, customerID string) ([]EventView, error)
	LockEvent(ctx context.Context, eventID string) (*LockedEvent, error)
	EventBookingStats(ctx context.Context, eventID, customerID string) (confirmed, lastWaitlist int, mine bool, err error)
	InsertEventBooking(ctx context.Context, eventID, customerID, status string, position *int) error
	LockEventBooking(ctx context.Context, bookingID string) (*LockedBooking, error)
	SetEventBookingStatus(ctx context.Context, bookingID, status string, lateCancel bool) error
	EventWaitlist(ctx context.Context, eventID string) ([]domain.WaitlistEntry, error)
	PromoteEventBooking(ctx context.Context, bookingID string) error
	MemberChallenges(ctx context.Context, customerID string) ([]ChallengeRow, error)
	UnrewardedChallenges(ctx context.Context, customerID string) ([]ChallengeRow, error)
	ChallengeValues(ctx context.Context, c ChallengeRow, customerIDs []string) ([]ChallengeValue, error)
	ClaimChallengeReward(ctx context.Context, challengeID, customerID string) (bool, error)
	CustomerNames(ctx context.Context, ids []string) (map[string]*string, error)
	JoinChallenge(ctx context.Context, challengeID, customerID string) (bool, error)
	ReviewableOrders(ctx context.Context, customerID string, windowDays int) ([]ReviewableOrderRow, error)
	MemberReviews(ctx context.Context, customerID string) ([]MemberReview, error)
	ReviewTarget(ctx context.Context, orderID string) (*ReviewTarget, error)
	InsertReview(ctx context.Context, orderID, customerID string, branchID *string, rating int, comment *string) (*InsertedReview, error)
	MemberExists(ctx context.Context, customerID string) (bool, error)
	OpenBillOrders(ctx context.Context, customerID string) ([]BillOrder, error)
	BillItems(ctx context.Context, orderIDs []string) ([]BillItem, error)
	BillPayments(ctx context.Context, customerID string) ([]BillPayment, error)
	BillTotals(ctx context.Context, customerID string) (paid, settled float64, err error)
}

// Promos are the portal promos with one public code per campaign.
func (s *Service) Promos(ctx context.Context, customerID string) ([]domain.MemberPromo, error) {
	rows, err := s.repo.MemberPromoRows(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return domain.SelectMemberPromos(rows, domain.TodayWIB(s.now())), nil
}

// ── Events ────────────────────────────────────────────────────────────────

// BookEvent confirms, waitlists or denies a booking. The event row is
// locked so the last two applicants cannot both take the last seat.
func (s *Service) BookEvent(ctx context.Context, customerID, eventID string) (domain.BookingDecision, error) {
	var decision domain.BookingDecision
	var push *PushMessage
	err := s.repo.InTx(ctx, func(tx Repository) error {
		event, err := tx.LockEvent(ctx, eventID)
		if err != nil {
			return err
		}
		if event == nil {
			decision = domain.BookingDecision{Kind: "deny", Reason: "event_not_open"}
			return nil
		}
		confirmed, last, mine, err := tx.EventBookingStats(ctx, eventID, customerID)
		if err != nil {
			return err
		}
		decision = domain.EvaluateBooking(domain.BookableEvent{
			Status: event.Status, StartsAt: event.StartsAt, Capacity: event.Capacity, BookingClosesHours: event.BookingClosesHours,
		}, confirmed, last, mine, s.now())
		if decision.Kind == "deny" {
			return nil
		}
		status := "confirmed"
		var position *int
		if decision.Kind == "waitlist" {
			status = "waitlist"
			p := decision.Position
			position = &p
		}
		if err := tx.InsertEventBooking(ctx, eventID, customerID, status, position); err != nil {
			return err
		}
		msg := PushMessage{Type: "booking_confirmed", Title: "Terdaftar: " + event.Title, Body: "Sampai jumpa " + domain.FormatWIB(event.StartsAt) + "."}
		if decision.Kind == "waitlist" {
			msg = PushMessage{Type: "booking_waitlist", Title: "Masuk waitlist: " + event.Title,
				Body: "Posisi Anda #" + strconv.Itoa(decision.Position) + ". Kami kabari bila ada kursi kosong."}
		}
		push = &msg
		return tx.InsertNotification(ctx, customerID, msg.Type, msg.Title, msg.Body)
	})
	if err != nil {
		return decision, err
	}
	if push != nil {
		s.pushAfter(customerID, *push)
	}
	return decision, nil
}

// CancelResult is the DELETE /events body.
type CancelResult struct {
	OK         bool `json:"ok"`
	LateCancel bool `json:"lateCancel"`
}

// CancelEventBooking cancels the member's own booking; a released seat goes
// to the head of the waitlist.
func (s *Service) CancelEventBooking(ctx context.Context, customerID, bookingID string) (*CancelResult, error) {
	var result *CancelResult
	var rejected *failure
	type pending struct {
		customerID string
		msg        PushMessage
	}
	var pushes []pending
	err := s.repo.InTx(ctx, func(tx Repository) error {
		b, err := tx.LockEventBooking(ctx, bookingID)
		if err != nil {
			return err
		}
		if b == nil || b.CustomerID != customerID {
			rejected = fail(409, "Booking tidak ditemukan")
			return nil
		}
		if !domain.CanChangeBooking(b.Status, "cancelled") {
			rejected = fail(409, "Status booking ini tidak bisa diubah lagi")
			return nil
		}
		late := b.Status == "confirmed" && domain.IsLateCancel(b.StartsAt, b.CancelDeadlineHours, s.now())
		if err := tx.SetEventBookingStatus(ctx, bookingID, "cancelled", late); err != nil {
			return err
		}
		if b.Status == "confirmed" {
			waiting, err := tx.EventWaitlist(ctx, b.EventID)
			if err != nil {
				return err
			}
			if next := domain.PickWaitlistPromotion(waiting); next != nil {
				if err := tx.PromoteEventBooking(ctx, next.ID); err != nil {
					return err
				}
				msg := PushMessage{Type: "waitlist_promoted", Title: "Kursi tersedia: " + b.Title,
					Body: "Anda naik dari waitlist dan sudah terdaftar untuk " + domain.FormatWIB(b.StartsAt) + "."}
				if err := tx.InsertNotification(ctx, next.CustomerID, msg.Type, msg.Title, msg.Body); err != nil {
					return err
				}
				pushes = append(pushes, pending{next.CustomerID, msg})
			}
		}
		result = &CancelResult{OK: true, LateCancel: late}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if rejected != nil {
		return nil, rejected
	}
	for _, p := range pushes {
		s.pushAfter(p.customerID, p.msg)
	}
	return result, nil
}

// ── Challenges ────────────────────────────────────────────────────────────

const leaderboardSize = 5

type leaderboardEntry struct {
	Rank  int     `json:"rank"`
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	IsMe  bool    `json:"is_me"`
}

// ChallengeView is a challenge with phase, progress and leaderboard.
type ChallengeView struct {
	ChallengeRow
	Phase       string                    `json:"phase"`
	Joined      bool                      `json:"joined"`
	Progress    *domain.ChallengeProgress `json:"progress"`
	MyRank      *int                      `json:"my_rank"`
	Leaderboard []leaderboardEntry        `json:"leaderboard"`
}

// Challenges settles reached rewards first, then lists running challenges
// (and joined ones that ended in the last 7 days) with progress.
func (s *Service) Challenges(ctx context.Context, customerID string) ([]ChallengeView, error) {
	if err := s.settleChallengeRewards(ctx, customerID); err != nil {
		return nil, err
	}
	rows, err := s.repo.MemberChallenges(ctx, customerID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := []ChallengeView{}
	for _, row := range rows {
		values, err := s.repo.ChallengeValues(ctx, row, nil)
		if err != nil {
			return nil, err
		}
		sort.SliceStable(values, func(i, j int) bool { return values[i].Value > values[j].Value })
		top := values
		if len(top) > leaderboardSize {
			top = top[:leaderboardSize]
		}
		ids := make([]string, len(top))
		for i, v := range top {
			ids[i] = v.CustomerID
		}
		names, err := s.repo.CustomerNames(ctx, ids)
		if err != nil {
			return nil, err
		}
		view := ChallengeView{
			ChallengeRow: row,
			Phase:        domain.ChallengePhase(row.StartsAt.Time, row.EndsAt.Time, now),
			Joined:       row.JoinedAt.Valid,
			Leaderboard:  []leaderboardEntry{},
		}
		if view.Joined {
			mine := 0.0
			rank := 0
			for i, v := range values {
				if v.CustomerID == customerID {
					mine, rank = v.Value, i+1
					break
				}
			}
			p := domain.Progress(mine, row.Target)
			view.Progress = &p
			view.MyRank = &rank
		}
		for i, v := range top {
			view.Leaderboard = append(view.Leaderboard, leaderboardEntry{
				Rank: i + 1, Name: domain.LeaderboardName(names[v.CustomerID]), Value: v.Value, IsMe: v.CustomerID == customerID,
			})
		}
		out = append(out, view)
	}
	return out, nil
}

// settleChallengeRewards hands out the rewards of completed challenges. The
// rewarded_at mark is claimed first with a conditional UPDATE, so two
// concurrent requests never pay twice.
func (s *Service) settleChallengeRewards(ctx context.Context, customerID string) error {
	pending, err := s.repo.UnrewardedChallenges(ctx, customerID)
	if err != nil {
		return err
	}
	for _, c := range pending {
		values, err := s.repo.ChallengeValues(ctx, c, []string{customerID})
		if err != nil {
			return err
		}
		value := 0.0
		for _, v := range values {
			if v.CustomerID == customerID {
				value = v.Value
			}
		}
		if !domain.Progress(value, c.Target).Completed {
			continue
		}
		claimed, err := s.repo.ClaimChallengeReward(ctx, c.ID, customerID)
		if err != nil {
			return err
		}
		if !claimed {
			continue
		}
		var rewards []string
		if c.RewardXP > 0 {
			venue := s.repo.DefaultVenue(ctx)
			if _, err := s.loyalty.AwardFlatXP(ctx, XPAward{
				CustomerID: customerID, XPAmount: float64(c.RewardXP), CompanyID: venue.CompanyID, BranchID: venue.BranchID,
				SourceType: "challenge", SourceID: c.ID, ReferenceTable: "challenges",
				IdempotencyKey: "challenge:" + c.ID + ":" + customerID, Description: "Hadiah challenge: " + c.Title,
			}); err != nil {
				return err
			}
			rewards = append(rewards, strconv.Itoa(c.RewardXP)+" XP")
		}
		if ark := deref(c.RewardArkIdr); ark > 0 {
			coins, err := s.wallet.CreditBonus(ctx, customerID, ark, "Hadiah challenge: "+c.Title)
			if err != nil {
				return err
			}
			rewards = append(rewards, jsNumberString(coins)+" ARK Coin")
		}
		msg := PushMessage{Type: "challenge_completed", Title: "Challenge selesai: " + c.Title, Body: "Selamat, target tercapai!"}
		if len(rewards) > 0 {
			msg.Body = "Hadiah " + strings.Join(rewards, " + ") + " sudah masuk ke akun Anda."
		}
		if err := s.repo.InsertNotification(ctx, customerID, msg.Type, msg.Title, msg.Body); err != nil {
			return err
		}
		s.pushAfter(customerID, msg)
	}
	return nil
}

// ── Reviews ───────────────────────────────────────────────────────────────

// ReviewsView is GET /reviews.
type ReviewsView struct {
	Eligible []ReviewableOrderRow `json:"eligible"`
	Reviews  []MemberReview       `json:"reviews"`
}

// Reviews lists reviewable paid orders and the member's reviews.
func (s *Service) Reviews(ctx context.Context, customerID string) (*ReviewsView, error) {
	eligible, err := s.repo.ReviewableOrders(ctx, customerID, domain.ReviewWindowDays)
	if err != nil {
		return nil, err
	}
	reviews, err := s.repo.MemberReviews(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &ReviewsView{Eligible: nonNil(eligible), Reviews: nonNil(reviews)}, nil
}

// WriteReview rates one paid order (1-5 stars, optional comment).
func (s *Service) WriteReview(ctx context.Context, customerID, orderID string, rating int, comment *string) (*InsertedReview, error) {
	target, err := s.repo.ReviewTarget(ctx, orderID)
	if err != nil {
		return nil, err
	}
	var order *domain.ReviewableOrder
	reviewed := false
	if target != nil {
		order = &domain.ReviewableOrder{CustomerID: target.CustomerID, PaymentStatus: target.PaymentStatus, Status: target.Status, PaidAt: target.PaidAt}
		reviewed = target.Reviewed
	}
	if reason := domain.ReviewEligibility(order, customerID, s.now(), reviewed); reason != "" {
		status := 400
		if reason == "sudah-diulas" {
			status = 409
		}
		return nil, fail(status, domain.ReviewIneligibleMessages[reason])
	}
	inserted, err := s.repo.InsertReview(ctx, orderID, customerID, target.BranchID, rating, domain.CleanReviewText(comment, domain.ReviewCommentMax))
	if err != nil {
		return nil, err
	}
	if inserted == nil {
		return nil, fail(409, domain.ReviewIneligibleMessages["sudah-diulas"])
	}
	return inserted, nil
}

// ── Member tab (bills) ────────────────────────────────────────────────────

type billBalance struct {
	OpenTotal   float64 `json:"openTotal"`
	Credit      float64 `json:"credit"`
	Outstanding float64 `json:"outstanding"`
	Surplus     float64 `json:"surplus"`
	CanSettle   bool    `json:"canSettle"`
}

type billItemView struct {
	Name        *string  `json:"name"`
	Quantity    float64  `json:"quantity"`
	TotalAmount float64  `json:"total_amount"`
	Options     []string `json:"options"`
}

type billOrderView struct {
	ID          string         `json:"id"`
	OrderNumber *string        `json:"order_number"`
	OrderedAt   string         `json:"ordered_at"`
	TotalAmount float64        `json:"total_amount"`
	Items       []billItemView `json:"items"`
}

type billPaymentView struct {
	ID        string  `json:"id"`
	Amount    float64 `json:"amount"`
	Method    string  `json:"method"`
	CreatedAt string  `json:"created_at"`
}

// BillView is GET /bills: read-only, payment stays at the till.
type BillView struct {
	Balance    billBalance       `json:"balance"`
	OpenOrders []billOrderView   `json:"open_orders"`
	Payments   []billPaymentView `json:"payments"`
}

func round2(v float64) float64 { return math.Floor(v*100+0.5) / 100 }

// Bill is the member's open tab: open orders with items, the balance and
// the instalments. Cashier names, notes and references are not sent.
func (s *Service) Bill(ctx context.Context, customerID string) (*BillView, error) {
	exists, err := s.repo.MemberExists(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errMemberBillMissing
	}
	orders, err := s.repo.OpenBillOrders(ctx, customerID)
	if err != nil {
		return nil, err
	}
	payments, err := s.repo.BillPayments(ctx, customerID)
	if err != nil {
		return nil, err
	}
	paid, settled, err := s.repo.BillTotals(ctx, customerID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(orders))
	var openTotal float64
	for i, o := range orders {
		ids[i] = o.ID
		openTotal += o.TotalAmount
	}
	items, err := s.repo.BillItems(ctx, ids)
	if err != nil {
		return nil, err
	}

	open := round2(math.Max(0, openTotal))
	credit := round2(math.Max(0, paid-settled))
	diff := round2(open - credit)
	view := &BillView{
		Balance:    billBalance{OpenTotal: open, Credit: credit, Outstanding: math.Max(0, diff), Surplus: math.Max(0, -diff), CanSettle: open > 0 && diff <= 0},
		OpenOrders: []billOrderView{},
		Payments:   []billPaymentView{},
	}
	for _, o := range orders {
		ov := billOrderView{ID: o.ID, OrderNumber: o.OrderNumber, OrderedAt: isoString(o.OrderedAt), TotalAmount: o.TotalAmount, Items: []billItemView{}}
		for _, it := range items {
			if it.OrderID != o.ID {
				continue
			}
			ov.Items = append(ov.Items, billItemView{
				Name: it.Name, Quantity: it.Quantity, TotalAmount: it.TotalAmount,
				Options: append(optionNames(it.Variants), optionNames(it.Modifiers)...),
			})
		}
		view.OpenOrders = append(view.OpenOrders, ov)
	}
	for _, p := range payments {
		method := p.PaymentMethod
		if p.PaymentMethodName != nil {
			method = *p.PaymentMethodName
		}
		view.Payments = append(view.Payments, billPaymentView{ID: p.ID, Amount: p.Amount, Method: method, CreatedAt: isoString(p.CreatedAt)})
	}
	return view, nil
}

// errMemberBillMissing is thrown by getMemberBillDetail; the route answers 500.
var errMemberBillMissing = errors.New("Member tidak ditemukan")

// optionNames reads the "name" of each variant/modifier object, skipping
// empty ones (namesOf in member-bill-server.ts).
func optionNames(raw json.RawMessage) []string {
	var list []any
	if json.Unmarshal(raw, &list) != nil {
		return []string{}
	}
	out := []string{}
	for _, entry := range list {
		m, isObj := entry.(map[string]any)
		if !isObj {
			continue
		}
		var name string
		switch v := m["name"].(type) {
		case nil:
		case string:
			name = v
		case float64:
			name = jsNumberString(v)
		case bool:
			name = strconv.FormatBool(v)
		default:
			b, _ := json.Marshal(v)
			name = string(b)
		}
		if name != "" {
			out = append(out, name)
		}
	}
	return out
}
