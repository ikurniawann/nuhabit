package insights

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// POST /api/ai/assistant/actions (app/api/ai/assistant/actions/route.ts):
// the only path that executes a Do write action. Only the proposer, as
// super_admin, decides; the pending row is claimed atomically; proposals
// expire after 10 minutes.

var actionIDPattern = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)

type actionRow struct {
	ID, Name, Summary, Status string
	Payload                   map[string]any
}

type actionView struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	Result  any    `json:"result,omitempty"`
}

type actionBody struct {
	Action  actionView `json:"action"`
	Message string     `json:"message,omitempty"`
	Error   string     `json:"error,omitempty"`
}

var notClaimableLabels = map[string]string{
	"confirmed": "Aksi ini sudah dijalankan sebelumnya.",
	"cancelled": "Aksi ini sudah dibatalkan.",
	"expired":   "Aksi sudah kedaluwarsa (lebih dari 10 menit). Minta Do menyiapkannya lagi.",
	"failed":    "Aksi ini sebelumnya gagal dijalankan.",
}

func (s *Service) assistantAction(w http.ResponseWriter, r *http.Request) {
	const fail = "Gagal memproses aksi"
	u := s.sessionUser(w, r, fail)
	if u == nil {
		return
	}
	ctx := r.Context()
	prof := s.profileOf(ctx, u.ID)
	// Executing is no looser than proposing.
	if prof.Role == nil || *prof.Role != "super_admin" {
		writeError(w, http.StatusForbidden, "Hanya super_admin yang bisa mengeksekusi aksi Do")
		return
	}
	// A malformed body reads as {}; JSON null fails on the property read.
	body := map[string]any{}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	var v any
	if err == nil && json.Unmarshal(raw, &v) == nil {
		if v == nil {
			writeError(w, http.StatusInternalServerError, fail)
			return
		}
		if m, ok := v.(map[string]any); ok {
			body = m
		}
	}
	actionID, _ := body["action_id"].(string)
	decision, _ := body["decision"].(string)
	if !actionIDPattern.MatchString(actionID) || (decision != "confirm" && decision != "cancel") {
		writeError(w, http.StatusBadRequest, "Permintaan tidak valid")
		return
	}

	userName := u.Email
	if prof.FullName != nil {
		userName = *prof.FullName
	}
	if err := s.decideAction(ctx, w, actionID, decision, u.ID, userName); err != nil {
		s.log.ErrorContext(ctx, "AI assistant action error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
	}
}

func (s *Service) decideAction(ctx context.Context, w http.ResponseWriter, actionID, decision, userID, userName string) error {
	// A stale proposal expires first, so an old card cannot run.
	if _, err := s.db.Exec(ctx, `UPDATE ai_assistant_actions
	    SET status = 'expired', decided_at = now()
	  WHERE id = $1 AND user_id = $2 AND status = 'pending'
	    AND created_at < now() - interval '10 minutes'`, actionID, userID); err != nil {
		return err
	}
	if decision == "cancel" {
		row, err := s.claimAction(ctx, "cancelled", actionID, userID)
		if err != nil {
			return err
		}
		if row == nil {
			return s.respondNotClaimable(ctx, w, actionID, userID)
		}
		return httpx.JSON(w, http.StatusOK, actionBody{
			Action:  actionView{ID: row.ID, Summary: row.Summary, Status: "cancelled"},
			Message: "Aksi dibatalkan. Tidak ada data yang berubah.",
		})
	}
	// Atomic claim: only one request moves pending to confirmed.
	claimed, err := s.claimAction(ctx, "confirmed", actionID, userID)
	if err != nil {
		return err
	}
	if claimed == nil {
		return s.respondNotClaimable(ctx, w, actionID, userID)
	}
	if !domain.IsWriteAction(claimed.Name) {
		// The whitelist changed between proposal and confirmation.
		s.markFailed(ctx, claimed.ID, "Aksi sudah tidak tersedia")
		writeError(w, http.StatusGone, "Aksi sudah tidak tersedia")
		return nil
	}
	result, err := s.executeAction(ctx, claimed, userID, userName)
	if err == nil {
		raw, _ := domain.Marshal(result)
		_, err = s.db.Exec(ctx, `UPDATE ai_assistant_actions SET result = $2::text::jsonb, executed_at = now() WHERE id = $1`, claimed.ID, string(raw))
	}
	if err != nil {
		s.log.ErrorContext(ctx, "[do:write] eksekusi gagal", "action", claimed.Name, "error", err)
		s.markFailed(ctx, claimed.ID, err.Error())
		return httpx.JSON(w, http.StatusInternalServerError, actionBody{
			Action: actionView{ID: claimed.ID, Summary: claimed.Summary, Status: "failed"},
			Error:  "Aksi gagal dijalankan",
		})
	}
	s.log.InfoContext(ctx, "[do:write] "+claimed.Name+" dieksekusi", "action_id", claimed.ID, "user_id", userID)
	return httpx.JSON(w, http.StatusOK, actionBody{
		Action:  actionView{ID: claimed.ID, Summary: claimed.Summary, Status: "confirmed", Result: result},
		Message: "Aksi berhasil dijalankan.",
	})
}

// claimAction moves the user's pending action to status; nil when no
// pending row matched.
func (s *Service) claimAction(ctx context.Context, status, actionID, userID string) (*actionRow, error) {
	var row actionRow
	var payload []byte
	err := s.db.QueryRow(ctx, `UPDATE ai_assistant_actions
	    SET status = $3, decided_by = $2, decided_at = now()
	  WHERE id = $1 AND user_id = $2 AND status = 'pending'
	  RETURNING id::text, action_name, payload::text, summary, status`, actionID, userID, status).
		Scan(&row.ID, &row.Name, &payload, &row.Summary, &row.Status)
	if err != nil {
		if database.IsNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	_ = json.Unmarshal(payload, &row.Payload)
	return &row, nil
}

// respondNotClaimable explains why the row could not be claimed: decided,
// expired, or not the user's.
func (s *Service) respondNotClaimable(ctx context.Context, w http.ResponseWriter, actionID, userID string) error {
	var v actionView
	err := s.db.QueryRow(ctx, `SELECT id::text, summary, status FROM ai_assistant_actions WHERE id = $1 AND user_id = $2`, actionID, userID).
		Scan(&v.ID, &v.Summary, &v.Status)
	if database.IsNoRows(err) {
		writeError(w, http.StatusNotFound, "Aksi tidak ditemukan")
		return nil
	}
	if err != nil {
		return err
	}
	label, ok := notClaimableLabels[v.Status]
	if !ok {
		label = "Aksi tidak bisa diproses"
	}
	return httpx.JSON(w, http.StatusConflict, actionBody{Action: v, Error: label})
}

func (s *Service) markFailed(ctx context.Context, actionID, message string) {
	if _, err := s.db.Exec(ctx, `UPDATE ai_assistant_actions SET status = 'failed', error = $2 WHERE id = $1`, actionID, domain.Slice(message, 500)); err != nil {
		s.log.WarnContext(ctx, "[do:write] gagal menandai failed", "error", err)
	}
}

// executeAction runs a confirmed action through the owning context's port.
func (s *Service) executeAction(ctx context.Context, a *actionRow, userID, userName string) (domain.Object, error) {
	switch a.Name {
	case domain.ActionPengumuman:
		p, msg := domain.ValidatePengumuman(a.Payload)
		if msg != "" {
			return nil, errors.New(msg)
		}
		id, title, err := s.ports.Announcements.CreateDraft(ctx, s.db, p.Judul, domain.PlainTextToHTML(p.Isi), p.Tags)
		if err != nil {
			return nil, err
		}
		return domain.Object{{Key: "announcement_id", Value: id}, {Key: "judul", Value: title}, {Key: "status", Value: "draft"}}, nil
	default: // domain.ActionCatatan
		candidateID, _ := a.Payload["candidate_id"].(string)
		catatan := ""
		if c, ok := a.Payload["catatan"].(string); ok {
			catatan = domain.Trim(c)
		}
		if candidateID == "" || domain.Len(catatan) < 3 {
			return nil, errors.New("Payload catatan kandidat tidak valid")
		}
		id, err := s.ports.CandidateNotes.Add(ctx, s.db, candidateID, catatan, userID, userName)
		if err != nil {
			return nil, err
		}
		out := domain.Object{{Key: "note_id", Value: id}}
		if name, ok := a.Payload["candidate_name"]; ok {
			out = append(out, domain.Field{Key: "kandidat", Value: name})
		}
		return out, nil
	}
}
