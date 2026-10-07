package app

import (
	"bytes"
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/desktop"
	"nuhabit/backend/internal/modules/insights"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// insightsOverview adapts the desktop board (buildDesktopOverview) for the
// executive dashboard. It keeps its own desktop.Service, whose stream
// poller only starts on a subscription, so building one here is inert.
type insightsOverview struct{ svc *desktop.Service }

var _ insights.DesktopOverview = insightsOverview{}

func newInsightsOverview(d module.Deps) insightsOverview {
	return insightsOverview{svc: desktop.NewService(desktop.NewPostgres(d.DB), d.Auth, d.Log, d.Now)}
}

func (a insightsOverview) Build(ctx context.Context) (json.RawMessage, []string, error) {
	o := a.svc.BuildOverview(ctx, "today")
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(o); err != nil {
		return nil, nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), o.Gagal, nil
}

// insightsAnnouncements is the stopgap hris.announcements write behind a
// confirmed Do action (write-tools usulkan_pengumuman_draft).
type insightsAnnouncements struct{}

func (insightsAnnouncements) CreateDraft(ctx context.Context, q database.Querier, title, bodyHTML string, tags []string) (string, string, error) {
	var id, saved string
	err := q.QueryRow(ctx, `INSERT INTO hris.announcements (title, body_html, tags, status)
	   VALUES ($1, $2, $3, 'draft')
	   RETURNING id::text, title`, title, bodyHTML, tags).Scan(&id, &saved)
	return id, saved, err
}

// insightsCandidateNotes is the stopgap recruitment.candidate_notes write
// behind a confirmed Do action (write-tools usulkan_catatan_kandidat).
type insightsCandidateNotes struct{}

func (insightsCandidateNotes) Add(ctx context.Context, q database.Querier, candidateID, content, userID, userName string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO recruitment.candidate_notes (candidate_id, content, created_by, created_by_name)
	   VALUES ($1, $2, $3, $4)
	   RETURNING id::text`, candidateID, content, userID, userName).Scan(&id)
	return id, err
}
