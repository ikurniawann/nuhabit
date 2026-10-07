package domain

import (
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/xlsx"
)

// lib/sales-funnel/lead-import.ts and lead-spreadsheet.ts.

// LeadImportMaxRows is MAX_ROWS: data rows per import.
const LeadImportMaxRows = 500

// NormalizeLeadHeader is normalizeLeadSpreadsheetHeader. The parsed header
// cells are already trimmed.
var NormalizeLeadHeader = xlsx.HeaderNormalizer(map[string]string{
	"org_name": "nama_instansi", "instansi": "nama_instansi", "company": "nama_instansi",
	"org_type": "jenis_instansi", "jenis": "jenis_instansi",
	"pic_name": "nama_pic", "pic": "nama_pic", "contact_person": "nama_pic",
	"pic_title": "jabatan_pic", "jabatan": "jabatan_pic",
	"pic_phone": "wa_pic", "phone": "wa_pic", "no_wa": "wa_pic", "telepon": "wa_pic",
	"pic_email": "email_pic", "email": "email_pic",
	"city": "kota", "source": "sumber", "temperature": "suhu",
	"notes": "catatan", "keterangan": "catatan",
})

// jsNonSpace is JavaScript's \S.
const jsNonSpace = `[^\t\n\v\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]`

// importEmailRe is EMAIL_RE /^\S+@\S+\.\S+$/.
var importEmailRe = regexp.MustCompile(`^` + jsNonSpace + `+@` + jsNonSpace + `+\.` + jsNonSpace + `+$`)

// LeadImportRow is the lead one spreadsheet row inserts.
type LeadImportRow struct {
	OrgName, OrgType, PicName, PicPhone, Source, Temperature string
	PicTitle, PicEmail, City, Notes                          *string
}

// LeadImportKind classifies a row.
type LeadImportKind string

const (
	LeadRowEmpty   LeadImportKind = "empty"
	LeadRowInvalid LeadImportKind = "invalid"
	LeadRowOK      LeadImportKind = "ok"
)

// LeadImportRowResult is LeadImportRowResult: Message for invalid rows;
// Lead, RawPhone and Warning ("" when none) for ok rows.
type LeadImportRowResult struct {
	Kind     LeadImportKind
	Message  string
	Lead     LeadImportRow
	RawPhone string
	Warning  string
}

// LeadDedupKey is leadDedupKey: organisation (case-insensitive) plus
// WhatsApp number.
func LeadDedupKey(phone, orgName string) string {
	return phone + "|" + strings.ToLower(JSTrim(orgName))
}

// MapLeadImportRow is mapLeadImportRow: one row under normalized headers.
// An invalid email does not fail the row: it is dropped with a warning.
func MapLeadImportRow(headers, cells []string) LeadImportRowResult {
	row := map[string]string{}
	for i, h := range headers {
		row[h] = ""
		if i < len(cells) {
			row[h] = cells[i]
		}
	}
	empty := true
	for _, v := range row {
		if JSTrim(v) != "" {
			empty = false
			break
		}
	}
	if empty {
		return LeadImportRowResult{Kind: LeadRowEmpty}
	}

	orgName, picName, rawPhone := JSTrim(row["nama_instansi"]), JSTrim(row["nama_pic"]), JSTrim(row["wa_pic"])
	if orgName == "" || picName == "" || rawPhone == "" {
		return LeadImportRowResult{Kind: LeadRowInvalid, Message: "Field wajib kosong: nama_instansi / nama_pic / wa_pic"}
	}
	phone := NormalizePhone(rawPhone)
	if !IsValidNormalizedPhone(phone) {
		return LeadImportRowResult{Kind: LeadRowInvalid, Message: "No. WA tidak valid: " + rawPhone}
	}
	res := LeadImportRowResult{Kind: LeadRowOK, RawPhone: rawPhone}
	emailRaw := JSTrim(row["email_pic"])
	var email *string
	if emailRaw != "" && importEmailRe.MatchString(emailRaw) {
		e := SliceUTF16(emailRaw, 150)
		email = &e
	} else if emailRaw != "" {
		res.Warning = "Email diabaikan (tidak valid): " + emailRaw
	}
	res.Lead = LeadImportRow{
		OrgName:     orgName,
		OrgType:     pickEnum(row["jenis_instansi"], LeadOrgTypes, "corporate"),
		PicName:     picName,
		PicTitle:    trimmedOrNil(row["jabatan_pic"]),
		PicPhone:    phone,
		PicEmail:    email,
		City:        trimmedOrNil(row["kota"]),
		Source:      pickEnum(row["sumber"], LeadSources, "lainnya"),
		Temperature: pickEnum(row["suhu"], LeadTemperatures, "hangat"),
		Notes:       trimmedOrNil(row["catatan"]),
	}
	return res
}

func pickEnum(value string, allowed []string, fallback string) string {
	raw := strings.ToLower(JSTrim(value))
	if raw != "" && Contains(allowed, raw) {
		return raw
	}
	return fallback
}

// trimmedOrNil is `value?.trim() || null`.
func trimmedOrNil(value string) *string {
	if s := JSTrim(value); s != "" {
		return &s
	}
	return nil
}
