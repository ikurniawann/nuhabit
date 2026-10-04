package app

import (
	"context"
	"log/slog"

	"nuhabit/backend/internal/modules/configuration"
	"nuhabit/backend/internal/modules/recruitment"
	"nuhabit/backend/internal/platform/database"
)

// Adapters for recruitment's file and AI routes: app settings from the
// configuration owner, the interview question voice (lib/tts/synthesize.ts
// with the stored provider) and the hired employee of the pipeline report.

var _ recruitment.Settings = configuration.AppSettings{}

// recruitmentSpeech is synthesizeSpeechOrNull for the interview questions:
// configuration's synthesis, with failures logged and yielding nil.
type recruitmentSpeech struct {
	log  *slog.Logger
	urls configuration.TtsEndpoints
}

var _ recruitment.Speech = recruitmentSpeech{}

func (s recruitmentSpeech) Synthesize(ctx context.Context, q database.Querier, text string) []byte {
	audio, err := configuration.Synthesize(ctx, q, s.urls, text)
	if err != nil {
		s.log.Error("[tts] sintesis gagal, klien akan jatuh ke Web Speech API browser", "error", err)
		return nil
	}
	return audio
}

// recruitmentHired reads the employee a candidate was promoted to, with
// department, job title, manager and onboarding progress (hris tables).
type recruitmentHired struct{}

var _ recruitment.HiredEmployees = recruitmentHired{}

func (recruitmentHired) Hired(ctx context.Context, q database.Querier, candidateID string) (*recruitment.Row, error) {
	return recruitment.CollectRow(q.Query(ctx, `SELECT c.promotion_date, e.nip, e.join_date, e.employment_status,
              e.is_active, (e.user_id IS NOT NULL) AS has_account,
              d.name AS department_name, p.title AS job_title,
              m.full_name AS reporting_to_name,
              coalesce(ob.total, 0) AS onboarding_total,
              coalesce(ob.completed, 0) AS onboarding_completed
       FROM recruitment.candidates c
       JOIN hris.employees e ON e.id = c.promoted_to_employee_id
       LEFT JOIN hris.departments d ON d.id = e.department_id
       LEFT JOIN hris.positions p ON p.id = e.job_title_id
       LEFT JOIN hris.employees m ON m.id = e.reporting_to
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE completed)::int AS completed
         FROM hris.onboarding_checklists oc
         WHERE oc.employee_id = e.id
       ) ob ON true
       WHERE c.id = $1`, candidateID))
}
