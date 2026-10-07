package insights

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/insights/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
)

// /api/ai/assistant (app/api/ai/assistant/route.ts): chat history per user
// session (GET, DELETE, PATCH) and the Do turn (POST, JSON or SSE). These
// routes answer with their own {error} bodies, not the apiHandler envelope.

type errorBody struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	_ = httpx.JSON(w, status, errorBody{Error: msg})
}

// sessionUser is db.auth.getUser(): the session (cookie or Open API token)
// without the profile.
func (s *Service) sessionUser(w http.ResponseWriter, r *http.Request, failMsg string) *auth.SessionUser {
	u, err := s.auth.Session(r)
	if err != nil {
		s.log.ErrorContext(r.Context(), "AI assistant: session lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, failMsg)
		return nil
	}
	if u == nil {
		writeError(w, http.StatusUnauthorized, "Login required")
	}
	return u
}

type profile struct {
	Role     *string
	FullName *string
}

// profileOf reads configuration.users; a failed read is "no profile".
func (s *Service) profileOf(ctx context.Context, userID string) profile {
	var p profile
	if s.db.QueryRow(ctx, `SELECT role, full_name FROM configuration.users WHERE id = $1`, userID).Scan(&p.Role, &p.FullName) != nil {
		return profile{}
	}
	return p
}

type sessionRow struct {
	ID        string       `json:"id"`
	Title     *string      `json:"title"`
	CreatedAt httpx.JSTime `json:"created_at"`
	UpdatedAt httpx.JSTime `json:"updated_at"`
}

type messageRow struct {
	ID        string          `json:"id"`
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	Meta      json.RawMessage `json:"meta"`
	CreatedAt httpx.JSTime    `json:"created_at"`
}

func (s *Service) assistantHistory(w http.ResponseWriter, r *http.Request) {
	const fail = "Gagal memuat history"
	u := s.sessionUser(w, r, fail)
	if u == nil {
		return
	}
	ctx := r.Context()
	q := r.URL.Query()
	sessionID := q.Get("session_id")
	if q.Get("list") == "true" || sessionID == "" {
		sessions, err := s.listSessions(ctx, u.ID)
		if err != nil {
			s.log.ErrorContext(ctx, "AI assistant GET error", "error", err)
			writeError(w, http.StatusInternalServerError, fail)
			return
		}
		_ = httpx.JSON(w, http.StatusOK, map[string]any{"sessions": sessions})
		return
	}
	if !s.ownsSession(ctx, sessionID, u.ID) {
		writeError(w, http.StatusNotFound, sessionNotFound)
		return
	}
	messages, err := s.sessionMessages(ctx, sessionID)
	if err != nil {
		s.log.ErrorContext(ctx, "AI assistant GET error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	_ = httpx.JSON(w, http.StatusOK, map[string]any{"messages": messages})
}

const sessionNotFound = "Session tidak ditemukan"

// ownsSession is the ownership check before a session's history is read or
// appended to. Someone else's session, a missing one and an id that is not
// a uuid all read as not found.
func (s *Service) ownsSession(ctx context.Context, sessionID, userID string) bool {
	var owned string
	return s.db.QueryRow(ctx, `SELECT id::text FROM ai_assistant_sessions WHERE id = $1 AND user_id = $2`, sessionID, userID).Scan(&owned) == nil
}

func (s *Service) listSessions(ctx context.Context, userID string) ([]sessionRow, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, title, created_at, updated_at FROM ai_assistant_sessions
		WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 30`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sessionRow{}
	for rows.Next() {
		var row sessionRow
		var created, updated time.Time
		if err := rows.Scan(&row.ID, &row.Title, &created, &updated); err != nil {
			return nil, err
		}
		row.CreatedAt, row.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Service) sessionMessages(ctx context.Context, sessionID string) ([]messageRow, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, role, content, meta::text, created_at FROM ai_assistant_messages
		WHERE session_id = $1 ORDER BY created_at ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []messageRow{}
	for rows.Next() {
		var row messageRow
		var meta *string
		var created time.Time
		if err := rows.Scan(&row.ID, &row.Role, &row.Content, &meta, &created); err != nil {
			return nil, err
		}
		row.Meta = json.RawMessage("null")
		if meta != nil {
			row.Meta = json.RawMessage(*meta)
		}
		row.CreatedAt = httpx.JSTime(created)
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *Service) assistantDelete(w http.ResponseWriter, r *http.Request) {
	const fail = "Gagal menghapus session"
	u := s.sessionUser(w, r, fail)
	if u == nil {
		return
	}
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id required")
		return
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM ai_assistant_sessions WHERE id = $1 AND user_id = $2`, sessionID, u.ID); err != nil {
		s.log.ErrorContext(r.Context(), "AI assistant DELETE error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	_ = httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

// assistantRename is PATCH ?session_id=…: rename one of the user's sessions.
func (s *Service) assistantRename(w http.ResponseWriter, r *http.Request) {
	const fail = "Gagal mengganti judul"
	u := s.sessionUser(w, r, fail)
	if u == nil {
		return
	}
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "session_id required")
		return
	}
	body, err := readJSONObject(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	title := ""
	if t, ok := body["title"].(string); ok {
		title = domain.Trim(t)
	}
	if title == "" {
		writeError(w, http.StatusBadRequest, "Judul tidak boleh kosong")
		return
	}
	// The user_id filter is the ownership check.
	if _, err := s.db.Exec(r.Context(), `UPDATE ai_assistant_sessions SET title = $1, updated_at = $2 WHERE id = $3 AND user_id = $4`,
		domain.Slice(title, 120), s.now(), sessionID, u.ID); err != nil {
		s.log.ErrorContext(r.Context(), "AI assistant PATCH error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	_ = httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

// readJSONObject is `await request.json()` followed by property reads: a
// malformed body or JSON null throws; any other non-object reads as empty.
func readJSONObject(r *http.Request) (map[string]any, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	if v == nil {
		return nil, fmt.Errorf("body is null")
	}
	m, _ := v.(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// askRequest is the parsed POST body.
type askRequest struct {
	prompt      string
	history     []domain.ChatMessage
	sessionID   string
	model       string
	scope       domain.Scope
	stream      bool
	attachments []domain.Attachment
}

func parseAsk(body map[string]any) (askRequest, error) {
	req := askRequest{prompt: "Summary semua module"}
	switch m := body["message"].(type) {
	case nil:
	case string:
		req.prompt = m
	default:
		return req, fmt.Errorf("message is not a string")
	}
	switch h := body["history"].(type) {
	case nil:
	case []any:
		if len(h) > 8 {
			h = h[len(h)-8:]
		}
		for _, item := range h {
			obj, _ := item.(map[string]any)
			msg := domain.ChatMessage{}
			msg.Role, _ = obj["role"].(string)
			content, ok := obj["content"].(string)
			msg.Content, msg.Invalid = content, !ok
			req.history = append(req.history, msg)
		}
	default:
		return req, fmt.Errorf("history is not an array")
	}
	req.sessionID, _ = body["session_id"].(string)
	req.model = domain.ResolveModel(body["model"])
	req.scope = domain.ResolveScope(body["scope"])
	req.stream = body["stream"] == true
	req.attachments = domain.SanitizeAttachments(body["attachments"])
	return req, nil
}

// assistantAsk is POST /api/ai/assistant: one Do turn. Do is open to every
// signed-in user; the tools follow the user's IAM menus (tool-scope).
func (s *Service) assistantAsk(w http.ResponseWriter, r *http.Request) {
	const fail = "Gagal memproses permintaan Do"
	startedAt := s.now()
	// The turn is not cut short by the server's write timeout or by the
	// client leaving: like the TS stream it finishes and is saved.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	ctx := context.WithoutCancel(r.Context())

	body, err := readJSONObject(r)
	var req askRequest
	if err == nil {
		req, err = parseAsk(body)
	}
	if err != nil {
		s.log.ErrorContext(ctx, "AI assistant error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	u := s.sessionUser(w, r, fail)
	if u == nil {
		return
	}
	prof := s.profileOf(ctx, u.ID)
	role := ""
	if prof.Role != nil {
		role = *prof.Role
	}
	granted, err := s.auth.GrantedMenuCodes(ctx, u.ID, role)
	if err != nil {
		s.log.ErrorContext(ctx, "AI assistant error", "error", err)
		writeError(w, http.StatusInternalServerError, fail)
		return
	}
	allow := domain.AllowedToolNames(role, granted)
	if req.sessionID != "" && !s.ownsSession(ctx, req.sessionID, u.ID) {
		writeError(w, http.StatusNotFound, sessionNotFound)
		return
	}

	includeProject := req.scope != domain.ScopeGeneral
	intent := domain.IntentAll
	userName := u.Email
	if prof.FullName != nil {
		userName = *prof.FullName
	}
	summary := domain.EmptySummary(domain.ISO(s.now()))
	fallback := "Do belum bisa menghubungi tingkat yang dipilih saat ini. Coba lagi sebentar atau pilih tingkat lain di NüHabit OS Settings."
	if includeProject {
		intent = domain.DetectIntent(req.prompt)
		summary = s.buildSystemSummary(ctx, intent)
		before := domain.ContextSizeChars(summary)
		after := domain.ContextSizeChars(domain.SelectContextForIntent(summary, intent))
		saved := 0
		if before > 0 {
			saved = int(jsmath.Round(float64(before-after) / float64(before) * 100))
		}
		s.log.InfoContext(ctx, fmt.Sprintf("[do:context] intent=%s %d -> %d char (hemat %d%%)", intent, before, after, saved))
		fallback = domain.GenerateSummaryAnswer(req.prompt, summary, userName, intent)
	}

	sessionID := s.touchSession(ctx, req.sessionID, u.ID, req.prompt)
	var persisted []domain.ChatMessage
	if sessionID != "" {
		persisted = s.loadSessionHistory(ctx, sessionID)
	}
	history, ok := domain.CompactChatHistory(append(persisted, req.history...))
	if !ok {
		s.log.ErrorContext(ctx, "AI assistant error", "error", "history content is not a string")
		writeError(w, http.StatusInternalServerError, fail)
		return
	}

	in := askInput{
		message: req.prompt, history: history, summary: summary, fallback: fallback, userName: userName,
		intent: intent, scope: req.scope, model: req.model, attachments: req.attachments,
		action: actionCtx{UserID: u.ID, UserName: userName, SessionID: sessionID}, allow: allow,
	}
	finalize := func(res llmResult) domain.Object {
		s.persistAndAudit(ctx, persistInput{
			sessionID: sessionID, prompt: req.prompt, result: res, intent: intent, scope: req.scope,
			userID: u.ID, userEmail: u.Email, userName: userName, startedAt: startedAt,
		})
		meta := domain.Object{
			{Key: "mode", Value: res.mode}, {Key: "model", Value: res.model}, {Key: "intent", Value: intent},
			{Key: "scope", Value: req.scope}, {Key: "status", Value: res.status},
		}
		if res.fallbackReason != "" {
			meta = append(meta, domain.Field{Key: "fallbackReason", Value: res.fallbackReason})
		}
		meta = append(meta, domain.Field{Key: "user", Value: u.Email})
		if res.pending != nil {
			meta = append(meta, domain.Field{Key: "pending_action", Value: res.pending})
		}
		return meta
	}
	withSession := func(o domain.Object) domain.Object {
		if sessionID != "" {
			o = append(o, domain.Field{Key: "session_id", Value: sessionID})
		}
		return o
	}

	if req.stream {
		h := w.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache, no-transform")
		h.Set("Connection", "keep-alive")
		// Keeps nginx/cloudflared from buffering the stream.
		h.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		rc := http.NewResponseController(w)
		_ = rc.Flush()
		send := func(payload domain.Object) {
			raw, _ := domain.Marshal(payload)
			_, _ = w.Write([]byte("data: " + string(raw) + "\n\n"))
			_ = rc.Flush()
		}
		in.onDelta = func(text string) { send(domain.Object{{Key: "type", Value: "delta"}, {Key: "text", Value: text}}) }
		res := s.generateAnswer(ctx, in)
		// Saved after the stream ends, from the full server-side text.
		meta := finalize(res)
		send(append(withSession(domain.Object{{Key: "type", Value: "done"}, {Key: "answer", Value: res.answer}}), domain.Field{Key: "meta", Value: meta}))
		return
	}

	res := s.generateAnswer(ctx, in)
	meta := finalize(res)
	out := withSession(domain.Object{{Key: "answer", Value: res.answer}, {Key: "summary", Value: summary}})
	_ = httpx.JSON(w, http.StatusOK, append(out, domain.Field{Key: "meta", Value: meta}))
}

// touchSession creates a session for a fresh chat (titled by the prompt) or
// bumps updated_at of the user's own session. Failures are ignored.
func (s *Service) touchSession(ctx context.Context, sessionID, userID, prompt string) string {
	if sessionID == "" {
		var id string
		if s.db.QueryRow(ctx, `INSERT INTO ai_assistant_sessions (user_id, title) VALUES ($1, $2) RETURNING id::text`,
			userID, domain.Slice(prompt, 120)).Scan(&id) != nil {
			return ""
		}
		return id
	}
	_, _ = s.db.Exec(ctx, `UPDATE ai_assistant_sessions SET updated_at = $1 WHERE id = $2 AND user_id = $3`, s.now(), sessionID, userID)
	return sessionID
}

// loadSessionHistory reads the first 40 user/assistant turns of a session
// the caller already owns (assistantAsk checks).
func (s *Service) loadSessionHistory(ctx context.Context, sessionID string) []domain.ChatMessage {
	rows, err := s.db.Query(ctx, `SELECT role, content FROM ai_assistant_messages
		WHERE session_id = $1 AND role IN ($2, $3) ORDER BY created_at ASC LIMIT $4`, sessionID, "user", "assistant", 40)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []domain.ChatMessage
	for rows.Next() {
		var m domain.ChatMessage
		if rows.Scan(&m.Role, &m.Content) != nil {
			return nil
		}
		out = append(out, m)
	}
	if rows.Err() != nil {
		return nil
	}
	return out
}

type persistInput struct {
	sessionID, prompt           string
	result                      llmResult
	intent                      domain.Intent
	scope                       domain.Scope
	userID, userEmail, userName string
	startedAt                   time.Time
}

// persistAndAudit stores the turn, appends the markdown log and writes the
// audit row; every step is best effort, as in the TS.
func (s *Service) persistAndAudit(ctx context.Context, p persistInput) {
	res := p.result
	if p.sessionID != "" {
		meta := domain.Object{
			{Key: "mode", Value: res.mode}, {Key: "model", Value: res.model}, {Key: "status", Value: res.status},
			{Key: "intent", Value: p.intent}, {Key: "scope", Value: p.scope},
		}
		// Kept so the confirmation card survives reopening the session.
		if res.pending != nil {
			meta = append(meta, domain.Field{Key: "pending_action", Value: res.pending})
		}
		raw, _ := domain.Marshal(meta)
		// One statement, so both rows share created_at as the TS insert does.
		_, _ = s.db.Exec(ctx, `INSERT INTO ai_assistant_messages (session_id, role, content, meta)
			VALUES ($1, 'user', $2, NULL), ($1, 'assistant', $3, $4::text::jsonb)`, p.sessionID, p.prompt, res.answer, string(raw))
	}
	s.appendAssistantMarkdown(ctx, p)
	var errDetail *string
	if res.errorDetail != "" {
		errDetail = &res.errorDetail
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO ai_assistant_logs (user_id, user_email, prompt, intent, mode, model, latency_ms, error)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		p.userID, p.userEmail, p.prompt, string(p.intent), res.mode, res.model, s.now().Sub(p.startedAt).Milliseconds(), errDetail)
}

var unsafeFileChars = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func (s *Service) appendAssistantMarkdown(ctx context.Context, p persistInput) {
	if os.Getenv("VERCEL") == "1" {
		return
	}
	session := p.sessionID
	if session == "" {
		session = "none"
	}
	block := strings.Join([]string{
		"\n\n---",
		"date: " + domain.ISO(s.now()),
		"user: " + p.userName + " <" + p.userEmail + ">",
		"user_id: " + p.userID,
		"session_id: " + session,
		"model: " + p.result.model,
		"scope: " + string(p.scope),
		"\n## User",
		p.prompt,
		"\n## Assistant",
		p.result.answer,
	}, "\n")
	err := os.MkdirAll(s.memoryDir, 0o755)
	if err == nil {
		var f *os.File
		f, err = os.OpenFile(filepath.Join(s.memoryDir, unsafeFileChars.ReplaceAllString(p.userEmail, "_")+".assistant.md"),
			os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err == nil {
			_, err = f.WriteString(block)
			if cerr := f.Close(); err == nil {
				err = cerr
			}
		}
	}
	if err != nil {
		s.log.WarnContext(ctx, "assistant.md write skipped", "error", err)
	}
}
