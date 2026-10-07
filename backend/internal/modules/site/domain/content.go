// Package domain holds the public site's content model: the shape of each
// site.content key, its defaults and its validation. No database or HTTP.
package domain

import (
	"maps"
	"slices"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Kind is the type of one content field.
type Kind int

const (
	// Text is a short single-line string.
	Text Kind = iota
	// Long is a paragraph or markdown body.
	Long
	// URL is an absolute http(s) URL or a site-relative path.
	URL
	// Strings is a list of short strings.
	Strings
	// Object is a nested object with Fields.
	Object
	// Objects is a list of objects with Fields.
	Objects
)

// Field describes one key of a content object.
type Field struct {
	Name   string
	Kind   Kind
	Fields []Field // Object and Objects
}

const (
	textMax    = 300
	longMax    = 50000
	urlMax     = 1000
	listMax    = 40
	stringsMax = 60
)

func text(name string) Field  { return Field{Name: name, Kind: Text} }
func long(name string) Field  { return Field{Name: name, Kind: Long} }
func link(name string) Field  { return Field{Name: name, Kind: URL} }
func lines(name string) Field { return Field{Name: name, Kind: Strings} }
func object(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Object, Fields: fields}
}
func objects(name string, fields ...Field) Field {
	return Field{Name: name, Kind: Objects, Fields: fields}
}

// Schemas is the shape of every content key, in the order the editor
// shows the fields.
var Schemas = map[string][]Field{
	"home": {
		object("hero", text("kicker"), text("title"), long("subtitle"), link("video_url"), link("image_url"), text("cta_label")),
		objects("partners", text("name"), link("logo_url")),
		objects("pillars", text("code"), text("title"), long("text")),
		object("mission", long("quote"), text("author")),
		objects("reel", link("image_url"), text("caption")),
	},
	"training": {
		object("intro", text("title"), long("text")),
		objects("class_types", text("name"), text("duration"), long("text")),
		object("block", text("title"), long("text"), objects("phases", text("name"), text("weeks"), long("text"))),
		object("laws", text("title"), lines("items")),
	},
	"space": {
		text("title"),
		long("intro"),
		objects("sections", text("title"), long("text"), link("image_url")),
	},
	"brand": {
		text("title"),
		long("intro"),
		long("story_md"),
		objects("values", text("title"), long("text")),
		link("image_url"),
	},
	"social": {
		link("instagram"), link("tiktok"), link("youtube"), text("whatsapp"), text("email"),
	},
	"legal_privacy": {text("title"), long("body_md")},
	"legal_terms":   {text("title"), long("body_md")},
	"analytics":     {text("gtm_id"), text("meta_pixel_id")},
}

// Keys lists the content keys in a stable order.
func Keys() []string { return slices.Sorted(maps.Keys(Schemas)) }

// IsKey reports whether key is a content key.
func IsKey(key string) bool {
	_, ok := Schemas[key]
	return ok
}

// Defaults is what the public site renders before staff edit a key.
var Defaults = map[string]map[string]any{
	"home": {
		"hero": map[string]any{
			"kicker":    "HYROX training gym",
			"title":     "Latihan yang bikin kamu kuat buat hidup, bukan cuma buat gym.",
			"subtitle":  "Kelas kecil, coach bersertifikat, dan program 8 minggu yang terukur. Mulai dengan sesi percobaan gratis di cabang terdekat.",
			"video_url": "",
			"image_url": "",
			"cta_label": "Coba Gratis",
		},
		"partners": []any{},
		"pillars": []any{
			map[string]any{"code": "STATION", "title": "Station", "text": "Delapan stasiun HYROX: SkiErg, sled push, sled pull, burpee broad jump, rowing, farmer's carry, sandbag lunge, wall ball. Dilatih dengan teknik yang benar sebelum beban naik."},
			map[string]any{"code": "ENGINE", "title": "Engine", "text": "Lari dan kondisi aerobik dibangun bertahap. Kamu tahu zona, pace, dan progresmu setiap minggu."},
			map[string]any{"code": "++", "title": "Komunitas", "text": "Race bareng, recovery bareng, dan kelas yang menunggu kamu datang. Kebiasaan baru lebih mudah kalau tidak sendirian."},
		},
		"mission": map[string]any{
			"quote":  "Kami percaya kebiasaan kecil yang konsisten mengubah tubuh dan hidup. NüHabit ada supaya kamu punya tempat, program, dan orang-orang untuk menjaganya.",
			"author": "Tim NüHabit",
		},
		"reel": []any{},
	},
	"training": {
		"intro": map[string]any{
			"title": "Satu metode, tiga jenis kelas.",
			"text":  "Semua kelas mengikuti blok 8 minggu yang sama, jadi apa pun jadwalmu, progresmu tetap terukur.",
		},
		"class_types": []any{
			map[string]any{"name": "Station", "duration": "60 menit", "text": "Kekuatan dan teknik delapan stasiun HYROX dengan beban yang naik tiap fase."},
			map[string]any{"name": "Engine", "duration": "60 menit", "text": "Interval lari dan mesin kardio untuk membangun kapasitas aerobik."},
			map[string]any{"name": "Race Sim", "duration": "75 menit", "text": "Simulasi race penuh setiap akhir blok. Catat waktu, bandingkan dengan blok sebelumnya."},
		},
		"block": map[string]any{
			"title": "Blok 8 minggu, 4 fase",
			"text":  "Setiap blok dimulai dengan tes awal dan ditutup dengan race simulation.",
			"phases": []any{
				map[string]any{"name": "Fase 1: Fondasi", "weeks": "Minggu 1-2", "text": "Teknik, mobilitas, dan tes awal."},
				map[string]any{"name": "Fase 2: Bangun", "weeks": "Minggu 3-4", "text": "Volume naik, beban stasiun naik bertahap."},
				map[string]any{"name": "Fase 3: Intensitas", "weeks": "Minggu 5-6", "text": "Interval lebih berat, waktu istirahat lebih pendek."},
				map[string]any{"name": "Fase 4: Puncak", "weeks": "Minggu 7-8", "text": "Taper, race simulation, dan evaluasi."},
			},
		},
		"laws": map[string]any{
			"title": "Hukum NüHabit",
			"items": []any{
				"Datang tepat waktu. Pemanasan adalah bagian dari kelas.",
				"Teknik dulu, beban kemudian.",
				"Rapikan alat setelah dipakai.",
				"Semangati orang di sebelahmu.",
				"Istirahat juga latihan. Tidur cukup.",
			},
		},
	},
	"space": {
		"title": "Ruang latihan yang dibangun untuk HYROX.",
		"intro": "Rig, turf lari, area sled, dan ruang recovery dalam satu lantai. Setiap cabang mengikuti standar yang sama.",
		"sections": []any{
			map[string]any{"title": "Rig & stasiun", "text": "Rig modular, SkiErg, rower, sled, dan wall ball target di setiap lane.", "image_url": ""},
			map[string]any{"title": "Turf", "text": "Jalur turf untuk sled push, sled pull, dan farmer's carry.", "image_url": ""},
			map[string]any{"title": "Recovery", "text": "Area mobilitas, foam roller, dan loker dengan shower.", "image_url": ""},
		},
	},
	"brand": {
		"title":    "Cerita kami",
		"intro":    "NüHabit lahir dari satu pertanyaan: kenapa latihan yang bagus jarang bertahan jadi kebiasaan?",
		"story_md": "Kami memulai dari satu ruang kecil dengan satu rig dan segelintir member yang ingin ikut race HYROX pertamanya. Yang kami pelajari sederhana: program yang jelas, coach yang hadir, dan teman latihan yang menunggu membuat orang kembali.\n\nHari ini setiap cabang NüHabit memakai metode yang sama, dan setiap member punya catatan progres yang bisa dibawa ke cabang mana pun.",
		"values": []any{
			map[string]any{"title": "Konsisten", "text": "Kebiasaan menang atas motivasi."},
			map[string]any{"title": "Terukur", "text": "Setiap blok punya angka awal dan akhir."},
			map[string]any{"title": "Bersama", "text": "Latihan jadi lebih ringan kalau ada yang menunggu."},
		},
		"image_url": "",
	},
	"social": {
		"instagram": "https://instagram.com/nuhabit",
		"tiktok":    "",
		"youtube":   "",
		"whatsapp":  "",
		"email":     "halo@nuhabit.id",
	},
	"legal_privacy": {
		"title":   "Kebijakan Privasi",
		"body_md": "NüHabit menyimpan data yang kamu berikan saat mendaftar, memesan kelas, atau berbelanja: nama, nomor telepon, email, dan riwayat transaksi. Data dipakai untuk melayani keanggotaanmu dan tidak dijual ke pihak lain.\n\nKamu dapat meminta salinan atau penghapusan data melalui kontak di halaman ini.",
	},
	"legal_terms": {
		"title":   "Syarat & Ketentuan",
		"body_md": "Dengan membeli paket atau mengikuti kelas di NüHabit, kamu menyetujui aturan gym, kebijakan pembatalan kelas, dan masa berlaku paket yang tercantum saat pembelian.\n\nPaket yang sudah dibeli tidak dapat diuangkan kembali kecuali diatur lain oleh hukum yang berlaku.",
	},
	"analytics": {
		"gtm_id":        "",
		"meta_pixel_id": "",
	},
}

// Default is a fresh copy of the key's defaults (nil for an unknown key).
func Default(key string) map[string]any {
	d, ok := Defaults[key]
	if !ok {
		return nil
	}
	return cloneMap(d)
}

// Merge overlays the stored value on the key's defaults: maps merge key
// by key at every depth, scalars and lists from stored win.
func Merge(key string, stored map[string]any) map[string]any {
	return mergeMaps(Default(key), stored)
}

func mergeMaps(base, over map[string]any) map[string]any {
	if base == nil {
		base = map[string]any{}
	}
	for k, v := range over {
		bm, bok := base[k].(map[string]any)
		vm, vok := v.(map[string]any)
		if bok && vok {
			base[k] = mergeMaps(bm, vm)
			continue
		}
		base[k] = v
	}
	return base
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch x := v.(type) {
		case map[string]any:
			out[k] = cloneMap(x)
		case []any:
			out[k] = cloneList(x)
		default:
			out[k] = v
		}
	}
	return out
}

func cloneList(l []any) []any {
	out := make([]any, len(l))
	for i, v := range l {
		if m, ok := v.(map[string]any); ok {
			out[i] = cloneMap(m)
		} else {
			out[i] = v
		}
	}
	return out
}

// ValidURL accepts an empty value, an absolute http(s) URL or a
// site-relative path.
func ValidURL(s string) bool {
	if s == "" || strings.HasPrefix(s, "/") {
		return !strings.HasPrefix(s, "//")
	}
	return (strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")) && validate.ValidURL(s)
}

var urlCheck = func(s string) (string, string, bool) { return "invalid_format", "URL tidak valid", ValidURL(s) }

// Validate reads the body of one content key from f, recording issues on
// it, and returns the cleaned value: strings trimmed, unknown keys dropped,
// absent fields omitted so Merge fills them from the defaults.
func Validate(key string, f *validate.Form) map[string]any {
	return validateObject(f, Schemas[key])
}

func validateObject(f *validate.Form, fields []Field) map[string]any {
	out := make(map[string]any, len(fields))
	opt := validate.Rule{Optional: true, Nullable: true}
	for _, fd := range fields {
		switch fd.Kind {
		case Text, Long, URL:
			o := validate.StrOpts{Trim: true, Max: textMax}
			switch fd.Kind {
			case Long:
				o.Max = longMax
			case URL:
				o.Max, o.Check = urlMax, urlCheck
			}
			if s := f.Str(fd.Name, opt, o); s != nil {
				out[fd.Name] = *s
			}
		case Strings:
			list := f.Strings(fd.Name, opt, stringsMax, validate.StrOpts{Trim: true, Max: textMax})
			if list == nil {
				continue
			}
			items := make([]any, 0, len(list))
			for _, s := range list {
				if s != "" {
					items = append(items, s)
				}
			}
			out[fd.Name] = items
		case Object:
			if raw, sent := f.Fields()[fd.Name]; sent && raw != nil {
				out[fd.Name] = validateObject(f.Child(fd.Name), fd.Fields)
			}
		case Objects:
			items := []any{}
			if f.List(fd.Name, opt, listMax, func(sub *validate.Form, i int, v any) {
				items = append(items, validateObject(sub.Item(i, v), fd.Fields))
			}) != nil {
				out[fd.Name] = items
			}
		}
	}
	return out
}
