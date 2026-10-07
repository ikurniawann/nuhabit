package domain

import (
	"bytes"
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf16"
)

// JSDate is a timestamp node-postgres returned as a Date: it serializes as
// toISOString and sorts at second precision (Date.parse(date) reads
// date.toString(), which has no milliseconds).
type JSDate time.Time

// MarshalJSON writes toISOString.
func (t JSDate) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format("2006-01-02T15:04:05.000Z") + `"`), nil
}

// MarshalJSON writes the present keys in order (JSON.stringify).
func (f *Fields) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range f.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		kb, _ := marshalNoEscape(k)
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := marshalNoEscape(f.vals[k])
		if err != nil {
			return nil, err
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func marshalNoEscape(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// dateParse is Date.parse(v) in ms (-Inf when invalid).
func dateParse(v any) float64 {
	switch t := v.(type) {
	case JSDate:
		return float64(time.Time(t).Unix() * 1000)
	case string:
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00", "2006-01-02"} {
			if p, err := time.Parse(layout, t); err == nil {
				return float64(p.UnixMilli())
			}
		}
	}
	return math.Inf(-1)
}

// TimelineTask is a task/activity source row.
type TimelineTask struct {
	ID, ActivityType, Status, Priority string
	Title, Notes, OwnerName, DealTitle *string
	DueAt, DoneAt, CreatedAt           any
}

// TimelineStage is a deal stage history row.
type TimelineStage struct {
	ID, DealID, DealTitle, StageName string
	EnteredAt                        any
	ActorName                        *string
}

// TimelineQuotation is a quotation row.
type TimelineQuotation struct {
	ID, DealID, QuoteNumber, Status string
	Total                           float64
	CreatedAt                       any
}

// TimelineInvoice is an invoice row.
type TimelineInvoice struct {
	ID, DealID, InvoiceNumber, Status string
	Label                             *string
	Amount                            float64
	CreatedAt                         any
}

// TimelineWa is a crm.wa_messages row.
type TimelineWa struct {
	ID, Direction            string
	Body, Status, SenderName *string
	CreatedAt                any
}

// TimelineLead is a lead row.
type TimelineLead struct {
	ID, OrgName, Status string
	CreatedAt           any
	OwnerName           *string
}

// TimelineDeal is a deal row.
type TimelineDeal struct {
	ID, Title, StageName string
	CreatedAt            any
	OwnerName            *string
}

// TimelineSources are the merged sources (nil slices are absent).
type TimelineSources struct {
	Tasks      []TimelineTask
	Stages     []TimelineStage
	Quotations []TimelineQuotation
	Invoices   []TimelineInvoice
	WaMessages []TimelineWa
	Leads      []TimelineLead
	Deals      []TimelineDeal
}

// TimelineEvent is one merged event; Fields keeps the TS key set and order.
type TimelineEvent struct {
	Key string
	At  any
	*Fields
}

var activityLabel = map[string]string{
	"telepon": "Telepon", "wa": "WhatsApp", "meeting": "Meeting", "catatan": "Catatan", "tugas": "Task", "email": "Email",
}

func event(key, kind string, at any, title string, rest ...any) TimelineEvent {
	f := NewFields()
	f.Set("key", key)
	f.Set("kind", kind)
	f.Set("at", at)
	f.Set("title", title)
	for i := 0; i+1 < len(rest); i += 2 {
		f.Set(rest[i].(string), rest[i+1])
	}
	return TimelineEvent{Key: key, At: at, Fields: f}
}

func strOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func coalesceAt(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

// NormalizeTasks is normalizeTasks.
func NormalizeTasks(rows []TimelineTask) []TimelineEvent {
	out := []TimelineEvent{}
	for _, t := range rows {
		kind := "activity"
		if t.ActivityType == "tugas" || (t.Title != nil && *t.Title != "") {
			kind = "task"
		}
		var title string
		if t.Title != nil {
			title = *t.Title
		} else {
			label, ok := activityLabel[t.ActivityType]
			if !ok {
				label = t.ActivityType
			}
			title = label
			if t.DealTitle != nil && *t.DealTitle != "" {
				title += " · " + *t.DealTitle
			}
		}
		meta := NewFields()
		meta.Set("due_at", t.DueAt)
		meta.Set("done_at", t.DoneAt)
		meta.Set("status", t.Status)
		meta.Set("priority", t.Priority)
		meta.Set("activity_type", t.ActivityType)
		out = append(out, event("task:"+t.ID, kind, coalesceAt(t.DoneAt, t.DueAt, t.CreatedAt), title,
			"description", strOrNil(t.Notes), "badge", t.Status, "actor", strOrNil(t.OwnerName), "meta", meta))
	}
	return out
}

func dealHref(id string) string { return "/dashboard/sales-funnel/pipeline?deal=" + id }

// MergeTimeline is mergeTimeline: every source normalized, deduplicated by
// key, newest first (invalid dates last), cut to limit.
func MergeTimeline(s TimelineSources, limit int) []TimelineEvent {
	events := NormalizeTasks(s.Tasks)
	for _, st := range s.Stages {
		events = append(events, event("stage:"+st.ID, "stage", st.EnteredAt,
			`Deal "`+st.DealTitle+`" masuk tahap `+st.StageName, "actor", strOrNil(st.ActorName), "href", dealHref(st.DealID)))
	}
	for _, q := range s.Quotations {
		events = append(events, event("quotation:"+q.ID, "quotation", q.CreatedAt,
			"Quotation "+q.QuoteNumber+" · "+FormatRupiah(q.Total), "badge", q.Status, "href", dealHref(q.DealID)))
	}
	for _, i := range s.Invoices {
		title := "Invoice " + i.InvoiceNumber
		if i.Label != nil && *i.Label != "" {
			title += " (" + *i.Label + ")"
		}
		events = append(events, event("invoice:"+i.ID, "invoice", i.CreatedAt, title+" · "+FormatRupiah(i.Amount),
			"badge", i.Status, "href", dealHref(i.DealID)))
	}
	for _, m := range s.WaMessages {
		title := "WA keluar"
		if m.Direction == "inbound" {
			title = "WA masuk"
		}
		var desc any
		if m.Body != nil && *m.Body != "" {
			desc = SliceUTF16(*m.Body, 280)
		}
		events = append(events, event("wa:"+m.ID, "wa", m.CreatedAt, title,
			"description", desc, "badge", strOrNil(m.Status), "actor", strOrNil(m.SenderName)))
	}
	for _, l := range s.Leads {
		events = append(events, event("lead:"+l.ID, "lead", l.CreatedAt, "Lead dibuat: "+l.OrgName,
			"badge", l.Status, "actor", strOrNil(l.OwnerName), "href", "/dashboard/sales-funnel/leads/"+l.ID))
	}
	for _, d := range s.Deals {
		events = append(events, event("deal:"+d.ID, "deal", d.CreatedAt, "Deal dibuat: "+d.Title,
			"badge", d.StageName, "actor", strOrNil(d.OwnerName), "href", dealHref(d.ID)))
	}
	seen := map[string]bool{}
	unique := []TimelineEvent{}
	for _, e := range events {
		if seen[e.Key] {
			continue
		}
		seen[e.Key] = true
		unique = append(unique, e)
	}
	sort.SliceStable(unique, func(i, j int) bool { return dateParse(unique[i].At) > dateParse(unique[j].At) })
	if limit < len(unique) {
		unique = unique[:max(limit, 0)]
	}
	return unique
}

// TimelineScope is timelineScopeSql: the leads, deals and tasks a subject
// covers ($1 = subject id).
type TimelineScope struct{ LeadWhere, DealWhere, TaskExtra string }

// TimelineScopeSQL is timelineScopeSql.
func TimelineScopeSQL(subjectType string) TimelineScope {
	switch subjectType {
	case "lead":
		return TimelineScope{"l.id = $1", "d.lead_id = $1", "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))"}
	case "deal":
		return TimelineScope{"FALSE", "d.id = $1", "a.deal_id = $1"}
	case "account":
		return TimelineScope{"l.account_id = $1",
			"d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)",
			`((a.subject_type = 'account' AND a.subject_id = $1)
          OR (a.subject_type = 'contact' AND a.subject_id IN (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))`}
	case "contact":
		return TimelineScope{"l.contact_id = $1",
			"d.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE contact_id = $1 AND deleted_at IS NULL)",
			"(a.subject_type = 'contact' AND a.subject_id = $1)"}
	}
	return TimelineScope{"FALSE", "FALSE", "(a.subject_type = 'member' AND a.subject_id = $1)"}
}

// PhoneSuffixes is phoneSuffixes: the last 9 digits of each phone.
func PhoneSuffixes(phones []string) []string {
	out := []string{}
	for _, p := range phones {
		var b strings.Builder
		for _, c := range p {
			if c >= '0' && c <= '9' {
				b.WriteRune(c)
			}
		}
		d := b.String()
		if len(d) > 9 {
			d = d[len(d)-9:]
		}
		if len(d) >= 9 {
			out = append(out, d)
		}
	}
	return out
}

// SliceUTF16 is s.slice(0, n) with n counting UTF-16 code units.
func SliceUTF16(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}
