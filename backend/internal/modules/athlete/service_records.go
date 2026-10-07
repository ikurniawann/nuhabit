package athlete

import (
	"context"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Saved routes, heatmap, gear, settings, "You" stats and segments
// (athlete-records-server.ts).

func toRoute(r RouteRow, maxPoints int) RouteView {
	return RouteView{ID: r.ID, Name: r.Name, DistanceM: r.DistanceM, Points: domain.Downsample(r.Points, maxPoints), CreatedAt: isoTime(r.CreatedAt)}
}

func (s *Service) Routes(ctx context.Context, customerID string) ([]RouteView, error) {
	rows, err := s.repo.Routes(ctx, customerID)
	if err != nil {
		return nil, err
	}
	out := []RouteView{}
	for _, r := range rows {
		out = append(out, toRoute(r, domain.RouteListPoints))
	}
	return out, nil
}

// SaveRoute turns the track of one of the member's own activities into a route.
func (s *Service) SaveRoute(ctx context.Context, customerID, activityID, name string) (RouteView, error) {
	a, err := ownActivity(ctx, s.repo, activityID, customerID)
	if err != nil {
		return RouteView{}, err
	}
	if len(a.Points) < 2 {
		return RouteView{}, httpx.Status(400, "Aktivitas ini tidak punya jejak GPS.")
	}
	if name = jsTrim(name); name == "" {
		name = a.Title
	}
	row, err := s.repo.InsertRoute(ctx, customerID, name, domain.Downsample(a.Points, domain.RoutePoints), a.DistanceM)
	if err != nil {
		return RouteView{}, err
	}
	return toRoute(row, domain.RoutePoints), nil
}

func (s *Service) DeleteRoute(ctx context.Context, customerID, routeID string) error {
	n, err := s.repo.DeleteRoute(ctx, routeID, customerID)
	if err == nil && n == 0 {
		err = notFound("Rute")
	}
	return err
}

func (s *Service) Heatmap(ctx context.Context, customerID string) (HeatmapView, error) {
	tracks, err := s.repo.HeatmapTracks(ctx, customerID)
	if err != nil {
		return HeatmapView{}, err
	}
	out := HeatmapView{Tracks: make([][]domain.TrackPoint, len(tracks))}
	for i, t := range tracks {
		out.Tracks[i] = domain.Downsample(t, domain.HeatmapPoints)
	}
	return out, nil
}

// ── Gear & settings ──────────────────────────────────────────────────────────

func (s *Service) GearList(ctx context.Context, customerID string) ([]GearView, error) {
	return s.repo.GearList(ctx, customerID)
}

// UpsertGear creates (gearID nil) or edits gear. Mileage is never edited: it
// is the sum of the activities that used the gear.
func (s *Service) UpsertGear(ctx context.Context, customerID string, gearID *string, in GearInput) (GearView, error) {
	if gearID == nil {
		return s.repo.InsertGear(ctx, customerID, in)
	}
	g, err := s.repo.UpdateGear(ctx, *gearID, customerID, in)
	if err != nil {
		return GearView{}, err
	}
	if g == nil {
		return GearView{}, notFound("Gear")
	}
	return *g, nil
}

func (s *Service) Settings(ctx context.Context, customerID string) (SettingsView, error) {
	row, err := s.repo.Settings(ctx, customerID)
	if err != nil || row == nil {
		return defaultSettings(), err
	}
	return *row, nil
}

// UpdateSettings applies a partial patch; GoalSet with nil removes the target.
func (s *Service) UpdateSettings(ctx context.Context, customerID string, p SettingsPatch) (SettingsView, error) {
	next, err := s.Settings(ctx, customerID)
	if err != nil {
		return next, err
	}
	if p.Units != nil {
		next.Units = *p.Units
	}
	if p.BookingReminders != nil {
		next.BookingReminders = *p.BookingReminders
	}
	if p.GoalSet {
		next.WeeklyGoalKm = p.WeeklyGoalKm
	}
	if p.Language != nil {
		next.Language = *p.Language
	}
	return next, s.repo.UpsertSettings(ctx, customerID, next)
}

// HomeSettings is the home tab view of the same row (no weekly goal).
func (s *Service) HomeSettings(ctx context.Context, customerID string) (HomeSettingsView, error) {
	v, err := s.Settings(ctx, customerID)
	return HomeSettingsView{Units: v.Units, BookingReminders: v.BookingReminders, Language: v.Language}, err
}

// PatchHomeSettings changes some settings; the row is created on first save.
func (s *Service) PatchHomeSettings(ctx context.Context, customerID string, p SettingsPatch) error {
	return s.repo.PatchHomeSettings(ctx, customerID, p, defaultSettings())
}

// ── "You" stats ──────────────────────────────────────────────────────────────

func (s *Service) Stats(ctx context.Context, customerID string) (StatsView, error) {
	now := s.clock()
	if err := s.syncWorkouts(ctx, &customerID); err != nil {
		return StatsView{}, err
	}
	activities, err := s.repo.MemberActivities(ctx, customerID, true)
	if err != nil {
		return StatsView{}, err
	}
	settings, err := s.Settings(ctx, customerID)
	if err != nil {
		return StatsView{}, err
	}
	gear, err := s.repo.GearList(ctx, customerID)
	if err != nil {
		return StatsView{}, err
	}
	following, followers, err := s.repo.CountFollows(ctx, customerID)
	if err != nil {
		return StatsView{}, err
	}

	buckets := domain.WeeklyBuckets(contributions(activities), now, domain.StatsWeeks, domain.StudioTZOffsetMin)
	weekly := make([]WeekBucketView, len(buckets))
	for i, b := range buckets {
		weekly[i] = WeekBucketView{WeekStart: isoTime(b.WeekStart), DistanceKm: b.DistanceKm, Activities: b.Activities, MovingSec: b.MovingSec}
	}
	thisWeekKm := 0.0
	if len(weekly) > 0 {
		thisWeekKm = weekly[len(weekly)-1].DistanceKm
	}
	totalM, movingSec := 0.0, 0
	for _, a := range activities {
		totalM += a.DistanceM
		movingSec += a.MovingSec
	}
	return StatsView{
		Weekly:         weekly,
		Totals:         TotalsView{Activities: len(activities), DistanceKm: domain.RoundKm(totalM), MovingSec: movingSec},
		ThisWeekKm:     thisWeekKm,
		Goal:           GoalView{TargetKm: settings.WeeklyGoalKm, CurrentKm: thisWeekKm},
		PRs:            domain.ComputePersonalRecords(activities),
		Gear:           gear,
		Settings:       settings,
		FollowingCount: following,
		FollowerCount:  followers,
	}, nil
}

// ── Segments ─────────────────────────────────────────────────────────────────

func (s *Service) Segments(ctx context.Context, customerID string) ([]SegmentSummaryView, error) {
	list, err := s.repo.Segments(ctx)
	if err != nil {
		return nil, err
	}
	efforts, err := s.repo.Efforts(ctx, nil)
	if err != nil {
		return nil, err
	}
	out := []SegmentSummaryView{}
	for _, segment := range list {
		all := []domain.Effort{}
		for _, e := range efforts {
			if e.SegmentID == segment.ID {
				all = append(all, e)
			}
		}
		board := domain.BestPerMember(all)
		view := SegmentSummaryView{Segment: segment, EffortCount: len(all), MyRank: domain.RankOf(board, customerID)}
		if len(board) > 0 {
			best := board[0].ElapsedSec
			view.BestElapsedSec = &best
		}
		if view.MyRank != nil {
			mine := board[*view.MyRank-1].ElapsedSec
			view.MyBestElapsedSec = &mine
		}
		out = append(out, view)
	}
	return out, nil
}

func (s *Service) SegmentDetail(ctx context.Context, customerID, segmentID string) (SegmentDetailView, error) {
	list, err := s.repo.Segments(ctx)
	if err != nil {
		return SegmentDetailView{}, err
	}
	var segment *domain.Segment
	for i := range list {
		if list[i].ID == segmentID {
			segment = &list[i]
			break
		}
	}
	if segment == nil {
		return SegmentDetailView{}, notFound("Segment")
	}
	efforts, err := s.repo.Efforts(ctx, &segmentID)
	if err != nil {
		return SegmentDetailView{}, err
	}
	board := domain.BestPerMember(efforts)
	shown := board
	if len(shown) > domain.SegmentBoardSize {
		shown = shown[:domain.SegmentBoardSize]
	}
	ids := make([]string, len(shown))
	for i, e := range shown {
		ids[i] = e.MemberID
	}
	people, err := s.athletes(ctx, ids)
	if err != nil {
		return SegmentDetailView{}, err
	}
	rows := make([]SegmentBoardRow, len(shown))
	for i, e := range shown {
		rows[i] = SegmentBoardRow{
			Rank: i + 1, MemberID: e.MemberID, MemberName: nameOf(people, e.MemberID),
			ElapsedSec: e.ElapsedSec, CreatedAt: isoTime(e.CreatedAt), IsMe: e.MemberID == customerID,
		}
	}
	return SegmentDetailView{Segment: *segment, Leaderboard: rows, MyRank: domain.RankOf(board, customerID)}, nil
}
