package gymcoachleave

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Settings is gym.coach_leave_settings with every leave type and incident
// kind filled in.
type Settings struct {
	BackupApproverUserID    *string                      `json:"backup_approver_user_id"`
	NoticeRules             map[string]domain.NoticeRule `json:"notice_rules"`
	SubstituteResponseHours int                          `json:"substitute_response_hours"`
	WarningThreshold        int                          `json:"warning_threshold"`
	WarningWindowDays       int                          `json:"warning_window_days"`
	DeductionPercent        map[string]float64           `json:"deduction_percent"`
}

func loadSettings(ctx context.Context, q database.Querier) (Settings, error) {
	var out Settings
	var rules, deductions []byte
	err := q.QueryRow(ctx, `SELECT backup_approver_user_id::text, notice_rules, substitute_response_hours,
	        warning_threshold, warning_window_days, deduction_percent
	   FROM gym.coach_leave_settings WHERE id`).Scan(&out.BackupApproverUserID, &rules, &out.SubstituteResponseHours,
		&out.WarningThreshold, &out.WarningWindowDays, &deductions)
	if database.IsNoRows(err) {
		out = Settings{SubstituteResponseHours: domain.DefaultResponseHours, WarningThreshold: 3, WarningWindowDays: 90}
	} else if err != nil {
		return out, err
	}
	stored := map[string]domain.NoticeRule{}
	if len(rules) > 0 {
		if err := json.Unmarshal(rules, &stored); err != nil {
			return out, err
		}
	}
	storedDeductions := map[string]float64{}
	if len(deductions) > 0 {
		if err := json.Unmarshal(deductions, &storedDeductions); err != nil {
			return out, err
		}
	}
	out.NoticeRules = domain.NormalizeNoticeRules(stored)
	out.DeductionPercent = domain.NormalizeDeductions(storedDeductions)
	return out, nil
}

// Settings reads the settings.
func (s *Service) Settings(ctx context.Context) (Settings, error) { return loadSettings(ctx, s.db) }

// SaveSettings validates and stores the settings.
func (s *Service) SaveSettings(ctx context.Context, actorID string, in Settings) (Settings, error) {
	switch {
	case in.SubstituteResponseHours < 1 || in.SubstituteResponseHours > 72:
		return Settings{}, httpx.BadRequest("Batas jawaban pengganti 1 sampai 72 jam")
	case in.WarningThreshold < 1 || in.WarningThreshold > 20:
		return Settings{}, httpx.BadRequest("Ambang SP 1 sampai 20 kejadian")
	case in.WarningWindowDays < 7 || in.WarningWindowDays > 365:
		return Settings{}, httpx.BadRequest("Periode SP 7 sampai 365 hari")
	}
	for t, r := range in.NoticeRules {
		if r.MinDays < 0 || r.MinDays > domain.MaxNoticeDays {
			return Settings{}, httpx.BadRequest("Minimal pemberitahuan " + t + " 0 sampai 90 hari")
		}
	}
	for k, v := range in.DeductionPercent {
		if v < 0 || v > 100 {
			return Settings{}, httpx.BadRequest("Potongan " + k + " 0 sampai 100 persen")
		}
	}
	if in.BackupApproverUserID != nil && *in.BackupApproverUserID == "" {
		in.BackupApproverUserID = nil
	}
	rules, err := json.Marshal(domain.NormalizeNoticeRules(in.NoticeRules))
	if err != nil {
		return Settings{}, err
	}
	deductions, err := json.Marshal(domain.NormalizeDeductions(in.DeductionPercent))
	if err != nil {
		return Settings{}, err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO gym.coach_leave_settings
	        (id, backup_approver_user_id, notice_rules, substitute_response_hours, warning_threshold, warning_window_days,
	         deduction_percent, updated_by, updated_at)
	    VALUES (true, $1, $2, $3, $4, $5, $6, $7, now())
	    ON CONFLICT (id) DO UPDATE SET
	      backup_approver_user_id = EXCLUDED.backup_approver_user_id, notice_rules = EXCLUDED.notice_rules,
	      substitute_response_hours = EXCLUDED.substitute_response_hours, warning_threshold = EXCLUDED.warning_threshold,
	      warning_window_days = EXCLUDED.warning_window_days, deduction_percent = EXCLUDED.deduction_percent,
	      updated_by = EXCLUDED.updated_by, updated_at = now()`,
		in.BackupApproverUserID, rules, in.SubstituteResponseHours, in.WarningThreshold, in.WarningWindowDays, deductions, actorID)
	if database.PgCode(err) == "23503" {
		return Settings{}, httpx.BadRequest("Approver cadangan tidak ditemukan")
	}
	if err != nil {
		return Settings{}, err
	}
	return loadSettings(ctx, s.db)
}

// StaffUser is an active account the backup approver may be.
type StaffUser struct {
	ID       string `json:"id"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

// StaffUsers lists active accounts for the backup approver picker.
func (s *Service) StaffUsers(ctx context.Context) ([]StaffUser, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, full_name, role FROM configuration.users
	   WHERE status = 'active' ORDER BY full_name LIMIT 500`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (StaffUser, error) {
		var u StaffUser
		err := r.Scan(&u.ID, &u.FullName, &u.Role)
		return u, err
	})
}
