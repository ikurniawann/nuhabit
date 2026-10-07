package athlete

import (
	"context"
	"fmt"
	"time"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// ── Ports ────────────────────────────────────────────────────────────────────

// Repository persists the gym.athlete_* tables, and only those.
type Repository interface {
	// InTx runs fn with a repository bound to one transaction.
	InTx(ctx context.Context, fn func(Repository) error) error

	MemberActivities(ctx context.Context, customerID string, full bool) ([]domain.Activity, error)
	RecentSummaries(ctx context.Context, limit int) ([]domain.Activity, error)
	Activity(ctx context.Context, id string) (*domain.Activity, error)
	PointsByID(ctx context.Context, ids []string) (map[string][]domain.TrackPoint, error)
	InsertActivity(ctx context.Context, customerID string, in SaveActivityInput, title string, startedAt time.Time, f domain.ActivityFigures) (string, error)
	UpdateActivity(ctx context.Context, id, title, description, visibility string, gearID *string) error
	DeleteActivity(ctx context.Context, id string) error
	InsertWorkoutActivity(ctx context.Context, s CompletedWorkoutSession) error
	GroupCandidates(ctx context.Context, a domain.Activity, limit int) ([]domain.GroupCandidate, error)
	HeatmapTracks(ctx context.Context, customerID string) ([][]domain.TrackPoint, error)
	CardCounts(ctx context.Context, ids []string, viewerID string) (map[string]CardCounts, error)

	FollowingOf(ctx context.Context, customerID string) ([]string, error)
	FollowersOf(ctx context.Context, customerID string) ([]string, error)
	CountFollows(ctx context.Context, customerID string) (following, followers int, err error)
	DeleteFollow(ctx context.Context, followerID, followeeID string) (int64, error)
	InsertFollow(ctx context.Context, followerID, followeeID string) error

	DeleteKudos(ctx context.Context, activityID, customerID string) (int64, error)
	InsertKudos(ctx context.Context, activityID, customerID string) error
	CountKudos(ctx context.Context, activityID string) (int, error)
	InsertComment(ctx context.Context, activityID, customerID, text string) (string, time.Time, error)
	Comments(ctx context.Context, activityID string) ([]CommentRow, error)

	Segments(ctx context.Context) ([]domain.Segment, error)
	InsertEffort(ctx context.Context, segmentID, activityID, customerID string, elapsedSec int) error
	ActivityEfforts(ctx context.Context, activityID string) ([]ActivityEffortRow, error)
	Efforts(ctx context.Context, segmentID *string) ([]domain.Effort, error)

	OwnsGear(ctx context.Context, gearID, customerID string) (bool, error)
	MoveGearMileage(ctx context.Context, gearID string, deltaM float64) error
	GearList(ctx context.Context, customerID string) ([]GearView, error)
	GearName(ctx context.Context, gearID string) (*string, error)
	UpdateGear(ctx context.Context, gearID, customerID string, in GearInput) (*GearView, error)
	InsertGear(ctx context.Context, customerID string, in GearInput) (GearView, error)

	Routes(ctx context.Context, customerID string) ([]RouteRow, error)
	InsertRoute(ctx context.Context, customerID, name string, points []domain.TrackPoint, distanceM float64) (RouteRow, error)
	DeleteRoute(ctx context.Context, routeID, customerID string) (int64, error)

	Settings(ctx context.Context, customerID string) (*SettingsView, error)
	UpsertSettings(ctx context.Context, customerID string, s SettingsView) error
	PatchHomeSettings(ctx context.Context, customerID string, p SettingsPatch, defaults SettingsView) error

	Challenges(ctx context.Context) ([]ChallengeInfoRow, error)
	ChallengeParticipants(ctx context.Context) (map[string][]string, error)
	JoinChallenge(ctx context.Context, challengeID, customerID string) (int64, error)
	ChallengeExists(ctx context.Context, challengeID string) (bool, error)
	LeaveChallenge(ctx context.Context, challengeID, customerID string) error

	Clubs(ctx context.Context) ([]ClubInfo, error)
	ClubMembers(ctx context.Context) (map[string][]string, error)
	DeleteClubMember(ctx context.Context, clubID, customerID string) (int64, error)
	InsertClubMember(ctx context.Context, clubID, customerID string) (int64, error)
}

// Members reads member identity (pos.pos_customers), owned outside this module.
type Members interface {
	Athletes(ctx context.Context, ids []string) (map[string]Athlete, error)
	// ActiveMemberIDs lists active members (oldest first, max 200), filtered
	// by a case-insensitive name search when search is not empty.
	ActiveMemberIDs(ctx context.Context, search string) ([]string, error)
}

// WorkoutSessions reads completed HYROX workout sessions (gym-training) that
// have not been synced into the activity log yet.
type WorkoutSessions interface {
	UnsyncedCompleted(ctx context.Context, customerID *string) ([]CompletedWorkoutSession, error)
}

// CompletedWorkoutSession is a finished workout session and its workout definition.
type CompletedWorkoutSession struct {
	ID            string
	CustomerID    string
	WorkoutType   string
	Blocks        []domain.WorkoutBlock
	StartedAt     time.Time
	ActiveSec     int
	TotalPauseSec int
}

// Row types the repository returns.
type (
	CardCounts struct {
		Kudos    int
		Kudoed   bool
		Comments int
	}
	CommentRow struct {
		ID         string
		CustomerID string
		Text       string
		CreatedAt  time.Time
	}
	ActivityEffortRow struct {
		SegmentID  string
		Name       string
		DistanceM  float64
		ElapsedSec int
		Board      []domain.Effort
	}
	RouteRow struct {
		ID        string
		Name      string
		DistanceM float64
		Points    []domain.TrackPoint
		CreatedAt time.Time
	}
	ChallengeInfoRow struct {
		ID          string
		Name        string
		Description string
		Type        string
		TargetKm    float64
		StartsAt    time.Time
		EndsAt      time.Time
	}
)

// ── Service ──────────────────────────────────────────────────────────────────

// Service holds the Train tab use cases (athlete-*-server.ts).
type Service struct {
	repo     Repository
	members  Members
	workouts WorkoutSessions
	now      func() time.Time
}

func NewService(repo Repository, members Members, workouts WorkoutSessions, now func() time.Time) *Service {
	return &Service{repo: repo, members: members, workouts: workouts, now: now}
}

func notFound(what string) error { return httpx.Status(404, what+" tidak ditemukan") }

// clock is the current time at JavaScript Date precision.
func (s *Service) clock() time.Time { return s.now().Truncate(time.Millisecond) }

// syncWorkouts copies completed workout sessions into the log as WORKOUT
// activities; nil customerID syncs every member (feed). Idempotent through
// the unique (source_type, source_id) index.
func (s *Service) syncWorkouts(ctx context.Context, customerID *string) error {
	sessions, err := s.workouts.UnsyncedCompleted(ctx, customerID)
	if err != nil {
		return fmt.Errorf("athlete: reading workout sessions: %w", err)
	}
	for _, session := range sessions {
		if err := s.repo.InsertWorkoutActivity(ctx, session); err != nil {
			return err
		}
	}
	return nil
}

func followSet(ids []string) map[string]bool {
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set
}

func contributions(activities []domain.Activity) []domain.Contribution {
	out := make([]domain.Contribution, len(activities))
	for i, a := range activities {
		out[i] = domain.Contribution{MemberID: a.MemberID, Type: a.Type, DistanceM: a.DistanceM, MovingSec: a.MovingSec, StartedAt: a.StartedAt}
	}
	return out
}

// loadActivity returns the activity or 404 "Aktivitas tidak ditemukan".
func loadActivity(ctx context.Context, repo Repository, id string) (domain.Activity, error) {
	a, err := repo.Activity(ctx, id)
	if err != nil {
		return domain.Activity{}, err
	}
	if a == nil {
		return domain.Activity{}, notFound("Aktivitas")
	}
	return *a, nil
}

// visibleActivity is an activity the viewer may see; someone else's private one is 403.
func (s *Service) visibleActivity(ctx context.Context, id, viewerID string) (domain.Activity, error) {
	a, err := loadActivity(ctx, s.repo, id)
	if err != nil {
		return a, err
	}
	following, err := s.repo.FollowingOf(ctx, viewerID)
	if err != nil {
		return a, err
	}
	set := followSet(following)
	if !domain.CanViewActivity(a.MemberID, a.Visibility, viewerID, func(m string) bool { return set[m] }) {
		return a, httpx.Status(403, "Aktivitas ini privat.")
	}
	return a, nil
}

// ownActivity is the caller's own activity; anyone else's is reported missing.
func ownActivity(ctx context.Context, repo Repository, id, customerID string) (domain.Activity, error) {
	a, err := loadActivity(ctx, repo, id)
	if err == nil && a.MemberID != customerID {
		err = notFound("Aktivitas")
	}
	return a, err
}

func (s *Service) athletes(ctx context.Context, ids []string) (map[string]Athlete, error) {
	unique := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return map[string]Athlete{}, nil
	}
	return s.members.Athletes(ctx, unique)
}

// cards builds a batch of feed cards: athletes plus one counts query.
func (s *Service) cards(ctx context.Context, viewerID string, activities []domain.Activity) ([]ActivityCardView, error) {
	out := []ActivityCardView{}
	if len(activities) == 0 {
		return out, nil
	}
	ids := make([]string, len(activities))
	owners := make([]string, len(activities))
	for i, a := range activities {
		ids[i], owners[i] = a.ID, a.MemberID
	}
	people, err := s.athletes(ctx, owners)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.CardCounts(ctx, ids, viewerID)
	if err != nil {
		return nil, err
	}
	for _, a := range activities {
		name, avatar := "Athlete", (*string)(nil)
		if p, ok := people[a.MemberID]; ok {
			name, avatar = p.Name, p.AvatarURL
		}
		c := counts[a.ID]
		out = append(out, ActivityCardView{
			ID: a.ID, MemberID: a.MemberID, MemberName: name, MemberAvatarURL: avatar,
			IsOwn: a.MemberID == viewerID, Type: a.Type, Title: a.Title, StartedAt: isoTime(a.StartedAt),
			DistanceM: a.DistanceM, MovingSec: a.MovingSec, ElapsedSec: a.ElapsedSec,
			AvgPaceSecPerKm: a.AvgPaceSecPerKm, ElevationGainM: a.ElevationGainM, Visibility: a.Visibility,
			Thumbnail:  domain.Downsample(a.Points, domain.ThumbnailPoints),
			PhotoCount: a.PhotoCount, KudosCount: c.Kudos, HasKudoed: c.Kudoed, CommentCount: c.Comments,
		})
	}
	return out, nil
}

func (s *Service) card(ctx context.Context, viewerID string, a domain.Activity) (ActivityCardView, error) {
	list, err := s.cards(ctx, viewerID, []domain.Activity{a})
	if err != nil {
		return ActivityCardView{}, err
	}
	return list[0], nil
}

func moveGear(ctx context.Context, repo Repository, moves []domain.GearMove) error {
	for _, m := range moves {
		if err := repo.MoveGearMileage(ctx, m.GearID, m.DeltaM); err != nil {
			return err
		}
	}
	return nil
}

func assertOwnGear(ctx context.Context, repo Repository, gearID, customerID string) error {
	ok, err := repo.OwnsGear(ctx, gearID, customerID)
	if err == nil && !ok {
		err = notFound("Gear")
	}
	return err
}

// ── Feed & activities ────────────────────────────────────────────────────────

func (s *Service) Feed(ctx context.Context, viewerID string, followingOnly bool) ([]ActivityCardView, error) {
	if err := s.syncWorkouts(ctx, nil); err != nil {
		return nil, err
	}
	following, err := s.repo.FollowingOf(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	candidates, err := s.repo.RecentSummaries(ctx, domain.FeedCandidates)
	if err != nil {
		return nil, err
	}
	visible := domain.SelectFeed(candidates, viewerID, followSet(following), followingOnly, domain.FeedSize)
	if len(visible) > 0 {
		ids := make([]string, len(visible))
		for i, a := range visible {
			ids[i] = a.ID
		}
		points, err := s.repo.PointsByID(ctx, ids)
		if err != nil {
			return nil, err
		}
		for i := range visible {
			visible[i].Points = points[visible[i].ID]
			if visible[i].Points == nil {
				visible[i].Points = []domain.TrackPoint{}
			}
		}
	}
	return s.cards(ctx, viewerID, visible)
}

func (s *Service) MyActivities(ctx context.Context, customerID string) ([]ActivityCardView, error) {
	if err := s.syncWorkouts(ctx, &customerID); err != nil {
		return nil, err
	}
	activities, err := s.repo.MemberActivities(ctx, customerID, true)
	if err != nil {
		return nil, err
	}
	return s.cards(ctx, customerID, activities)
}

// SaveActivity stores a recording with its derived data: figures from the
// track, the segment efforts it passed and the gear mileage.
func (s *Service) SaveActivity(ctx context.Context, customerID string, in SaveActivityInput) (ActivityCardView, error) {
	startedAt := s.clock()
	if in.StartedAt != nil {
		startedAt = *in.StartedAt
	}
	figures := domain.ResolveActivityFigures(in.Points, domain.ManualFigures{ElapsedSec: in.ManualElapsedSec})
	title := jsTrim(in.Title)
	if title == "" {
		title = domain.DefaultActivityTitle(in.Type, startedAt, domain.StudioTZOffsetMin)
	}

	var saved domain.Activity
	err := s.repo.InTx(ctx, func(tx Repository) error {
		if in.GearID != nil {
			if err := assertOwnGear(ctx, tx, *in.GearID, customerID); err != nil {
				return err
			}
		}
		id, err := tx.InsertActivity(ctx, customerID, in, title, startedAt, figures)
		if err != nil {
			return err
		}
		if len(in.Points) >= 2 {
			segments, err := tx.Segments(ctx)
			if err != nil {
				return err
			}
			for _, m := range domain.MatchSegments(segments, in.Type, in.Points) {
				if err := tx.InsertEffort(ctx, m.Segment.ID, id, customerID, m.ElapsedSec); err != nil {
					return err
				}
			}
		}
		if err := moveGear(ctx, tx, domain.GearMileageMoves(nil, in.GearID, figures.DistanceM)); err != nil {
			return err
		}
		saved, err = loadActivity(ctx, tx, id)
		return err
	})
	if err != nil {
		return ActivityCardView{}, err
	}
	return s.card(ctx, customerID, saved)
}

func (s *Service) ActivityDetail(ctx context.Context, viewerID, id string) (ActivityDetailView, error) {
	a, err := s.visibleActivity(ctx, id, viewerID)
	if err != nil {
		return ActivityDetailView{}, err
	}
	stats := domain.ComputeActivityStats(a.Points)
	card, err := s.card(ctx, viewerID, a)
	if err != nil {
		return ActivityDetailView{}, err
	}
	efforts, err := s.effortViews(ctx, a)
	if err != nil {
		return ActivityDetailView{}, err
	}
	comments, err := s.commentViews(ctx, a.ID)
	if err != nil {
		return ActivityDetailView{}, err
	}
	grouped, err := s.groupedViews(ctx, a)
	if err != nil {
		return ActivityDetailView{}, err
	}
	var gearName *string
	if a.GearID != nil {
		if gearName, err = s.repo.GearName(ctx, *a.GearID); err != nil {
			return ActivityDetailView{}, err
		}
	}
	return ActivityDetailView{
		ActivityCardView: card,
		Description:      a.Description,
		Points:           a.Points,
		Photos:           a.Photos,
		Splits:           stats.Splits,
		BestSplitPaceSec: stats.BestSplitPaceSec,
		GearName:         gearName,
		Efforts:          efforts,
		Comments:         comments,
		GroupedWith:      grouped,
	}, nil
}

func (s *Service) effortViews(ctx context.Context, a domain.Activity) ([]EffortView, error) {
	rows, err := s.repo.ActivityEfforts(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	out := []EffortView{}
	for _, r := range rows {
		out = append(out, EffortView{
			SegmentID: r.SegmentID, SegmentName: r.Name, DistanceM: r.DistanceM, ElapsedSec: r.ElapsedSec,
			Placement: domain.PlaceEffort(domain.Effort{MemberID: a.MemberID, ElapsedSec: r.ElapsedSec}, r.Board),
		})
	}
	return out, nil
}

func (s *Service) commentViews(ctx context.Context, activityID string) ([]CommentView, error) {
	rows, err := s.repo.Comments(ctx, activityID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.CustomerID
	}
	people, err := s.athletes(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := []CommentView{}
	for _, r := range rows {
		out = append(out, CommentView{ID: r.ID, MemberID: r.CustomerID, MemberName: nameOf(people, r.CustomerID), Text: r.Text, CreatedAt: isoTime(r.CreatedAt)})
	}
	return out, nil
}

func (s *Service) groupedViews(ctx context.Context, a domain.Activity) ([]GroupedView, error) {
	out := []GroupedView{}
	if len(a.Points) == 0 {
		return out, nil
	}
	candidates, err := s.repo.GroupCandidates(ctx, a, domain.FeedCandidates)
	if err != nil {
		return nil, err
	}
	start := a.Points[0]
	matched := domain.FindGroupedActivities(domain.GroupCandidate{
		ID: a.ID, MemberID: a.MemberID, Type: a.Type, StartedAt: a.StartedAt, Start: &start,
	}, candidates)
	owners := map[string]string{}
	for _, c := range candidates {
		owners[c.ID] = c.MemberID
	}
	ownerIDs := make([]string, len(matched))
	for i, id := range matched {
		ownerIDs[i] = owners[id]
	}
	people, err := s.athletes(ctx, ownerIDs)
	if err != nil {
		return nil, err
	}
	for _, id := range matched {
		out = append(out, GroupedView{ActivityID: id, MemberName: nameOf(people, owners[id])})
	}
	return out, nil
}

func (s *Service) UpdateActivity(ctx context.Context, customerID, id string, patch ActivityPatch) (ActivityCardView, error) {
	var updated domain.Activity
	err := s.repo.InTx(ctx, func(tx Repository) error {
		current, err := ownActivity(ctx, tx, id, customerID)
		if err != nil {
			return err
		}
		nextGear := current.GearID
		if patch.GearSet {
			nextGear = patch.GearID
			if nextGear != nil {
				if err := assertOwnGear(ctx, tx, *nextGear, customerID); err != nil {
					return err
				}
			}
		}
		title := current.Title
		if patch.Title != nil {
			if t := jsTrim(*patch.Title); t != "" {
				title = t
			}
		}
		description := current.Description
		if patch.Description != nil {
			description = jsTrim(*patch.Description)
		}
		visibility := current.Visibility
		if patch.Visibility != nil {
			visibility = *patch.Visibility
		}
		if err := tx.UpdateActivity(ctx, id, title, description, visibility, nextGear); err != nil {
			return err
		}
		// Switching shoes moves the mileage with them.
		if err := moveGear(ctx, tx, domain.GearMileageMoves(current.GearID, nextGear, current.DistanceM)); err != nil {
			return err
		}
		updated, err = loadActivity(ctx, tx, id)
		return err
	})
	if err != nil {
		return ActivityCardView{}, err
	}
	return s.card(ctx, customerID, updated)
}

func (s *Service) DeleteActivity(ctx context.Context, customerID, id string) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		current, err := ownActivity(ctx, tx, id, customerID)
		if err != nil {
			return err
		}
		if err := moveGear(ctx, tx, domain.GearMileageMoves(current.GearID, nil, current.DistanceM)); err != nil {
			return err
		}
		return tx.DeleteActivity(ctx, id)
	})
}

// ── Kudos & comments ─────────────────────────────────────────────────────────

func (s *Service) ToggleKudos(ctx context.Context, customerID, activityID string) (KudosView, error) {
	if _, err := s.visibleActivity(ctx, activityID, customerID); err != nil {
		return KudosView{}, err
	}
	removed, err := s.repo.DeleteKudos(ctx, activityID, customerID)
	if err != nil {
		return KudosView{}, err
	}
	if removed == 0 {
		if err := s.repo.InsertKudos(ctx, activityID, customerID); err != nil {
			return KudosView{}, err
		}
	}
	count, err := s.repo.CountKudos(ctx, activityID)
	if err != nil {
		return KudosView{}, err
	}
	return KudosView{Kudoed: removed == 0, Count: count}, nil
}

func (s *Service) AddComment(ctx context.Context, customerID, activityID, text string) (CommentView, error) {
	if _, err := s.visibleActivity(ctx, activityID, customerID); err != nil {
		return CommentView{}, err
	}
	text = jsTrim(text)
	id, createdAt, err := s.repo.InsertComment(ctx, activityID, customerID, text)
	if err != nil {
		return CommentView{}, err
	}
	people, err := s.athletes(ctx, []string{customerID})
	if err != nil {
		return CommentView{}, err
	}
	return CommentView{ID: id, MemberID: customerID, MemberName: nameOf(people, customerID), Text: text, CreatedAt: isoTime(createdAt)}, nil
}
