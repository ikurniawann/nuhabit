package domain

import "strings"

// PublicFieldTypes are PUBLIC_FIELD_TYPES.
var PublicFieldTypes = []string{"text", "textarea", "email", "phone", "number", "date", "select", "checkbox"}

// MainFormSlug is the /public page form, which cannot be deleted.
const MainFormSlug = "kontak"

// OptionalText is a z.string().optional().nullable() value: Set is false
// when the key was absent, Value is nil for null.
type OptionalText struct {
	Set   bool
	Value *string
}

// PublicField is publicFieldSchema's output.
type PublicField struct {
	Key         string
	Label       string
	Type        string
	Required    bool
	Placeholder OptionalText
	HelpText    OptionalText
	Options     []string
	Width       int
	// widthBeforeOptions keeps the key order of the one default field that
	// lists width before options.
	widthBeforeOptions bool
}

// MarshalJSON writes the keys in schema order, optional keys only when set.
func (f PublicField) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	put := func(key string, v any) {
		raw, _ := marshal(v)
		if b.Len() > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`"` + key + `":` + string(raw))
	}
	put("key", f.Key)
	put("label", f.Label)
	put("type", f.Type)
	put("required", f.Required)
	if f.Placeholder.Set {
		put("placeholder", f.Placeholder.Value)
	}
	if f.HelpText.Set {
		put("help_text", f.HelpText.Value)
	}
	options := f.Options
	if options == nil {
		options = []string{}
	}
	if f.widthBeforeOptions {
		put("width", f.Width)
		put("options", options)
	} else {
		put("options", options)
		put("width", f.Width)
	}
	return []byte("{" + b.String() + "}"), nil
}

func text(s string) OptionalText { return OptionalText{Set: true, Value: &s} }

var none = OptionalText{Set: true}

// DefaultFormFields is DEFAULT_FORM_FIELDS: what a form shows while its
// stored definition is empty or broken.
var DefaultFormFields = []PublicField{
	{Key: "pic_name", Label: "Nama Anda", Type: "text", Required: true, Placeholder: text("cth. Budi Santoso"), HelpText: none, Options: []string{}, Width: 1},
	{Key: "pic_phone", Label: "Nomor WhatsApp", Type: "phone", Required: true, Placeholder: text("cth. 08123456789"), HelpText: text("Kami menghubungi lewat WhatsApp."), Options: []string{}, Width: 1},
	{Key: "org_name", Label: "Nama instansi / perusahaan", Type: "text", Required: true, Placeholder: text("cth. PT Maju Bersama"), HelpText: none, Options: []string{}, Width: 2},
	{Key: "org_type", Label: "Jenis instansi", Type: "select", Placeholder: none, HelpText: none, Width: 1, widthBeforeOptions: true,
		Options: []string{"corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"}},
	{Key: "city", Label: "Kota", Type: "text", Placeholder: text("cth. Bandung"), HelpText: none, Options: []string{}, Width: 1},
	{Key: "pic_email", Label: "Email", Type: "email", Placeholder: text("nama@perusahaan.com"), HelpText: none, Options: []string{}, Width: 2},
	{Key: "notes", Label: "Kebutuhan Anda", Type: "textarea", Required: true, Placeholder: text("Ceritakan acara atau kebutuhan latihan tim Anda"), HelpText: none, Options: []string{}, Width: 2},
}

// HasContactField is the publicFormSchema refine: a form needs pic_phone or
// pic_email so a lead can be reached.
func HasContactField(keys []string) bool {
	for _, k := range keys {
		if k == "pic_phone" || k == "pic_email" {
			return true
		}
	}
	return false
}

// ContactFieldMessage is the refine's message.
const ContactFieldMessage = "Form wajib punya field pic_phone atau pic_email agar lead bisa dihubungi"
