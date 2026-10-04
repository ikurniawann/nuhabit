package domain

import (
	"cmp"
	"slices"
	"strings"

	inbox "nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/platform/xlsx"
)

// The conversation insight report (lib/crm/conversation-insights.ts and the
// aggregation half of lib/conversation-analytics). It carries aggregates
// only: no chat text, phone numbers, customer names or conversation ids.

// Insight is AggregatableInsight: the insight columns a report may read.
type Insight struct {
	Topic       string
	Sentiment   string
	IsComplaint bool
	Keywords    []string
}

// Sentiments is SentimentBreakdown.
type Sentiments struct {
	Positif int `json:"positif"`
	Netral  int `json:"netral"`
	Negatif int `json:"negatif"`
}

// KeywordStat counts a keyword: Count is every occurrence, Conversations the
// distinct conversations holding it.
type KeywordStat struct {
	Keyword       string `json:"keyword"`
	Count         int    `json:"count"`
	Conversations int    `json:"conversations"`
}

// TopicStat counts a topic.
type TopicStat struct {
	Topic string `json:"topic"`
	Count int    `json:"count"`
}

// InsightSummary is the summary block of the report.
type InsightSummary struct {
	TotalConversations int        `json:"total_conversations"`
	Analyzed           int        `json:"analyzed"`
	NotAnalyzed        int        `json:"not_analyzed"`
	Complaints         int        `json:"complaints"`
	Sentiment          Sentiments `json:"sentiment"`
}

// DateRange is the report's {from, to} in YYYY-MM-DD.
type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// InsightReport is ConversationInsightReport.
type InsightReport struct {
	Period   DateRange      `json:"period"`
	Summary  InsightSummary `json:"summary"`
	Keywords []KeywordStat  `json:"keywords"`
	Topics   []TopicStat    `json:"topics"`
}

// Default limits of buildInsightReport.
const (
	KeywordLimit = 30
	TopicLimit   = 15
)

// BuildInsightReport mirrors buildInsightReport. not_analyzed never goes
// negative when the period was narrowed after the analysis.
func BuildInsightReport(insights []Insight, period DateRange, totalConversations, keywordLimit, topicLimit int) InsightReport {
	complaints := 0
	for _, in := range insights {
		if in.IsComplaint {
			complaints++
		}
	}
	return InsightReport{
		Period: period,
		Summary: InsightSummary{
			TotalConversations: totalConversations,
			Analyzed:           len(insights),
			NotAnalyzed:        max(0, totalConversations-len(insights)),
			Complaints:         complaints,
			Sentiment:          SentimentBreakdown(insights),
		},
		Keywords: AggregateKeywords(insights, keywordLimit),
		Topics:   TopicDistribution(insights, topicLimit),
	}
}

// AggregateKeywords mirrors aggregateKeywords: keywords normalized again,
// most conversations first, then most occurrences, then by name (see
// TopicDistribution for the name order).
func AggregateKeywords(insights []Insight, limit int) []KeywordStat {
	stats := []KeywordStat{}
	index := map[string]int{}
	for _, in := range insights {
		seen := map[string]bool{}
		for _, raw := range in.Keywords {
			k := inbox.NormalizeKeyword(raw)
			if k == "" {
				continue
			}
			i, ok := index[k]
			if !ok {
				i = len(stats)
				index[k] = i
				stats = append(stats, KeywordStat{Keyword: k})
			}
			stats[i].Count++
			if !seen[k] {
				stats[i].Conversations++
				seen[k] = true
			}
		}
	}
	slices.SortFunc(stats, func(a, b KeywordStat) int {
		return cmp.Or(b.Conversations-a.Conversations, b.Count-a.Count, strings.Compare(a.Keyword, b.Keyword))
	})
	return stats[:min(limit, len(stats))]
}

// TopicDistribution mirrors topicDistribution: trimmed lower-case topics,
// most frequent first. Names compare by code point where the TS uses
// localeCompare("id"); both sides are lower case, so only non-ASCII
// letters can order differently.
func TopicDistribution(insights []Insight, limit int) []TopicStat {
	stats := []TopicStat{}
	index := map[string]int{}
	for _, in := range insights {
		topic := strings.ToLower(inbox.JSTrim(in.Topic))
		if topic == "" {
			continue
		}
		i, ok := index[topic]
		if !ok {
			i = len(stats)
			index[topic] = i
			stats = append(stats, TopicStat{Topic: topic})
		}
		stats[i].Count++
	}
	slices.SortFunc(stats, func(a, b TopicStat) int {
		return cmp.Or(b.Count-a.Count, strings.Compare(a.Topic, b.Topic))
	})
	return stats[:min(limit, len(stats))]
}

// SentimentBreakdown mirrors sentimentBreakdown: values outside the three
// sentiments are not counted.
func SentimentBreakdown(insights []Insight) Sentiments {
	var out Sentiments
	for _, in := range insights {
		switch in.Sentiment {
		case "positif":
			out.Positif++
		case "netral":
			out.Netral++
		case "negatif":
			out.Negatif++
		}
	}
	return out
}

// InsightSheets mirrors buildReportSheets: Ringkasan, Kata Kunci and Topik.
func InsightSheets(r InsightReport) []xlsx.SheetSpec {
	s := r.Summary
	keywords := [][]any{{"Kata Kunci", "Jumlah Percakapan", "Total Kemunculan"}}
	for _, k := range r.Keywords {
		keywords = append(keywords, []any{k.Keyword, k.Conversations, k.Count})
	}
	topics := [][]any{{"Topik", "Jumlah Percakapan"}}
	for _, t := range r.Topics {
		topics = append(topics, []any{t.Topic, t.Count})
	}
	return []xlsx.SheetSpec{
		{Name: "Ringkasan", Rows: [][]any{
			{"Laporan Analitik Percakapan"},
			{"Periode", r.Period.From + " s/d " + r.Period.To},
			{},
			{"Metrik", "Jumlah"},
			{"Percakapan pada periode", s.TotalConversations},
			{"Sudah dianalisa", s.Analyzed},
			{"Belum dianalisa", s.NotAnalyzed},
			{"Terindikasi komplain", s.Complaints},
			{"Sentimen positif", s.Sentiment.Positif},
			{"Sentimen netral", s.Sentiment.Netral},
			{"Sentimen negatif", s.Sentiment.Negatif},
			{},
			{"Catatan", "Laporan agregat: tanpa isi chat, nomor telepon, dan nama customer."},
		}},
		{Name: "Kata Kunci", Rows: keywords},
		{Name: "Topik", Rows: topics},
	}
}

// InsightFileName mirrors reportFileName: dated so downloads do not
// overwrite each other.
func InsightFileName(p DateRange) string {
	return "analitik-percakapan-" + p.From + "_" + p.To + ".xlsx"
}
