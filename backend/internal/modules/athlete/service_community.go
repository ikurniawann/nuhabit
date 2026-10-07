package athlete

import (
	"context"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Challenges, clubs, follows and athlete profiles (athlete-community-server.ts).

// recentSummaries is the newest activities of every athlete, without tracks.
func (s *Service) recentSummaries(ctx context.Context) ([]domain.Contribution, error) {
	activities, err := s.repo.RecentSummaries(ctx, domain.FeedCandidates*5)
	if err != nil {
		return nil, err
	}
	return contributions(activities), nil
}

func flatten(groups map[string][]string) []string {
	out := []string{}
	for _, ids := range groups {
		out = append(out, ids...)
	}
	return out
}

func contains(ids []string, id string) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// Challenges lists challenges that have not ended, my progress and the top five.
func (s *Service) Challenges(ctx context.Context, customerID string) ([]ChallengeView, error) {
	now := s.clock()
	rows, err := s.repo.Challenges(ctx)
	if err != nil {
		return nil, err
	}
	participants, err := s.repo.ChallengeParticipants(ctx)
	if err != nil {
		return nil, err
	}
	activities, err := s.recentSummaries(ctx)
	if err != nil {
		return nil, err
	}
	byMember := map[string][]domain.Contribution{}
	for _, a := range activities {
		byMember[a.MemberID] = append(byMember[a.MemberID], a)
	}
	people, err := s.athletes(ctx, flatten(participants))
	if err != nil {
		return nil, err
	}

	out := []ChallengeView{}
	for _, c := range rows {
		if !domain.IsChallengeRunning(c.EndsAt, now) {
			continue
		}
		progress := func(id string) float64 {
			return domain.ChallengeProgressKm(c.Type, c.StartsAt, c.EndsAt, byMember[id])
		}
		ids := participants[c.ID]
		entries := make([]domain.LeaderboardEntry, len(ids))
		for i, id := range ids {
			entries[i] = domain.LeaderboardEntry{MemberName: nameOf(people, id), Km: progress(id), IsMe: id == customerID}
		}
		out = append(out, ChallengeView{
			Challenge: ChallengeInfo{
				ID: c.ID, Name: c.Name, Description: c.Description, Type: c.Type, TargetKm: c.TargetKm,
				StartsAt: isoTime(c.StartsAt), EndsAt: isoTime(c.EndsAt),
			},
			Joined:           contains(ids, customerID),
			ParticipantCount: len(ids),
			ProgressKm:       progress(customerID),
			Leaderboard:      domain.TopOf(entries, domain.LeaderboardRows),
		})
	}
	return out, nil
}

// JoinChallenge is idempotent: pressing twice is one membership.
func (s *Service) JoinChallenge(ctx context.Context, customerID, challengeID string) error {
	n, err := s.repo.JoinChallenge(ctx, challengeID, customerID)
	if err != nil || n > 0 {
		return err
	}
	exists, err := s.repo.ChallengeExists(ctx, challengeID)
	if err == nil && !exists {
		err = notFound("Tantangan")
	}
	return err
}

func (s *Service) LeaveChallenge(ctx context.Context, customerID, challengeID string) error {
	return s.repo.LeaveChallenge(ctx, challengeID, customerID)
}

// ── Clubs ────────────────────────────────────────────────────────────────────

func (s *Service) Clubs(ctx context.Context, customerID string) ([]ClubView, error) {
	now := s.clock()
	rows, err := s.repo.Clubs(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ClubMembers(ctx)
	if err != nil {
		return nil, err
	}
	activities, err := s.recentSummaries(ctx)
	if err != nil {
		return nil, err
	}
	weekly := domain.WeeklyKmByMember(activities, now, domain.StudioTZOffsetMin)
	people, err := s.athletes(ctx, flatten(members))
	if err != nil {
		return nil, err
	}
	out := []ClubView{}
	for _, club := range rows {
		ids := members[club.ID]
		if ids == nil {
			ids = []string{}
		}
		entries := make([]domain.LeaderboardEntry, len(ids))
		for i, id := range ids {
			entries[i] = domain.LeaderboardEntry{MemberName: nameOf(people, id), Km: weekly[id], IsMe: id == customerID}
		}
		club.MemberIDs = ids
		out = append(out, ClubView{
			Club: club, Joined: contains(ids, customerID), MemberCount: len(ids),
			WeeklyLeaderboard: domain.TopOf(entries, domain.LeaderboardRows),
		})
	}
	return out, nil
}

func (s *Service) ToggleClub(ctx context.Context, customerID, clubID string) (bool, error) {
	removed, err := s.repo.DeleteClubMember(ctx, clubID, customerID)
	if err != nil || removed > 0 {
		return false, err
	}
	inserted, err := s.repo.InsertClubMember(ctx, clubID, customerID)
	if err != nil {
		return false, err
	}
	if inserted == 0 {
		return false, notFound("Klub")
	}
	return true, nil
}

// ── Social ───────────────────────────────────────────────────────────────────

// Social lists following, followers and follow suggestions; a search query
// replaces the suggestions with active athletes matching the name.
func (s *Service) Social(ctx context.Context, customerID, query string) (SocialView, error) {
	now := s.clock()
	search := jsTrim(query)
	following, err := s.repo.FollowingOf(ctx, customerID)
	if err != nil {
		return SocialView{}, err
	}
	followers, err := s.repo.FollowersOf(ctx, customerID)
	if err != nil {
		return SocialView{}, err
	}
	activities, err := s.recentSummaries(ctx)
	if err != nil {
		return SocialView{}, err
	}
	activeIDs, err := s.members.ActiveMemberIDs(ctx, search)
	if err != nil {
		return SocialView{}, err
	}

	weekly := domain.WeeklyKmByMember(activities, now, domain.StudioTZOffsetMin)
	trains := map[string]bool{}
	for _, a := range activities {
		trains[a.MemberID] = true
	}
	followingSet := followSet(following)
	var suggestions []string
	if search != "" {
		suggestions = []string{}
		for _, id := range activeIDs {
			if id != customerID && len(suggestions) < 20 {
				suggestions = append(suggestions, id)
			}
		}
	} else {
		suggestions = domain.FollowSuggestions(activeIDs, customerID, followingSet, trains, domain.SuggestionCount)
	}
	all := append(append(append([]string{}, following...), followers...), suggestions...)
	people, err := s.athletes(ctx, all)
	if err != nil {
		return SocialView{}, err
	}
	lite := func(ids []string) []AthleteLite {
		out := make([]AthleteLite, len(ids))
		for i, id := range ids {
			out[i] = AthleteLite{MemberID: id, Name: nameOf(people, id), WeeklyKm: weekly[id], IsFollowing: followingSet[id]}
		}
		return out
	}
	return SocialView{Following: lite(following), Followers: lite(followers), Suggestions: lite(suggestions)}, nil
}

func (s *Service) ToggleFollow(ctx context.Context, customerID, targetID string) (bool, error) {
	if customerID == targetID {
		return false, httpx.Status(400, "Tidak bisa mengikuti diri sendiri.")
	}
	target, err := s.athletes(ctx, []string{targetID})
	if err != nil {
		return false, err
	}
	if _, ok := target[targetID]; !ok {
		return false, notFound("Member")
	}
	removed, err := s.repo.DeleteFollow(ctx, customerID, targetID)
	if err != nil || removed > 0 {
		return false, err
	}
	return true, s.repo.InsertFollow(ctx, customerID, targetID)
}

func (s *Service) Profile(ctx context.Context, viewerID, targetID string) (ProfileView, error) {
	people, err := s.athletes(ctx, []string{targetID})
	if err != nil {
		return ProfileView{}, err
	}
	target, ok := people[targetID]
	if !ok {
		return ProfileView{}, notFound("Member")
	}
	if err := s.syncWorkouts(ctx, &targetID); err != nil {
		return ProfileView{}, err
	}
	following, err := s.repo.FollowingOf(ctx, viewerID)
	if err != nil {
		return ProfileView{}, err
	}
	activities, err := s.repo.MemberActivities(ctx, targetID, true)
	if err != nil {
		return ProfileView{}, err
	}
	followingCount, followerCount, err := s.repo.CountFollows(ctx, targetID)
	if err != nil {
		return ProfileView{}, err
	}
	set := followSet(following)
	visible := []domain.Activity{}
	totalM, movingSec := 0.0, 0
	for _, a := range activities {
		if domain.CanViewActivity(a.MemberID, a.Visibility, viewerID, func(m string) bool { return set[m] }) {
			visible = append(visible, a)
			totalM += a.DistanceM
			movingSec += a.MovingSec
		}
	}
	shown := visible
	if len(shown) > domain.ProfileActivities {
		shown = shown[:domain.ProfileActivities]
	}
	cards, err := s.cards(ctx, viewerID, shown)
	if err != nil {
		return ProfileView{}, err
	}
	return ProfileView{
		Member:         ProfileMember{ID: target.ID, FullName: target.Name, AvatarURL: target.AvatarURL},
		IsMe:           targetID == viewerID,
		IsFollowing:    set[targetID],
		FollowerCount:  followerCount,
		FollowingCount: followingCount,
		// Unrounded on purpose: the TS profile divides by 1000 without roundKm.
		Totals:     TotalsView{Activities: len(visible), DistanceKm: totalM / 1000, MovingSec: movingSec},
		Activities: cards,
	}, nil
}
