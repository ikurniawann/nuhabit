// Package athlete is the member app's Train tab: GPS activities, feed, kudos
// and comments, routes, heatmap, stats, segments, challenges, clubs, follows,
// gear and athlete settings (gym.athlete_* tables). Port of
// frontend/src/app/api/member-portal/app/train/** and home/settings.
package athlete

import (
	"time"

	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "athlete"

type athleteModule struct{ routes []module.Route }

func (m athleteModule) Name() string           { return Name }
func (m athleteModule) Routes() []module.Route { return m.routes }

// New wires the module. Member identity and workout sessions are read through
// the Members and WorkoutSessions ports, implemented here on the shared database.
func New(deps module.Deps) module.Module {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	svc := NewService(newPgRepository(deps.DB), pgMembers{q: deps.DB}, pgWorkoutSessions{q: deps.DB}, now)
	h := &handler{svc: svc, auth: deps.Auth}
	return athleteModule{routes: h.routes()}
}
