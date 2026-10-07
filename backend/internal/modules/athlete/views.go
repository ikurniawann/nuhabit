package athlete

import (
	"time"

	"nuhabit/backend/internal/modules/athlete/domain"
)

// Response shapes of the Train tab (frontend/src/lib/gym/athlete-views.ts).

// isoTime renders like Date.prototype.toISOString().
type isoTime time.Time

func (t isoTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// Athlete is a member as the Train tab shows them.
type Athlete struct {
	ID        string
	Name      string
	AvatarURL *string
}

func nameOf(people map[string]Athlete, id string) string {
	if a, ok := people[id]; ok {
		return a.Name
	}
	return "Athlete"
}

type ActivityCardView struct {
	ID              string              `json:"id"`
	MemberID        string              `json:"memberId"`
	MemberName      string              `json:"memberName"`
	MemberAvatarURL *string             `json:"memberAvatarUrl"`
	IsOwn           bool                `json:"isOwn"`
	Type            string              `json:"type"`
	Title           string              `json:"title"`
	StartedAt       isoTime             `json:"startedAt"`
	DistanceM       float64             `json:"distanceM"`
	MovingSec       int                 `json:"movingSec"`
	ElapsedSec      int                 `json:"elapsedSec"`
	AvgPaceSecPerKm *int                `json:"avgPaceSecPerKm"`
	ElevationGainM  float64             `json:"elevationGainM"`
	Visibility      string              `json:"visibility"`
	Thumbnail       []domain.TrackPoint `json:"thumbnail"`
	PhotoCount      int                 `json:"photoCount"`
	KudosCount      int                 `json:"kudosCount"`
	HasKudoed       bool                `json:"hasKudoed"`
	CommentCount    int                 `json:"commentCount"`
}

type EffortView struct {
	SegmentID   string  `json:"segmentId"`
	SegmentName string  `json:"segmentName"`
	DistanceM   float64 `json:"distanceM"`
	ElapsedSec  int     `json:"elapsedSec"`
	domain.Placement
}

type GroupedView struct {
	ActivityID string `json:"activityId"`
	MemberName string `json:"memberName"`
}

type ActivityDetailView struct {
	ActivityCardView
	Description      string                 `json:"description"`
	Points           []domain.TrackPoint    `json:"points"`
	Photos           []string               `json:"photos"`
	Splits           []domain.ActivitySplit `json:"splits"`
	BestSplitPaceSec *int                   `json:"bestSplitPaceSec"`
	GearName         *string                `json:"gearName"`
	Efforts          []EffortView           `json:"efforts"`
	Comments         []CommentView          `json:"comments"`
	GroupedWith      []GroupedView          `json:"groupedWith"`
}

type CommentView struct {
	ID         string  `json:"id"`
	MemberID   string  `json:"memberId"`
	MemberName string  `json:"memberName"`
	Text       string  `json:"text"`
	CreatedAt  isoTime `json:"createdAt"`
}

type GearView struct {
	ID        string  `json:"id"`
	MemberID  string  `json:"memberId"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	DistanceM float64 `json:"distanceM"`
	Retired   bool    `json:"retired"`
}

type SettingsView struct {
	Units            string   `json:"units"`
	BookingReminders bool     `json:"bookingReminders"`
	WeeklyGoalKm     *float64 `json:"weeklyGoalKm"`
	Language         string   `json:"language"`
}

// defaultSettings is DEFAULT_SETTINGS: what a member who never saved settings gets.
func defaultSettings() SettingsView {
	return SettingsView{Units: "METRIC", BookingReminders: true, Language: "ID"}
}

// HomeSettingsView is MemberSettingsView (home tab settings, no weekly goal).
type HomeSettingsView struct {
	Units            string `json:"units"`
	BookingReminders bool   `json:"bookingReminders"`
	Language         string `json:"language"`
}

type WeekBucketView struct {
	WeekStart  isoTime `json:"weekStart"`
	DistanceKm float64 `json:"distanceKm"`
	Activities int     `json:"activities"`
	MovingSec  int     `json:"movingSec"`
}

type TotalsView struct {
	Activities int     `json:"activities"`
	DistanceKm float64 `json:"distanceKm"`
	MovingSec  int     `json:"movingSec"`
}

type GoalView struct {
	TargetKm  *float64 `json:"targetKm"`
	CurrentKm float64  `json:"currentKm"`
}

type StatsView struct {
	Weekly         []WeekBucketView       `json:"weekly"`
	Totals         TotalsView             `json:"totals"`
	ThisWeekKm     float64                `json:"thisWeekKm"`
	Goal           GoalView               `json:"goal"`
	PRs            domain.PersonalRecords `json:"prs"`
	Gear           []GearView             `json:"gear"`
	Settings       SettingsView           `json:"settings"`
	FollowingCount int                    `json:"followingCount"`
	FollowerCount  int                    `json:"followerCount"`
}

type RouteView struct {
	ID        string              `json:"id"`
	Name      string              `json:"name"`
	DistanceM float64             `json:"distanceM"`
	Points    []domain.TrackPoint `json:"points"`
	CreatedAt isoTime             `json:"createdAt"`
}

type HeatmapView struct {
	Tracks [][]domain.TrackPoint `json:"tracks"`
}

type SegmentSummaryView struct {
	Segment          domain.Segment `json:"segment"`
	EffortCount      int            `json:"effortCount"`
	BestElapsedSec   *int           `json:"bestElapsedSec"`
	MyBestElapsedSec *int           `json:"myBestElapsedSec"`
	MyRank           *int           `json:"myRank"`
}

type SegmentBoardRow struct {
	Rank       int     `json:"rank"`
	MemberID   string  `json:"memberId"`
	MemberName string  `json:"memberName"`
	ElapsedSec int     `json:"elapsedSec"`
	CreatedAt  isoTime `json:"createdAt"`
	IsMe       bool    `json:"isMe"`
}

type SegmentDetailView struct {
	Segment     domain.Segment    `json:"segment"`
	Leaderboard []SegmentBoardRow `json:"leaderboard"`
	MyRank      *int              `json:"myRank"`
}

type ChallengeInfo struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Type        string  `json:"type"`
	TargetKm    float64 `json:"targetKm"`
	StartsAt    isoTime `json:"startsAt"`
	EndsAt      isoTime `json:"endsAt"`
}

type ChallengeView struct {
	Challenge        ChallengeInfo             `json:"challenge"`
	Joined           bool                      `json:"joined"`
	ParticipantCount int                       `json:"participantCount"`
	ProgressKm       float64                   `json:"progressKm"`
	Leaderboard      []domain.LeaderboardEntry `json:"leaderboard"`
}

type ClubInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Location    string   `json:"location"`
	MemberIDs   []string `json:"memberIds"`
}

type ClubView struct {
	Club              ClubInfo                  `json:"club"`
	Joined            bool                      `json:"joined"`
	MemberCount       int                       `json:"memberCount"`
	WeeklyLeaderboard []domain.LeaderboardEntry `json:"weeklyLeaderboard"`
}

type AthleteLite struct {
	MemberID    string  `json:"memberId"`
	Name        string  `json:"name"`
	WeeklyKm    float64 `json:"weeklyKm"`
	IsFollowing bool    `json:"isFollowing"`
}

type SocialView struct {
	Following   []AthleteLite `json:"following"`
	Followers   []AthleteLite `json:"followers"`
	Suggestions []AthleteLite `json:"suggestions"`
}

type ProfileMember struct {
	ID        string  `json:"id"`
	FullName  string  `json:"fullName"`
	AvatarURL *string `json:"avatarUrl"`
}

type ProfileView struct {
	Member         ProfileMember      `json:"member"`
	IsMe           bool               `json:"isMe"`
	IsFollowing    bool               `json:"isFollowing"`
	FollowerCount  int                `json:"followerCount"`
	FollowingCount int                `json:"followingCount"`
	Totals         TotalsView         `json:"totals"`
	Activities     []ActivityCardView `json:"activities"`
}

type KudosView struct {
	Kudoed bool `json:"kudoed"`
	Count  int  `json:"count"`
}
