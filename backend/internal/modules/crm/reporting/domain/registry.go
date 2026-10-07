// Package domain is the pure half of the CRM report builder (EPIC-050 phase
// 4), ported from lib/crm/report-builder.ts and report-schedule.ts: the
// dataset registry, report definitions, the SQL builder, result summaries
// and schedule timing.
//
// Every SQL fragment (tables, joins, column expressions) comes from the
// registry in this file. User input only picks field KEYS; filter values
// always travel as parameters.
package domain

// The datasets read sales-funnel tables (crm_sales_leads, crm_sales_deals,
// crm_sales_stages, crm_pipelines, crm_sales_lost_reasons,
// crm_sales_quotations, crm_sales_activities, crm_accounts, crm_contacts)
// and configuration.users as read models.

// Dataset keys in registry order.
var Datasets = []string{"lead", "deal", "quotation", "task", "account", "contact"}

// Field is one selectable column of a dataset.
type Field struct {
	Key   string
	Label string
	// Type is text, number, currency, date, datetime, boolean or enum.
	Type string
	// SQL is a safe expression (only from this file).
	SQL     string
	Options []string
	// Aggregatable fields may be the target of sum/avg/min/max.
	Aggregatable bool
}

// Dataset is one REPORT_DATASET_DEFS entry.
type Dataset struct {
	Key   string
	Label string
	// From is FROM + JOIN; the main table alias is always t.
	From        string
	BaseWhere   string
	CompanyExpr string
	// OwnerExpr is the owner column for the sales-role restriction ("" = none).
	OwnerExpr string
	// DateField is the main date field for the quick period filter.
	DateField      string
	DefaultColumns []string
	Fields         []Field
}

// Field returns the field with key, or nil.
func (d *Dataset) Field(key string) *Field {
	for i := range d.Fields {
		if d.Fields[i].Key == key {
			return &d.Fields[i]
		}
	}
	return nil
}

// Enum values follow the database CHECK constraints (Indonesian).
var (
	orgTypes    = []string{"corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"}
	leadSources = []string{"wa", "instagram", "referral", "google", "pameran", "canvassing", "lainnya"}
)

const ownerJoin = "LEFT JOIN configuration.users ou ON ou.id = t.owner_user_id"

var registry = map[string]*Dataset{
	"lead": {
		Key:   "lead",
		Label: "Lead",
		From: `crm.crm_sales_leads t
      ` + ownerJoin + `
      LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id`,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "t.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"org_name", "status", "temperature", "source", "score", "owner_name", "created_at"},
		Fields: []Field{
			{Key: "org_name", Label: "Instansi", Type: "text", SQL: "t.org_name"},
			{Key: "org_type", Label: "Tipe Instansi", Type: "enum", SQL: "t.org_type", Options: orgTypes},
			{Key: "pic_name", Label: "Nama PIC", Type: "text", SQL: "t.pic_name"},
			{Key: "pic_phone", Label: "Telepon PIC", Type: "text", SQL: "t.pic_phone"},
			{Key: "pic_email", Label: "Email PIC", Type: "text", SQL: "t.pic_email"},
			{Key: "city", Label: "Kota", Type: "text", SQL: "t.city"},
			{Key: "source", Label: "Sumber", Type: "enum", SQL: "t.source", Options: leadSources},
			{Key: "temperature", Label: "Temperatur", Type: "enum", SQL: "t.temperature", Options: []string{"panas", "hangat", "dingin"}},
			{Key: "status", Label: "Status", Type: "enum", SQL: "t.status", Options: []string{"baru", "dihubungi", "qualified", "tidak-cocok"}},
			{Key: "score", Label: "Skor", Type: "number", SQL: "t.score", Aggregatable: true},
			{Key: "account_name", Label: "Account", Type: "text", SQL: "ac.name"},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "utm_source", Label: "UTM Source", Type: "text", SQL: "t.utm_source"},
			{Key: "utm_medium", Label: "UTM Medium", Type: "text", SQL: "t.utm_medium"},
			{Key: "utm_campaign", Label: "UTM Campaign", Type: "text", SQL: "t.utm_campaign"},
			{Key: "utm_content", Label: "UTM Content", Type: "text", SQL: "t.utm_content"},
			{Key: "utm_term", Label: "UTM Term", Type: "text", SQL: "t.utm_term"},
			{Key: "landing_page", Label: "Halaman Masuk", Type: "text", SQL: "t.landing_page"},
			{Key: "referrer", Label: "Referrer", Type: "text", SQL: "t.referrer"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
			{Key: "updated_at", Label: "Diperbarui", Type: "datetime", SQL: "t.updated_at"},
		},
	},
	"deal": {
		Key:   "deal",
		Label: "Deal",
		From: `crm.crm_sales_deals t
      ` + ownerJoin + `
      JOIN crm.crm_sales_leads l ON l.id = t.lead_id
      JOIN crm.crm_sales_stages s ON s.id = t.stage_id
      LEFT JOIN crm.crm_pipelines p ON p.id = t.pipeline_id
      LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = t.lost_reason_id`,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "t.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"title", "org_name", "stage_name", "value", "forecast_category", "owner_name", "event_date"},
		Fields: []Field{
			{Key: "title", Label: "Judul Deal", Type: "text", SQL: "t.title"},
			{Key: "org_name", Label: "Instansi", Type: "text", SQL: "l.org_name"},
			{Key: "pipeline_name", Label: "Pipeline", Type: "text", SQL: "p.name"},
			{Key: "stage_name", Label: "Tahap", Type: "text", SQL: "s.name"},
			{Key: "probability", Label: "Probability (%)", Type: "number", SQL: "s.probability", Aggregatable: true},
			{Key: "forecast_category", Label: "Kategori Forecast", Type: "enum", SQL: "t.forecast_category", Options: []string{"pipeline", "best_case", "commit", "closed_won", "closed_lost"}},
			{Key: "event_type", Label: "Jenis Acara", Type: "enum", SQL: "t.event_type", Options: []string{"gathering", "field-trip", "ulang-tahun", "buyout-venue", "lainnya"}},
			{Key: "value", Label: "Nilai Deal", Type: "currency", SQL: "COALESCE(t.value_final, t.value_estimate, 0)", Aggregatable: true},
			{Key: "value_estimate", Label: "Nilai Estimasi", Type: "currency", SQL: "COALESCE(t.value_estimate, 0)", Aggregatable: true},
			{Key: "value_final", Label: "Nilai Final", Type: "currency", SQL: "COALESCE(t.value_final, 0)", Aggregatable: true},
			{Key: "weighted_value", Label: "Nilai Tertimbang", Type: "currency", SQL: "ROUND(COALESCE(t.value_final, t.value_estimate, 0) * COALESCE(s.probability, 0) / 100.0)", Aggregatable: true},
			{Key: "pax_estimate", Label: "Estimasi Pax", Type: "number", SQL: "t.pax_estimate", Aggregatable: true},
			{Key: "is_won", Label: "Menang", Type: "boolean", SQL: "s.is_won"},
			{Key: "is_lost", Label: "Kalah", Type: "boolean", SQL: "s.is_lost"},
			{Key: "lost_reason", Label: "Alasan Kalah", Type: "text", SQL: "lr.name"},
			{Key: "age_days", Label: "Umur Deal (hari)", Type: "number", SQL: "GREATEST(0, (CURRENT_DATE - t.created_at::date))", Aggregatable: true},
			{Key: "days_in_stage", Label: "Hari di Tahap", Type: "number", SQL: "GREATEST(0, (CURRENT_DATE - COALESCE(t.entered_stage_at, t.created_at)::date))", Aggregatable: true},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "lead_source", Label: "Sumber Lead", Type: "enum", SQL: "l.source", Options: leadSources},
			{Key: "utm_source", Label: "UTM Source", Type: "text", SQL: "l.utm_source"},
			{Key: "utm_medium", Label: "UTM Medium", Type: "text", SQL: "l.utm_medium"},
			{Key: "utm_campaign", Label: "UTM Campaign", Type: "text", SQL: "l.utm_campaign"},
			{Key: "event_date", Label: "Tanggal Acara", Type: "date", SQL: "t.event_date"},
			{Key: "closed_at", Label: "Ditutup", Type: "datetime", SQL: "t.closed_at"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
		},
	},
	"quotation": {
		Key:   "quotation",
		Label: "Quotation",
		From: `crm.crm_sales_quotations t
      JOIN crm.crm_sales_deals d ON d.id = t.deal_id
      JOIN crm.crm_sales_leads l ON l.id = d.lead_id
      LEFT JOIN configuration.users ou ON ou.id = d.owner_user_id`,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "d.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"quote_number", "org_name", "status", "total", "discount_percent", "approval_status", "created_at"},
		Fields: []Field{
			{Key: "quote_number", Label: "Nomor", Type: "text", SQL: "t.quote_number"},
			{Key: "deal_title", Label: "Deal", Type: "text", SQL: "d.title"},
			{Key: "org_name", Label: "Instansi", Type: "text", SQL: "l.org_name"},
			{Key: "status", Label: "Status", Type: "enum", SQL: "t.status", Options: []string{"draft", "terkirim", "diterima", "ditolak", "superseded"}},
			{Key: "approval_status", Label: "Status Approval", Type: "enum", SQL: "t.approval_status", Options: []string{"none", "pending", "approved", "rejected"}},
			{Key: "version", Label: "Versi", Type: "number", SQL: "t.version", Aggregatable: true},
			{Key: "subtotal", Label: "Subtotal", Type: "currency", SQL: "COALESCE(t.subtotal, 0)", Aggregatable: true},
			{Key: "discount_percent", Label: "Diskon (%)", Type: "number", SQL: "COALESCE(t.discount_percent, 0)", Aggregatable: true},
			{Key: "discount_nominal", Label: "Diskon (Rp)", Type: "currency", SQL: "COALESCE(t.discount_nominal, 0)", Aggregatable: true},
			{Key: "ppn_nominal", Label: "PPN", Type: "currency", SQL: "COALESCE(t.ppn_nominal, 0)", Aggregatable: true},
			{Key: "total", Label: "Total", Type: "currency", SQL: "COALESCE(t.total, 0)", Aggregatable: true},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "valid_until", Label: "Berlaku Sampai", Type: "date", SQL: "t.valid_until"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
		},
	},
	"task": {
		Key:   "task",
		Label: "Task & Aktivitas",
		From: `crm.crm_sales_activities t
      ` + ownerJoin + `
      LEFT JOIN crm.crm_sales_leads l ON l.id = t.lead_id
      LEFT JOIN crm.crm_sales_deals d ON d.id = t.deal_id`,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "t.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"title", "activity_type", "status", "priority", "owner_name", "due_at"},
		Fields: []Field{
			{Key: "title", Label: "Judul", Type: "text", SQL: "COALESCE(t.title, t.notes)"},
			{Key: "activity_type", Label: "Jenis", Type: "enum", SQL: "t.activity_type", Options: []string{"telepon", "wa", "meeting", "catatan", "tugas", "email"}},
			{Key: "status", Label: "Status", Type: "enum", SQL: "t.status", Options: []string{"open", "in_progress", "done", "cancelled"}},
			{Key: "priority", Label: "Prioritas", Type: "enum", SQL: "t.priority", Options: []string{"low", "normal", "high", "urgent"}},
			{Key: "subject_type", Label: "Terkait", Type: "enum", SQL: "t.subject_type", Options: []string{"lead", "deal", "account", "contact", "member"}},
			{Key: "org_name", Label: "Instansi", Type: "text", SQL: "l.org_name"},
			{Key: "deal_title", Label: "Deal", Type: "text", SQL: "d.title"},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "is_overdue", Label: "Terlambat", Type: "boolean", SQL: "(t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < now())"},
			{Key: "due_at", Label: "Jatuh Tempo", Type: "datetime", SQL: "t.due_at"},
			{Key: "done_at", Label: "Selesai", Type: "datetime", SQL: "t.done_at"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
		},
	},
	"account": {
		Key:            "account",
		Label:          "Account",
		From:           `crm.crm_accounts t ` + ownerJoin,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "t.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"name", "account_type", "industry", "city", "owner_name", "created_at"},
		Fields: []Field{
			{Key: "name", Label: "Nama Account", Type: "text", SQL: "t.name"},
			{Key: "account_type", Label: "Tipe", Type: "enum", SQL: "t.account_type", Options: orgTypes},
			{Key: "industry", Label: "Industri", Type: "text", SQL: "t.industry"},
			{Key: "city", Label: "Kota", Type: "text", SQL: "t.city"},
			{Key: "phone", Label: "Telepon", Type: "text", SQL: "t.phone"},
			{Key: "email", Label: "Email", Type: "text", SQL: "t.email"},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
		},
	},
	"contact": {
		Key:   "contact",
		Label: "Contact",
		From: `crm.crm_contacts t
      ` + ownerJoin + `
      LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id`,
		BaseWhere:      "t.deleted_at IS NULL",
		CompanyExpr:    "t.company_id",
		OwnerExpr:      "t.owner_user_id",
		DateField:      "created_at",
		DefaultColumns: []string{"name", "title", "account_name", "phone", "email", "created_at"},
		Fields: []Field{
			{Key: "name", Label: "Nama", Type: "text", SQL: "t.name"},
			{Key: "title", Label: "Jabatan", Type: "text", SQL: "t.title"},
			{Key: "account_name", Label: "Account", Type: "text", SQL: "ac.name"},
			{Key: "phone", Label: "Telepon", Type: "text", SQL: "t.phone"},
			{Key: "email", Label: "Email", Type: "text", SQL: "t.email"},
			{Key: "is_primary", Label: "PIC Utama", Type: "boolean", SQL: "t.is_primary"},
			{Key: "owner_name", Label: "Penanggung Jawab", Type: "text", SQL: "ou.full_name"},
			{Key: "created_at", Label: "Dibuat", Type: "datetime", SQL: "t.created_at"},
		},
	},
}

// DatasetDef returns the registry entry for key, or nil.
func DatasetDef(key string) *Dataset { return registry[key] }

// FieldDef mirrors fieldDef: the field of dataset with key, or nil.
func FieldDef(dataset, key string) *Field {
	if ds := registry[dataset]; ds != nil {
		return ds.Field(key)
	}
	return nil
}

// Option is one {key, label} entry of a labelled enum.
type Option struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Labelled enums in schema order.
var (
	FilterOps = []Option{
		{"eq", "sama dengan"}, {"neq", "tidak sama dengan"}, {"in", "salah satu dari"},
		{"not_in", "bukan salah satu dari"}, {"contains", "mengandung"}, {"gt", "lebih dari"},
		{"gte", "minimal"}, {"lt", "kurang dari"}, {"lte", "maksimal"}, {"between", "antara"},
		{"is_empty", "kosong"}, {"not_empty", "terisi"},
	}
	// DatePresets are relative ranges resolved when the report runs, not when it is saved.
	DatePresets = []Option{
		{"all_time", "Semua waktu"}, {"today", "Hari ini"}, {"yesterday", "Kemarin"},
		{"last_7_days", "7 hari terakhir"}, {"last_30_days", "30 hari terakhir"}, {"this_month", "Bulan ini"},
		{"last_month", "Bulan lalu"}, {"this_quarter", "Kuartal ini"}, {"this_year", "Tahun ini"},
		{"last_year", "Tahun lalu"}, {"custom", "Rentang khusus"},
	}
	Aggregations = []Option{
		{"count", "Jumlah baris"}, {"count_distinct", "Jumlah unik"}, {"sum", "Total"},
		{"avg", "Rata-rata"}, {"min", "Minimum"}, {"max", "Maksimum"},
	}
	DateBuckets = []Option{
		{"day", "Harian"}, {"week", "Mingguan"}, {"month", "Bulanan"}, {"quarter", "Kuartalan"}, {"year", "Tahunan"},
	}
	ChartTypes = []Option{
		{"table", "Tabel"}, {"bar", "Batang (horizontal)"}, {"column", "Batang (vertikal)"},
		{"line", "Garis"}, {"area", "Area"}, {"pie", "Pie"}, {"donut", "Donut"},
	}
)

// Keys returns the option keys (the zod enum values).
func Keys(opts []Option) []string {
	out := make([]string, len(opts))
	for i, o := range opts {
		out[i] = o.Key
	}
	return out
}

// LabelOf returns the label of key in opts ("" when missing).
func LabelOf(opts []Option, key string) string {
	for _, o := range opts {
		if o.Key == key {
			return o.Label
		}
	}
	return ""
}
