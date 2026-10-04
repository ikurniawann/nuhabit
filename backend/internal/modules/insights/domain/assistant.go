package domain

import (
	"fmt"
	"regexp"
	"strings"
)

// Rules of the Do assistant (lib/assistant/{summary,context,llm,session-store}.ts
// and lib/ai-assistant-config.ts).

// Intent is AssistantIntent.
type Intent string

// Intents.
const (
	IntentAll         Intent = "all"
	IntentHris        Intent = "hris"
	IntentProcurement Intent = "procurement"
	IntentPos         Intent = "pos"
	IntentInventory   Intent = "inventory"
	IntentPerformance Intent = "performance"
	IntentPayroll     Intent = "payroll"
	IntentIntegration Intent = "integration"
	IntentMaster      Intent = "master"
)

func containsAny(s string, words ...string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

// DetectIntent classifies a question by keyword, first match wins.
func DetectIntent(message string) Intent {
	lower := strings.ToLower(message)
	switch {
	case containsAny(lower, "kpi", "performance", "review", "penilaian"):
		return IntentPerformance
	case containsAny(lower, "payroll", "gaji", "salary", "benefit", "loan"):
		return IntentPayroll
	case containsAny(lower, "integration", "integrasi", "webhook", "api", "ai assistant"):
		return IntentIntegration
	case containsAny(lower, "master", "department", "departemen", "position", "jabatan"):
		return IntentMaster
	case containsAny(lower, "hr", "kandidat", "candidate", "employee", "karyawan", "attendance", "absen", "leave", "cuti"):
		return IntentHris
	case containsAny(lower, "procurement", "purchasing", "po", "pr", "supplier"):
		return IntentProcurement
	case containsAny(lower, "pos", "sales", "order", "reservasi"):
		return IntentPos
	case containsAny(lower, "stock", "stok", "inventory", "bahan"):
		return IntentInventory
	}
	return IntentAll
}

// summaryModules lists the summary modules in order with their labels.
var summaryModules = [][2]string{
	{"hris", "HRIS"},
	{"performance", "Performance"},
	{"payroll", "Payroll"},
	{"procurement", "Procurement"},
	{"inventory", "Inventory"},
	{"pos", "POS"},
	{"master", "Master Data"},
	{"integration", "Integration"},
}

// IntentModules is INTENT_MODULES: the modules sent to the model per intent.
var IntentModules = map[Intent][]string{
	IntentAll:         {"hris", "performance", "payroll", "procurement", "inventory", "pos", "master", "integration"},
	IntentHris:        {"hris", "master"},
	IntentPerformance: {"performance", "hris"},
	IntentPayroll:     {"payroll", "hris"},
	IntentProcurement: {"procurement", "inventory"},
	IntentInventory:   {"inventory", "procurement"},
	IntentPos:         {"pos", "inventory"},
	IntentMaster:      {"master", "hris"},
	IntentIntegration: {"integration"},
}

// Metrics is a Record<string, number> in insertion order.
type Metrics = Object

// Summary is the assistant's operational summary. Metric groups are kept
// in the TS key order; Details holds intent -> rows in insertion order.
type Summary struct {
	GeneratedAt string  `json:"generatedAt"`
	Hris        Metrics `json:"hris"`
	Performance Metrics `json:"performance"`
	Payroll     Metrics `json:"payroll"`
	Procurement Metrics `json:"procurement"`
	Pos         Metrics `json:"pos"`
	Inventory   Metrics `json:"inventory"`
	Master      Metrics `json:"master"`
	Integration Metrics `json:"integration"`
	Modules     Object  `json:"modules"`
	Details     Object  `json:"details"`
}

// ModuleSummary is one entry of Summary.Modules.
type ModuleSummary struct {
	Label   string  `json:"label"`
	Metrics Metrics `json:"metrics"`
}

func (s Summary) group(key string) Metrics {
	switch key {
	case "hris":
		return s.Hris
	case "performance":
		return s.Performance
	case "payroll":
		return s.Payroll
	case "procurement":
		return s.Procurement
	case "pos":
		return s.Pos
	case "inventory":
		return s.Inventory
	case "master":
		return s.Master
	case "integration":
		return s.Integration
	}
	return nil
}

// WithModules fills Modules from the metric groups.
func (s Summary) WithModules() Summary {
	s.Modules = Object{}
	for _, m := range summaryModules {
		s.Modules = append(s.Modules, Field{m[0], ModuleSummary{Label: m[1], Metrics: s.group(m[0])}})
	}
	return s
}

// EmptySummary is createEmptySystemSummary.
func EmptySummary(generatedAt string) Summary {
	return Summary{
		GeneratedAt: generatedAt,
		Hris:        Metrics{}, Performance: Metrics{}, Payroll: Metrics{}, Procurement: Metrics{},
		Pos: Metrics{}, Inventory: Metrics{}, Master: Metrics{}, Integration: Metrics{},
		Modules: Object{}, Details: Object{},
	}
}

func rowsOf(v any) []Object {
	rows, _ := v.([]Object)
	return rows
}

// SelectedContext is what the model receives: only the intent's modules.
type SelectedContext struct {
	DibuatPada string `json:"dibuatPada"`
	Modul      Object `json:"modul"`
	Rincian    Object `json:"rincian"`
}

// SelectContextForIntent keeps the modules (and non-empty detail rows) of
// the intent; an unknown intent means all.
func SelectContextForIntent(s Summary, intent Intent) SelectedContext {
	keys, ok := IntentModules[intent]
	if !ok {
		keys = IntentModules[IntentAll]
	}
	out := SelectedContext{DibuatPada: s.GeneratedAt, Modul: Object{}, Rincian: Object{}}
	for _, k := range keys {
		if m := s.Modules.Get(k); m != nil {
			out.Modul = append(out.Modul, Field{k, m})
		}
	}
	for _, k := range keys {
		if rows := rowsOf(s.Details.Get(k)); len(rows) > 0 {
			out.Rincian = append(out.Rincian, Field{k, rows})
		}
	}
	return out
}

// ContextSizeChars is JSON.stringify(value).length.
func ContextSizeChars(v any) int {
	b, _ := Marshal(v)
	return Len(string(b))
}

func metric(m Metrics, key string) string {
	switch v := m.Get(key).(type) {
	case nil:
		return "0"
	default:
		return JSString(v)
	}
}

// GenerateSummaryAnswer is the internal fallback answer.
func GenerateSummaryAnswer(message string, s Summary, name string, intent Intent) string {
	lower := strings.ToLower(message)
	includeAll := intent == IntentAll || lower == "" || containsAny(lower, "semua", "summary", "ringkas", "overview")
	join := func(parts ...string) string {
		kept := parts[:0]
		for _, p := range parts {
			if p != "" {
				kept = append(kept, p)
			}
		}
		return strings.Join(kept, "\n\n")
	}
	if includeAll {
		return join(
			"Halo "+name+", berikut ringkasan NüHabit OS saat ini:",
			formatHris(s), formatPerformance(s), formatPayroll(s), formatProcurement(s),
			formatInventory(s), formatPos(s), formatMaster(s), formatIntegration(s),
			formatDetails(s, ""),
			"Prioritas: cek kandidat baru, review performance, PO pending, inventory low stock, dan aktivitas POS terbaru.",
		)
	}
	switch intent {
	case IntentHris:
		return join(formatHris(s), formatDetails(s, IntentHris))
	case IntentPerformance:
		return join(formatPerformance(s), formatDetails(s, IntentPerformance))
	case IntentPayroll:
		return join(formatPayroll(s), formatDetails(s, IntentPayroll))
	case IntentProcurement:
		return join(formatProcurement(s), formatDetails(s, IntentProcurement))
	case IntentPos:
		return join(formatPos(s), formatDetails(s, IntentPos))
	case IntentInventory:
		return join(formatInventory(s), formatDetails(s, IntentInventory))
	case IntentMaster:
		return join(formatMaster(s), formatDetails(s, IntentMaster))
	case IntentIntegration:
		return join(formatIntegration(s), formatDetails(s, IntentIntegration))
	}
	return strings.Join([]string{formatHris(s), formatPerformance(s), formatPayroll(s), formatProcurement(s),
		formatInventory(s), formatPos(s), formatMaster(s), formatIntegration(s)}, "\n\n")
}

func formatHris(s Summary) string {
	m := s.Hris
	return fmt.Sprintf("HRIS: %s total kandidat, %s kandidat masuk hari ini, %s kandidat status new, %s karyawan, %s attendance hari ini, %s leave request, %s job opening.",
		metric(m, "candidatesTotal"), metric(m, "candidatesToday"), metric(m, "candidatesNew"), metric(m, "employeesTotal"),
		metric(m, "attendanceToday"), metric(m, "leavesTotal"), metric(m, "jobOpeningsTotal"))
}

func formatPerformance(s Summary) string {
	m := s.Performance
	return fmt.Sprintf("Performance: %s review, %s employee KPI, %s template KPI, %s development plan.",
		metric(m, "performanceReviewsTotal"), metric(m, "employeeKpisTotal"), metric(m, "kpiTemplatesTotal"), metric(m, "developmentPlansTotal"))
}

func formatPayroll(s Summary) string {
	m := s.Payroll
	return fmt.Sprintf("Payroll: %s payroll run, %s payroll detail, %s salary record, %s benefit, %s loan.",
		metric(m, "payrollRunsTotal"), metric(m, "payrollDetailsTotal"), metric(m, "employeeSalaryTotal"), metric(m, "benefitsTotal"), metric(m, "loansTotal"))
}

func formatProcurement(s Summary) string {
	m := s.Procurement
	return fmt.Sprintf("Procurement: %s PR, %s PO, %s PO perlu perhatian, %s supplier, %s raw material.",
		metric(m, "purchaseRequestsTotal"), metric(m, "purchaseOrdersTotal"), metric(m, "purchaseOrdersPending"), metric(m, "suppliersTotal"), metric(m, "rawMaterialsTotal"))
}

func formatPos(s Summary) string {
	m := s.Pos
	return fmt.Sprintf("POS: %s order, %s reservasi, %s customer, %s shift.",
		metric(m, "posOrdersTotal"), metric(m, "posReservationsTotal"), metric(m, "posCustomersTotal"), metric(m, "posShiftsTotal"))
}

func formatInventory(s Summary) string {
	m := s.Inventory
	return fmt.Sprintf("Inventory: %s item inventory, %s item low/empty stock, %s movement, %s product.",
		metric(m, "inventoryItems"), metric(m, "lowStockItems"), metric(m, "inventoryMovementsTotal"), metric(m, "productsTotal"))
}

func formatMaster(s Summary) string {
	m := s.Master
	return fmt.Sprintf("Master Data: %s department, %s position, %s employment status, %s user.",
		metric(m, "departmentsTotal"), metric(m, "positionsTotal"), metric(m, "employmentStatusesTotal"), metric(m, "usersTotal"))
}

func formatIntegration(s Summary) string {
	m := s.Integration
	return fmt.Sprintf("Integration: %s notification, %s AI assistant log.", metric(m, "notificationsTotal"), metric(m, "aiAssistantLogsTotal"))
}

var detailLabels = [][2]string{
	{"hris", "Kandidat terbaru"},
	{"performance", "Performance review terbaru"},
	{"payroll", "Payroll run terbaru"},
	{"procurement", "PO pending terbaru"},
	{"inventory", "Inventory low stock"},
	{"pos", "POS order terbaru"},
	{"master", "Master data terbaru"},
	{"integration", "AI assistant activity"},
}

// formatDetails lists up to 5 rows per module as "v1 | v2 | v3 | v4" of
// the first four truthy values.
func formatDetails(s Summary, only Intent) string {
	var lines []string
	for _, d := range detailLabels {
		if only != "" && string(only) != d[0] {
			continue
		}
		rows := rowsOf(s.Details.Get(d[0]))
		if len(rows) == 0 {
			continue
		}
		if len(rows) > 5 {
			rows = rows[:5]
		}
		parts := make([]string, len(rows))
		for i, row := range rows {
			var vals []string
			for _, f := range row {
				if Truthy(f.Value) && len(vals) < 4 {
					vals = append(vals, JSString(f.Value))
				}
			}
			parts[i] = strings.Join(vals, " | ")
		}
		lines = append(lines, d[1]+": "+strings.Join(parts, "; "))
	}
	return strings.Join(lines, "\n")
}

// Scope is the assistant context mode.
type Scope string

// Scopes in AI_ASSISTANT_SCOPES order.
const (
	ScopeProjectPlusGeneral Scope = "project_plus_general"
	ScopeProjectOnly        Scope = "project_only"
	ScopeGeneral            Scope = "general"
)

// AssistantModel is one AI_ASSISTANT_MODELS entry.
type AssistantModel struct {
	ID                  string
	SupportsTemperature bool
}

// AssistantModels is AI_ASSISTANT_MODELS; the first is the default.
var AssistantModels = []AssistantModel{
	{"openai:gpt-4o-mini", true},
	{"openai:gpt-4.1-mini", true},
	{"openai:gpt-4o", true},
	{"openai:gpt-5.4-mini", true},
	{"openai:gpt-5.5", false},
}

// ResolveModel is resolveAiAssistantModel(value): a known id or the default.
func ResolveModel(value any) string {
	if s, ok := value.(string); ok {
		s = Trim(s)
		for _, m := range AssistantModels {
			if m.ID == s {
				return s
			}
		}
	}
	return AssistantModels[0].ID
}

// ResolveScope is resolveAiAssistantScope(value).
func ResolveScope(value any) Scope {
	if s, ok := value.(string); ok {
		switch sc := Scope(Trim(s)); sc {
		case ScopeProjectPlusGeneral, ScopeProjectOnly, ScopeGeneral:
			return sc
		}
	}
	return ScopeProjectPlusGeneral
}

// ModelSupportsTemperature: unknown models are assumed to accept it.
func ModelSupportsTemperature(model string) bool {
	for _, m := range AssistantModels {
		if m.ID == model {
			return m.SupportsTemperature
		}
	}
	return true
}

// StripOpenAIPrefix turns "openai:gpt-4o-mini" into "gpt-4o-mini".
func StripOpenAIPrefix(model string) string { return strings.TrimPrefix(model, "openai:") }

// BuildScopeInstruction is the system-prompt paragraph for a scope.
func BuildScopeInstruction(scope Scope) string {
	switch scope {
	case ScopeProjectOnly:
		return strings.Join([]string{
			"Mode Project Only aktif.",
			"Jawab hanya berdasarkan konteks Talentpool/NüHabit OS, history percakapan, dan data internal yang diberikan.",
			"Jika user bertanya pengetahuan umum atau hal di luar project, jelaskan singkat bahwa mode Project Only sedang aktif dan minta user mengganti mode di NüHabit OS Settings.",
		}, " ")
	case ScopeGeneral:
		return strings.Join([]string{
			"Mode General Chat aktif.",
			"Jawab seperti assistant umum dengan knowledge model.",
			"Jangan mengklaim sedang membaca data operasional Talentpool karena data project tidak dikirim pada mode ini.",
		}, " ")
	}
	return strings.Join([]string{
		"Mode Project + General aktif.",
		"Untuk pertanyaan operasional Talentpool/NüHabit OS, prioritaskan data internal yang diberikan.",
		"Untuk ide, strategi, copywriting, SOP, analisis, coding, dan pertanyaan umum, jawab bebas dengan knowledge model tanpa memaksa data dashboard.",
	}, " ")
}

var (
	mdBold       = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	mdUnderline  = regexp.MustCompile(`__([^_]+)__`)
	mdHeading    = regexp.MustCompile(`(?m)^#{1,6}[` + jsSpace + `]+`)
	mdBullet     = regexp.MustCompile(`(?m)^[` + jsSpace + `]*\*[` + jsSpace + `]+`)
	mdBlockquote = regexp.MustCompile(`(?m)^[` + jsSpace + `]*>[` + jsSpace + `]?`)
	mdCode       = regexp.MustCompile("`([^`\n]+)`")
)

// NormalizePlainTextAnswer strips markdown the model was told not to use.
func NormalizePlainTextAnswer(value string) string {
	value = mdBold.ReplaceAllString(value, "$1")
	value = mdUnderline.ReplaceAllString(value, "$1")
	value = mdHeading.ReplaceAllString(value, "")
	value = mdBullet.ReplaceAllString(value, "- ")
	value = mdBlockquote.ReplaceAllString(value, "")
	value = mdCode.ReplaceAllString(value, "$1")
	return Trim(value)
}

// ChatMessage is one history turn. Invalid marks a client turn whose
// content is not a string, which makes the TS throw when it is compacted.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Invalid bool   `json:"-"`
}

// Attachment is an extracted attachment, bounded for the prompt.
type Attachment struct {
	Name      string
	Text      string
	Truncated bool
}

const (
	maxAttachments     = 5
	maxAttachmentText  = 20_000
	maxAttachmentTotal = 40_000
)

// SanitizeAttachments caps the count (5), per-file text (20k) and total
// text (40k) of client-sent attachments; items without text are dropped.
func SanitizeAttachments(input any) []Attachment {
	items, ok := input.([]any)
	if !ok {
		return nil
	}
	if len(items) > maxAttachments {
		items = items[:maxAttachments]
	}
	var out []Attachment
	total := 0
	for _, item := range items {
		raw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text := ""
		if s, ok := raw["text"].(string); ok {
			text = Trim(s)
		}
		if text == "" {
			continue
		}
		name := "lampiran"
		if s, ok := raw["name"].(string); ok && Trim(s) != "" {
			name = Slice(Trim(s), 120)
		}
		remaining := maxAttachmentTotal - total
		if remaining <= 0 {
			break
		}
		limit := min(maxAttachmentText, remaining)
		n := Len(text)
		cut := n > limit
		if cut {
			text = Slice(text, limit)
		}
		out = append(out, Attachment{Name: name, Text: text, Truncated: cut})
		total += min(n, limit)
	}
	return out
}

// CompactChatHistory keeps the user and assistant turns among the last 12,
// newest-first within a 5000 character budget, whitespace collapsed, 900
// chars per assistant turn and 700 per user turn, then restores
// chronological order. Other roles (system, tool) are dropped so a client
// cannot inject instructions: the only system prompt is the server's. ok is
// false when it reaches an Invalid user or assistant turn.
func CompactChatHistory(history []ChatMessage) (_ []ChatMessage, ok bool) {
	if len(history) > 12 {
		history = history[len(history)-12:]
	}
	budget := 5000
	var out []ChatMessage
	for i := len(history) - 1; i >= 0; i-- {
		item := history[i]
		if item.Role != "user" && item.Role != "assistant" {
			continue
		}
		if item.Invalid {
			return nil, false
		}
		maxLen := 700
		if item.Role == "assistant" {
			maxLen = 900
		}
		content := Slice(Trim(CollapseSpace(item.Content)), maxLen)
		if content == "" {
			continue
		}
		budget -= Len(content)
		if budget < 0 {
			break
		}
		out = append(out, ChatMessage{Role: item.Role, Content: content})
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, true
}
