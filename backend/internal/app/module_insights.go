package app

import (
	"nuhabit/backend/internal/modules/insights"
	"nuhabit/backend/internal/platform/module"
)

// insights: recruitment dashboard and analytics, the executive dashboard
// and the Do assistant.
func init() {
	Register(insights.Name, func(d module.Deps) module.Module { return insights.New(d, InsightsPorts(d)) })
}

// InsightsPorts wires the insights ports to the adapters in
// adapters_insights.go. The module's integration tests use it too.
func InsightsPorts(d module.Deps) insights.Ports {
	return insights.Ports{
		Overview:       newInsightsOverview(d),
		Announcements:  insightsAnnouncements{},
		CandidateNotes: insightsCandidateNotes{},
	}
}
