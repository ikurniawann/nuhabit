package domain

import (
	"reflect"
	"regexp"
	"slices"
	"testing"
)

// Ports the buildInsightReport, buildReportSheets and reportFileName cases
// of lib/crm/conversation-insights.test.ts and the aggregation cases of
// lib/conversation-analytics/conversation-analytics.test.ts.

var july = DateRange{From: "2026-07-01", To: "2026-07-25"}

var insights = []Insight{
	{Topic: "keluhan pengiriman", Sentiment: "negatif", IsComplaint: true, Keywords: []string{"pengiriman", "terlambat"}},
	{Topic: "keluhan pengiriman", Sentiment: "negatif", IsComplaint: true, Keywords: []string{"pengiriman", "paket rusak"}},
	{Topic: "tanya harga", Sentiment: "netral", Keywords: []string{"harga", "tiket"}},
}

func TestBuildInsightReport(t *testing.T) {
	r := BuildInsightReport(insights, july, 10, KeywordLimit, TopicLimit)
	if r.Period != july {
		t.Fatalf("period %v", r.Period)
	}
	want := InsightSummary{TotalConversations: 10, Analyzed: 3, NotAnalyzed: 7, Complaints: 2, Sentiment: Sentiments{Netral: 1, Negatif: 2}}
	if r.Summary != want {
		t.Fatalf("summary %+v", r.Summary)
	}
	if r.Keywords[0] != (KeywordStat{Keyword: "pengiriman", Count: 2, Conversations: 2}) {
		t.Fatalf("keywords %v", r.Keywords)
	}
	if r.Topics[0] != (TopicStat{Topic: "keluhan pengiriman", Count: 2}) {
		t.Fatalf("topics %v", r.Topics)
	}

	// not_analyzed never goes negative.
	if r := BuildInsightReport(insights, july, 1, KeywordLimit, TopicLimit); r.Summary.NotAnalyzed != 0 {
		t.Fatalf("not_analyzed %d", r.Summary.NotAnalyzed)
	}
	if r := BuildInsightReport(insights, july, 3, 1, 1); len(r.Keywords) != 1 || len(r.Topics) != 1 {
		t.Fatalf("limits %v %v", r.Keywords, r.Topics)
	}
	r = BuildInsightReport(nil, july, 4, KeywordLimit, TopicLimit)
	if r.Summary.Analyzed != 0 || r.Summary.NotAnalyzed != 4 || r.Summary.Complaints != 0 || r.Keywords == nil || len(r.Keywords) != 0 || r.Topics == nil || len(r.Topics) != 0 {
		t.Fatalf("empty %+v", r)
	}
}

func TestAggregateKeywords(t *testing.T) {
	got := AggregateKeywords([]Insight{{Keywords: []string{"kopi", "kopi", "gula"}}, {Keywords: []string{"kopi", "antri"}}}, 30)
	i := slices.IndexFunc(got, func(k KeywordStat) bool { return k.Keyword == "kopi" })
	if i < 0 || got[i] != (KeywordStat{Keyword: "kopi", Count: 3, Conversations: 2}) {
		t.Fatalf("kopi %v", got)
	}
	got = AggregateKeywords([]Insight{{Keywords: []string{"antri"}}, {Keywords: []string{"antri", "parkir"}}, {Keywords: []string{"antri"}}}, 30)
	if got[0].Keyword != "antri" || got[0].Conversations != 3 {
		t.Fatalf("order %v", got)
	}
	got = AggregateKeywords([]Insight{{Keywords: []string{"yang", "terima kasih", "parkir"}}}, 30)
	if len(got) != 1 || got[0].Keyword != "parkir" {
		t.Fatalf("stopwords %v", got)
	}
	if got := AggregateKeywords([]Insight{{Keywords: []string{"satu-x", "dua-x", "tiga-x", "empat-x"}}}, 2); len(got) != 2 {
		t.Fatalf("limit %v", got)
	}
}

func TestTopicsAndSentiments(t *testing.T) {
	got := TopicDistribution([]Insight{{Topic: "Keluhan Pengiriman"}, {Topic: "keluhan pengiriman"}, {Topic: "tanya harga"}, {Topic: ""}}, 15)
	if len(got) != 2 || got[0] != (TopicStat{Topic: "keluhan pengiriman", Count: 2}) {
		t.Fatalf("topics %v", got)
	}
	s := SentimentBreakdown([]Insight{{Sentiment: "positif"}, {Sentiment: "negatif"}, {Sentiment: "negatif"}, {Sentiment: "marah"}})
	if s != (Sentiments{Positif: 1, Negatif: 2}) {
		t.Fatalf("sentiments %+v", s)
	}
}

func TestInsightSheets(t *testing.T) {
	r := BuildInsightReport([]Insight{{Topic: "keluhan pengiriman", Sentiment: "negatif", IsComplaint: true, Keywords: []string{"pengiriman"}}}, july, 2, KeywordLimit, TopicLimit)
	sheets := InsightSheets(r)
	var names []string
	for _, s := range sheets {
		names = append(names, s.Name)
		if len(s.Name) > 31 {
			t.Errorf("sheet name %q is longer than 31", s.Name)
		}
	}
	if !reflect.DeepEqual(names, []string{"Ringkasan", "Kata Kunci", "Topik"}) {
		t.Fatalf("names %v", names)
	}
	ringkasan := sheets[0].Rows
	if !reflect.DeepEqual(ringkasan[1], []any{"Periode", "2026-07-01 s/d 2026-07-25"}) {
		t.Fatalf("periode %v", ringkasan[1])
	}
	for _, want := range [][]any{{"Percakapan pada periode", 2}, {"Sudah dianalisa", 1}, {"Terindikasi komplain", 1}, {"Sentimen negatif", 1}} {
		if !slices.ContainsFunc(ringkasan, func(row []any) bool { return reflect.DeepEqual(row, want) }) {
			t.Errorf("Ringkasan lacks %v", want)
		}
	}
	if !reflect.DeepEqual(sheets[1].Rows, [][]any{{"Kata Kunci", "Jumlah Percakapan", "Total Kemunculan"}, {"pengiriman", 1, 1}}) {
		t.Fatalf("Kata Kunci %v", sheets[1].Rows)
	}
	if !reflect.DeepEqual(sheets[2].Rows, [][]any{{"Topik", "Jumlah Percakapan"}, {"keluhan pengiriman", 1}}) {
		t.Fatalf("Topik %v", sheets[2].Rows)
	}
	// Aggregates only: no cell may look like a phone number.
	phone := regexp.MustCompile(`\+?\d{9,}`)
	for _, s := range sheets {
		for _, row := range s.Rows {
			for _, cell := range row {
				if text, ok := cell.(string); ok && phone.MatchString(text) {
					t.Errorf("PII-like cell %q", text)
				}
			}
		}
	}
}

func TestInsightFileName(t *testing.T) {
	if got := InsightFileName(july); got != "analitik-percakapan-2026-07-01_2026-07-25.xlsx" {
		t.Fatal(got)
	}
}
