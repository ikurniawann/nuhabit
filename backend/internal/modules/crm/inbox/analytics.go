package inbox

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Ports lib/crm/conversation-insights-server.ts: AI summaries and keywords
// per conversation, cached by transcript fingerprint so an unchanged chat
// is never sent to the model twice. The insight summary is PII, hence the
// inbox gate.

// storedInsight is StoredInsight, in the TS key order.
type storedInsight struct {
	ConversationID string      `json:"conversation_id"`
	Summary        string      `json:"summary"`
	Topic          string      `json:"topic"`
	Sentiment      string      `json:"sentiment"`
	IsComplaint    bool        `json:"is_complaint"`
	Keywords       []string    `json:"keywords"`
	Fingerprint    string      `json:"fingerprint"`
	Model          *string     `json:"model"`
	AnalyzedAt     *kit.JSTime `json:"analyzed_at"`
}

// analyzeResult is AnalyzeResult; Error is only set when the status is failed.
type analyzeResult struct {
	ConversationID string `json:"conversation_id"`
	Status         string `json:"status"`
	Insight        any    `json:"insight"`
	Error          string `json:"error,omitempty"`
}

func loadStoredInsight(ctx context.Context, q database.Querier, conversationID string) (*storedInsight, error) {
	row, err := kit.QueryOne(ctx, q, `SELECT conversation_id, summary, topic, sentiment, is_complaint, keywords,
            fingerprint, model, analyzed_at
       FROM crm.wa_conversation_insights
      WHERE conversation_id = $1::text::uuid`, conversationID)
	if err != nil || row == nil {
		return nil, err
	}
	s := &storedInsight{
		ConversationID: row.Str("conversation_id"),
		Summary:        row.Str("summary"),
		Topic:          row.Str("topic"),
		Sentiment:      "netral",
		IsComplaint:    row.Bool("is_complaint"),
		Keywords:       domain.NormalizeKeywordList(row.JSON("keywords")),
		Fingerprint:    row.Str("fingerprint"),
		Model:          row.StrPtr("model"),
	}
	if sentiment := row.Str("sentiment"); sentiment == "positif" || sentiment == "negatif" {
		s.Sentiment = sentiment
	}
	if at, ok := row.Get("analyzed_at").(kit.JSTime); ok {
		s.AnalyzedAt = &at
	}
	return s, nil
}

func (h *handler) storedInsight(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateInbox); err != nil {
		return err
	}
	id := r.URL.Query().Get("conversation_id")
	if id == "" {
		return httpx.BadRequest("Parameter conversation_id wajib diisi")
	}
	insight, err := loadStoredInsight(r.Context(), h.db, id)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Insight *storedInsight `json:"insight"`
	}{insight})
}

func (h *handler) analyze(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateInbox); err != nil {
		return err
	}
	body, present := validate.ReadBody(r)
	// z.union: {conversation_id, force?} first, then {analyze_pending: true, limit?}.
	one := validate.New(body, present)
	id := one.UUID("conversation_id", validate.Rule{})
	force := one.Bool("force", validate.Rule{Optional: true})
	ctx := r.Context()
	if one.Valid() {
		res := h.analyzeConversation(ctx, *id, force != nil && *force)
		status := http.StatusOK
		if res.Status == domain.StatusFailed {
			status = http.StatusBadGateway
		}
		return httpx.JSON(w, status, struct {
			Success bool          `json:"success"`
			Data    analyzeResult `json:"data"`
		}{res.Status != domain.StatusFailed, res})
	}
	batch := validate.New(body, present)
	pending := batch.Bool("analyze_pending", validate.Rule{})
	limit := batch.Int("limit", validate.Rule{Optional: true}, validate.NumOpts{Positive: true, Max: validate.Bound(domain.MaxPendingLimit)})
	if !batch.Valid() || !*pending {
		return httpx.BadRequest("Body tidak valid (kirim {conversation_id} atau {analyze_pending:true, limit?})")
	}
	var rawLimit any
	if limit != nil {
		rawLimit = *limit
	}
	ids, err := h.pendingConversationIDs(ctx, domain.ClampPendingLimit(rawLimit))
	if err != nil {
		return err
	}
	results := []analyzeResult{}
	statuses := []string{}
	for _, cid := range ids {
		res := h.analyzeConversation(ctx, cid, false)
		results = append(results, res)
		statuses = append(statuses, res.Status)
	}
	return kit.OK(w, struct {
		Summary domain.BatchSummary `json:"summary"`
		Results []analyzeResult     `json:"results"`
	}{domain.SummarizeBatch(statuses), results})
}

// pendingConversationIDs are conversations without an insight or with
// messages after the last analysis, newest first. The fingerprint still
// decides per conversation whether the model is called.
func (h *handler) pendingConversationIDs(ctx context.Context, limit int) ([]string, error) {
	rows, err := h.db.Query(ctx, `SELECT v.id::text
       FROM crm.wa_conversations v
       LEFT JOIN crm.wa_conversation_insights i ON i.conversation_id = v.id
      WHERE v.last_message_at IS NOT NULL
        AND (i.conversation_id IS NULL OR v.last_message_at > i.analyzed_at)
      ORDER BY v.last_message_at DESC
      LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (h *handler) transcript(ctx context.Context, conversationID string) ([]domain.TranscriptMessage, error) {
	rows, err := h.db.Query(ctx, `SELECT direction, body
       FROM (
         SELECT direction, body, created_at
           FROM crm.wa_messages
          WHERE conversation_id = $1
            AND body IS NOT NULL
            AND message_type = ANY($2)
          ORDER BY created_at DESC
          LIMIT $3
       ) recent
      ORDER BY created_at ASC`, conversationID, domain.AnalyzedMessageTypes, domain.MaxTranscriptMessages)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []domain.MessageRow
	for rows.Next() {
		var direction, body string
		if err := rows.Scan(&direction, &body); err != nil {
			return nil, err
		}
		msgs = append(msgs, domain.MessageRow{Direction: direction, Body: body})
	}
	return domain.ToTranscript(msgs), rows.Err()
}

// errorMessage is error.message as node-postgres and fetch report it.
func errorMessage(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message
	}
	return err.Error()
}

// analyzeConversation mirrors analyzeConversation: transcript, fingerprint,
// cache hit (no model call), else the model, parse and upsert. Failures
// come back as status "failed", never as errors, so a batch continues.
func (h *handler) analyzeConversation(ctx context.Context, conversationID string, force bool) analyzeResult {
	res := analyzeResult{ConversationID: conversationID}
	fail := func(stored *storedInsight, msg string) analyzeResult {
		res.Status, res.Error = domain.StatusFailed, msg
		if stored != nil {
			res.Insight = stored
		}
		return res
	}
	transcript, err := h.transcript(ctx, conversationID)
	var stored *storedInsight
	if err == nil {
		stored, err = loadStoredInsight(ctx, h.db, conversationID)
	}
	if err != nil {
		return fail(nil, errorMessage(err))
	}
	if stored != nil {
		res.Insight = stored
	}
	if len(transcript) == 0 {
		res.Status = domain.StatusEmpty
		return res
	}
	fingerprint := domain.Fingerprint(transcript)
	var storedFP *string
	if stored != nil {
		storedFP = &stored.Fingerprint
	}
	if !force && !domain.NeedsAnalysis(storedFP, fingerprint) {
		res.Status = domain.StatusCache
		return res
	}
	content, model, err := h.AI.Complete(ctx, h.db, domain.AnalysisMessages(transcript))
	if err != nil {
		h.log.Warn("Analisa percakapan gagal", "conversation_id", conversationID, "error", err.Error())
		return fail(stored, errorMessage(err))
	}
	insight := domain.ParseInsight(content)
	if insight == nil {
		return fail(stored, "Jawaban AI tidak bisa dibaca sebagai JSON")
	}
	_, err = h.db.Exec(ctx, `INSERT INTO crm.wa_conversation_insights
       (conversation_id, summary, topic, sentiment, is_complaint, keywords,
        fingerprint, model, analyzed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
     ON CONFLICT (conversation_id) DO UPDATE
        SET summary = EXCLUDED.summary,
            topic = EXCLUDED.topic,
            sentiment = EXCLUDED.sentiment,
            is_complaint = EXCLUDED.is_complaint,
            keywords = EXCLUDED.keywords,
            fingerprint = EXCLUDED.fingerprint,
            model = EXCLUDED.model,
            analyzed_at = now()`,
		conversationID, insight.Summary, insight.Topic, insight.Sentiment, insight.IsComplaint,
		kit.JSONText(insight.Keywords), fingerprint, model)
	if err != nil {
		h.log.Warn("Analisa percakapan gagal", "conversation_id", conversationID, "error", err.Error())
		return fail(stored, errorMessage(err))
	}
	res.Status, res.Insight = domain.StatusAnalyzed, insight
	return res
}
