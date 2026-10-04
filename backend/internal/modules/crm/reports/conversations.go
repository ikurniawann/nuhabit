package reports

import (
	"net/http"

	inbox "nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reports/domain"
)

// conversations is GET /api/crm/reports/conversations: the conversation
// insight aggregates as JSON, or with format=xlsx as a three-sheet file.
// Conversations count by last_message_at, like the CS report, and the query
// never reads summaries, phones or names.
func (h *handler) conversations(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReports); err != nil {
		return err
	}
	period, err := h.requirePeriod(r)
	if err != nil {
		return err
	}
	ctx, from, to := r.Context(), period.FromISO, period.ToISO
	rows, err := kit.Query(ctx, h.db, `SELECT i.topic, i.sentiment, i.is_complaint, i.keywords
         FROM crm.wa_conversation_insights i
         JOIN crm.wa_conversations v ON v.id = i.conversation_id
        WHERE v.last_message_at >= $1 AND v.last_message_at < $2`, from, to)
	if err != nil {
		return err
	}
	total, err := kit.QueryOne(ctx, h.db, `SELECT COUNT(*)::int AS total
         FROM crm.wa_conversations
        WHERE last_message_at >= $1 AND last_message_at < $2`, from, to)
	if err != nil {
		return err
	}
	insights := make([]domain.Insight, len(rows))
	for i, row := range rows {
		in := domain.Insight{Topic: row.Str("topic"), Sentiment: "netral", IsComplaint: row.Bool("is_complaint"),
			Keywords: inbox.NormalizeKeywordList(row.JSON("keywords"))}
		if s := row.Str("sentiment"); s == "positif" || s == "negatif" {
			in.Sentiment = s
		}
		insights[i] = in
	}
	report := domain.BuildInsightReport(insights, domain.DateRange{From: period.FromDate, To: period.ToDate},
		int(total.Num("total")), domain.KeywordLimit, domain.TopicLimit)

	if r.URL.Query().Get("format") != "xlsx" {
		return kit.OK(w, report)
	}
	return kit.XlsxResponse(w, domain.InsightFileName(report.Period), domain.InsightSheets(report)...)
}
