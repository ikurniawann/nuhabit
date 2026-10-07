package memberportal

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// FeedRepository is the inbox, push devices, QR tokens and app home reads.
type FeedRepository interface {
	Notifications(ctx context.Context, customerID string) ([]Notification, error)
	UnreadCount(ctx context.Context, customerID string) (int, error)
	MarkRead(ctx context.Context, customerID string, ids []string) error
	TrackNotification(ctx context.Context, customerID, id, event string) (*string, bool, error)
	InsertNotification(ctx context.Context, customerID, kind, title, body string) error
	PushDeviceCount(ctx context.Context, customerID string) (int, error)
	SavePushSubscription(ctx context.Context, customerID, endpoint, p256dh, auth string, userAgent *string) error
	DeletePushSubscription(ctx context.Context, customerID, endpoint string) error
	IssueQR(ctx context.Context, customerID string) (*MemberQR, error)
	LatestAnnouncements(ctx context.Context, customerID string) ([]AnnouncementRow, error)
	Announcement(ctx context.Context, customerID, id string) (*AnnouncementRow, error)
	AppAccount(ctx context.Context, customerID string) (*AppAccount, error)
	SaveAccount(ctx context.Context, customerID string, setContact bool, contact []byte, acceptWaiver bool, waiverVersion string) error
	ActiveGymBookings(ctx context.Context, customerID string, lateMinutes int) ([]GymBookingRow, error)
	GateVisits(ctx context.Context, customerID string) ([]GateVisitRow, error)
	UpcomingSessions(ctx context.Context, customerID string, from, to time.Time) ([]HomeSession, error)
	BranchNames(ctx context.Context, ids []string) (map[string]string, error)
	SpotlightRace(ctx context.Context, customerID string) (*SpotlightRace, error)
}

// CreditWallet is the gym class-credit wallet (gym credits module): the
// balance, the low-balance flag and the credits expiring soon.
type CreditWallet interface {
	CreditSummary(ctx context.Context, customerID string) (CreditSummary, error)
}

// CreditSummary is the part of loadCreditWallet the app home shows.
type CreditSummary struct {
	Balance         int
	LowBalance      bool
	ExpiringCredits int
}

// NotificationsView is GET /notifications.
type NotificationsView struct {
	Notifications []Notification `json:"notifications"`
	Unread        int            `json:"unread"`
}

// Inbox is the 50 newest notifications and the unread count.
func (s *Service) Inbox(ctx context.Context, customerID string) (*NotificationsView, error) {
	list, err := s.repo.Notifications(ctx, customerID)
	if err != nil {
		return nil, err
	}
	unread, err := s.repo.UnreadCount(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &NotificationsView{Notifications: nonNil(list), Unread: unread}, nil
}

// pushAfter sends queued pushes after the transaction committed.
func (s *Service) pushAfter(customerID string, msg PushMessage) {
	if s.pusher == nil {
		return
	}
	go s.pusher.PushMember(context.Background(), customerID, msg)
}

// ── App home (/app/home/**) ───────────────────────────────────────────────

// AnnouncementView is the member app announcement card.
type AnnouncementView struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Message   string  `json:"message"`
	DeepLink  *string `json:"deepLink"`
	ImageURL  *string `json:"imageUrl"`
	CreatedAt string  `json:"createdAt"`
}

func announcementView(a AnnouncementRow) AnnouncementView {
	return AnnouncementView{
		ID: a.ID, Title: a.Title, Message: a.Body, DeepLink: domain.GoLinkHref(a.LinkURL),
		ImageURL: a.ImageURL, CreatedAt: isoString(a.CreatedAt),
	}
}

// AnnouncementByID returns one announcement the member received.
func (s *Service) AnnouncementByID(ctx context.Context, customerID, id string) (*AnnouncementView, error) {
	if !isUUID(id) {
		return nil, fail(404, "Pengumuman tidak ditemukan")
	}
	a, err := s.repo.Announcement(ctx, customerID, id)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fail(404, "Pengumuman tidak ditemukan")
	}
	v := announcementView(*a)
	return &v, nil
}

type bookingRef struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	WaitlistPosition *int   `json:"waitlistPosition"`
}

type bookingSession struct {
	ID          string `json:"id"`
	ClassTypeID string `json:"classTypeId"`
	StartsAt    string `json:"startsAt"`
	EndsAt      string `json:"endsAt"`
	CreditCost  int    `json:"creditCost"`
}

// BookingView is an active class booking card.
type BookingView struct {
	Booking       bookingRef     `json:"booking"`
	Session       bookingSession `json:"session"`
	ClassTypeName string         `json:"classTypeName"`
	BranchName    string         `json:"branchName"`
}

// ActiveBookings are the member's upcoming and live class bookings.
func (s *Service) ActiveBookings(ctx context.Context, customerID string) ([]BookingView, error) {
	rows, err := s.repo.ActiveGymBookings(ctx, customerID, domain.CheckinLateMinutes)
	if err != nil {
		return nil, err
	}
	out := []BookingView{}
	for _, r := range rows {
		out = append(out, BookingView{
			Booking: bookingRef{ID: r.ID, Status: strings.ToUpper(r.Status), WaitlistPosition: r.WaitlistPosition},
			Session: bookingSession{ID: r.SessionID, ClassTypeID: r.ClassTypeID, StartsAt: isoString(r.StartsAt),
				EndsAt: isoString(r.EndsAt), CreditCost: r.CreditCost},
			ClassTypeName: r.ClassTypeName,
			BranchName:    coalesce("Studio", r.BranchName, r.Area),
		})
	}
	return out, nil
}

type visitLog struct {
	ID          string  `json:"id"`
	Result      string  `json:"result"`
	ReasonCode  *string `json:"reasonCode"`
	CreditDelta int     `json:"creditDelta"`
	CreatedAt   string  `json:"createdAt"`
}

// VisitView is one gate scan.
type VisitView struct {
	Log      visitLog `json:"log"`
	GateName string   `json:"gateName"`
}

// GateVisits are the 100 latest gate scans, allowed and denied.
func (s *Service) GateVisits(ctx context.Context, customerID string) ([]VisitView, error) {
	rows, err := s.repo.GateVisits(ctx, customerID)
	if err != nil {
		return nil, err
	}
	out := []VisitView{}
	for _, r := range rows {
		var reason *string
		if r.Reason != nil && *r.Reason != "" {
			up := strings.ToUpper(*r.Reason)
			reason = &up
		}
		out = append(out, VisitView{
			Log: visitLog{ID: r.ID, Result: strings.ToUpper(r.Decision), ReasonCode: reason,
				CreditDelta: r.CreditDelta, CreatedAt: isoString(r.CreatedAt)},
			GateName: coalesce("Studio", r.ClassTypeName, r.BranchName),
		})
	}
	return out, nil
}

type homeSessionRef struct {
	ID          string `json:"id"`
	ClassTypeID string `json:"classTypeId"`
	StartsAt    string `json:"startsAt"`
}

type homeSessionView struct {
	Session       homeSessionRef `json:"session"`
	ClassTypeName string         `json:"classTypeName"`
	BranchName    string         `json:"branchName"`
	CoachName     string         `json:"coachName"`
	SpotsLeft     int            `json:"spotsLeft"`
	MyBooking     bool           `json:"myBooking"`
}

type spotlightRaceView struct {
	RaceEventID string  `json:"raceEventId"`
	Name        string  `json:"name"`
	City        string  `json:"city"`
	ImageURL    *string `json:"imageUrl"`
	StartsAt    string  `json:"startsAt"`
	DaysToRace  int     `json:"daysToRace"`
	Joined      bool    `json:"joined"`
	GoalSec     *int    `json:"goalSec"`
}

// HomeFeedView is GET /app/home.
type HomeFeedView struct {
	Announcements []AnnouncementView `json:"announcements"`
	RailDay       string             `json:"railDay"`
	TodaySessions []homeSessionView  `json:"todaySessions"`
	SpotlightRace *spotlightRaceView `json:"spotlightRace"`
}

// HomeFeed is the latest announcements, today's (or tomorrow's) classes and
// the spotlight race. Promos come from /promos on the client.
func (s *Service) HomeFeed(ctx context.Context, customerID string) (*HomeFeedView, error) {
	now := s.now()
	announcements, err := s.repo.LatestAnnouncements(ctx, customerID)
	if err != nil {
		return nil, err
	}
	sessions, err := s.repo.UpcomingSessions(ctx, customerID, now, now.Add(48*time.Hour))
	if err != nil {
		return nil, err
	}
	race, err := s.repo.SpotlightRace(ctx, customerID)
	if err != nil {
		return nil, err
	}

	starts := make([]time.Time, len(sessions))
	for i, sess := range sessions {
		starts[i] = sess.StartsAt
	}
	railDay, keep := domain.PickRailDay(starts, now)
	var branchIDs []string
	seen := map[string]bool{}
	for _, i := range keep {
		if id := sessions[i].BranchID; id != nil && *id != "" && !seen[*id] {
			seen[*id] = true
			branchIDs = append(branchIDs, *id)
		}
	}
	names, err := s.repo.BranchNames(ctx, branchIDs)
	if err != nil {
		return nil, err
	}

	feed := &HomeFeedView{Announcements: []AnnouncementView{}, RailDay: railDay, TodaySessions: []homeSessionView{}}
	for _, a := range announcements {
		feed.Announcements = append(feed.Announcements, announcementView(a))
	}
	for _, i := range keep {
		sess := sessions[i]
		branch := ""
		if sess.BranchID != nil {
			branch = names[*sess.BranchID]
		}
		if branch == "" {
			branch = firstNonNil("Studio", sess.Area)
		}
		coach := "-"
		if sess.CoachName != nil {
			coach = *sess.CoachName
		}
		feed.TodaySessions = append(feed.TodaySessions, homeSessionView{
			Session:       homeSessionRef{ID: sess.ID, ClassTypeID: sess.ClassTypeID, StartsAt: isoString(sess.StartsAt)},
			ClassTypeName: sess.ClassTypeName,
			BranchName:    branch,
			CoachName:     coach,
			SpotsLeft:     sess.SeatsLeft,
			MyBooking:     sess.MyBooking != nil && *sess.MyBooking != "waitlist",
		})
	}
	if race != nil {
		feed.SpotlightRace = &spotlightRaceView{
			RaceEventID: race.ID, Name: race.Name, City: race.City,
			ImageURL: domain.RaceImage(race.ImageURL, race.City), StartsAt: isoString(race.StartsAt),
			DaysToRace: domain.DaysUntil(race.StartsAt, now), Joined: race.Joined, GoalSec: race.GoalSec,
		}
	}
	return feed, nil
}

type accountMember struct {
	ID               string          `json:"id"`
	FullName         string          `json:"fullName"`
	Email            string          `json:"email"`
	Phone            string          `json:"phone"`
	AvatarURL        *string         `json:"avatarUrl"`
	Status           string          `json:"status"`
	CreatedAt        string          `json:"createdAt"`
	EmergencyContact json.RawMessage `json:"emergencyContact"`
	WaiverVersion    *string         `json:"waiverVersion"`
	WaiverAcceptedAt *string         `json:"waiverAcceptedAt"`
}

// AccountView is GET /app/home/me.
type AccountView struct {
	Member          accountMember `json:"member"`
	Balance         int           `json:"balance"`
	LowBalance      bool          `json:"lowBalance"`
	ExpiringCredits int           `json:"expiringCredits"`
}

// Account is the identity, emergency contact, waiver and class credits.
func (s *Service) Account(ctx context.Context, credits CreditWallet, customerID string) (*AccountView, error) {
	a, err := s.repo.AppAccount(ctx, customerID)
	if err != nil {
		return nil, err
	}
	summary, err := credits.CreditSummary(ctx, customerID)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fail(404, "Member tidak ditemukan")
	}
	m := accountMember{
		ID: a.ID, FullName: "Member", Phone: a.Phone, AvatarURL: a.PhotoURL, Status: "ACTIVE",
		EmergencyContact: a.EmergencyContact, WaiverVersion: a.WaiverVersion,
	}
	if m.EmergencyContact == nil {
		m.EmergencyContact = json.RawMessage("null")
	}
	if a.Name != nil {
		m.FullName = *a.Name
	}
	if a.Email != nil {
		m.Email = *a.Email
	}
	if a.IsActive != nil && !*a.IsActive {
		m.Status = "INACTIVE"
	}
	m.CreatedAt = isoString(time.UnixMilli(0))
	if a.CreatedAt != nil {
		m.CreatedAt = isoString(*a.CreatedAt)
	}
	if a.WaiverAcceptedAt != nil {
		v := isoString(*a.WaiverAcceptedAt)
		m.WaiverAcceptedAt = &v
	}
	return &AccountView{Member: m, Balance: summary.Balance, LowBalance: summary.LowBalance, ExpiringCredits: summary.ExpiringCredits}, nil
}

// coalesce is `a ?? b ?? fallback`.
func coalesce(fallback string, values ...*string) string {
	for _, v := range values {
		if v != nil {
			return *v
		}
	}
	return fallback
}

// firstNonNil is `a || b || fallback` for strings.
func firstNonNil(fallback string, values ...*string) string {
	for _, v := range values {
		if v != nil && *v != "" {
			return *v
		}
	}
	return fallback
}
