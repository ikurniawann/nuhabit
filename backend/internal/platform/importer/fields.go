package importer

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Fields reads one row against a Spec: typed accessors collect every
// problem with the column label, and Err turns them into one Rejection.
type Fields struct {
	row    Row
	cols   map[string]Column
	errs   []string
	failed map[string]bool
}

// Fields starts reading row with the spec's columns.
func (s Spec) Fields(row Row) *Fields {
	cols := make(map[string]Column, len(s.Columns))
	for _, c := range s.Columns {
		cols[c.Key] = c
	}
	return &Fields{row: row, cols: cols, failed: map[string]bool{}}
}

// Raw is the trimmed cell.
func (f *Fields) Raw(key string) string { return f.row.Get(key) }

func (f *Fields) label(key string) string {
	if c, ok := f.cols[key]; ok && c.Label != "" {
		return c.Label
	}
	return key
}

// Fail records a problem with key: "<Label> <msg>".
func (f *Fields) Fail(key, msg string) {
	if f.failed[key] {
		return
	}
	f.failed[key] = true
	f.errs = append(f.errs, f.label(key)+" "+msg)
}

// Err is nil when every accessor succeeded, else one Rejection listing
// the problems.
func (f *Fields) Err() error {
	if len(f.errs) == 0 {
		return nil
	}
	return Reject(strings.Join(f.errs, "; "))
}

// present reports whether the cell holds a value, failing a required one
// that is blank.
func (f *Fields) present(key string) bool {
	if f.Raw(key) != "" {
		return true
	}
	if f.cols[key].Required {
		f.Fail(key, "wajib diisi")
	}
	return false
}

// Text is the cell, at most max characters (0 = unlimited).
func (f *Fields) Text(key string, max int) string {
	if !f.present(key) {
		return ""
	}
	v := f.Raw(key)
	if max > 0 && len([]rune(v)) > max {
		f.Fail(key, fmt.Sprintf("maksimal %d karakter", max))
		return ""
	}
	return v
}

// Int is an integer in [lo, hi]; ok is false when the cell is blank or bad.
func (f *Fields) Int(key string, lo, hi int) (int, bool) {
	if !f.present(key) {
		return 0, false
	}
	n, ok := ParseInt(f.Raw(key))
	if !ok || n < lo || n > hi {
		f.Fail(key, fmt.Sprintf("harus angka bulat antara %d dan %d", lo, hi))
		return 0, false
	}
	return n, true
}

// Money is a non-negative rupiah amount.
func (f *Fields) Money(key string) (float64, bool) {
	if !f.present(key) {
		return 0, false
	}
	n, ok := ParseMoney(f.Raw(key))
	if !ok || n < 0 {
		f.Fail(key, "harus nominal rupiah, misalnya 1500000")
		return 0, false
	}
	return n, true
}

// Bool reads ya/tidak (and the usual spellings); a blank cell is def.
func (f *Fields) Bool(key string, def bool) bool {
	if !f.present(key) {
		return def
	}
	b, ok := ParseBool(f.Raw(key))
	if !ok {
		f.Fail(key, "harus ya atau tidak")
		return def
	}
	return b
}

// Date is a calendar date as YYYY-MM-DD.
func (f *Fields) Date(key string) (string, bool) {
	if !f.present(key) {
		return "", false
	}
	d, ok := ParseDate(f.Raw(key))
	if !ok {
		f.Fail(key, "harus tanggal YYYY-MM-DD")
		return "", false
	}
	return d, true
}

// Clock is a time of day as HH:MM.
func (f *Fields) Clock(key string) (string, bool) {
	if !f.present(key) {
		return "", false
	}
	c, ok := ParseClock(f.Raw(key))
	if !ok {
		f.Fail(key, "harus jam HH:MM")
		return "", false
	}
	return c, true
}

// Weekday is 1 (Monday) to 7 (Sunday) from a number or a day name.
func (f *Fields) Weekday(key string) (int, bool) {
	if !f.present(key) {
		return 0, false
	}
	d, ok := ParseWeekday(f.Raw(key))
	if !ok {
		f.Fail(key, "harus hari (Senin..Minggu atau 1..7)")
		return 0, false
	}
	return d, true
}

// Enum is one of options, compared case-insensitively; it returns the
// option's spelling.
func (f *Fields) Enum(key string, options []string) (string, bool) {
	if !f.present(key) {
		return "", false
	}
	v := f.Raw(key)
	for _, o := range options {
		if strings.EqualFold(o, v) {
			return o, true
		}
	}
	f.Fail(key, "harus salah satu dari: "+strings.Join(options, ", "))
	return "", false
}

// Email is a lowercased address with one @ and a dot after it.
func (f *Fields) Email(key string) (string, bool) {
	if !f.present(key) {
		return "", false
	}
	v := strings.ToLower(f.Raw(key))
	at := strings.Index(v, "@")
	if at < 1 || !strings.Contains(v[at+1:], ".") || strings.ContainsAny(v, " \t") {
		f.Fail(key, "harus alamat email yang valid")
		return "", false
	}
	return v, true
}

// ParseInt reads an integer, allowing a trailing ".0" the way spreadsheets
// render whole numbers.
func ParseInt(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	if i := strings.Index(s, "."); i >= 0 && strings.Trim(s[i+1:], "0") == "" {
		s = s[:i]
	}
	n, err := strconv.Atoi(s)
	return n, err == nil
}

// ParseMoney reads a rupiah amount: "Rp 1.500.000", "1500000", "1.500.000,50"
// and "1,500,000" all parse. When both separators appear the last one is
// the decimal point; a lone separator followed by exactly three digits per
// group is a thousands separator.
func ParseMoney(s string) (float64, bool) {
	s = strings.TrimSpace(strings.ReplaceAll(s, " ", ""))
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(s), "rp."), "rp"))
	s = strings.ReplaceAll(s, " ", "")
	if s == "" {
		return 0, false
	}
	dot, comma := strings.LastIndex(s, "."), strings.LastIndex(s, ",")
	switch {
	case dot >= 0 && comma >= 0:
		if dot > comma {
			s = strings.ReplaceAll(s, ",", "")
		} else {
			s = strings.ReplaceAll(strings.ReplaceAll(s, ".", ""), ",", ".")
		}
	case dot >= 0:
		if thousands(s, ".") {
			s = strings.ReplaceAll(s, ".", "")
		}
	case comma >= 0:
		if thousands(s, ",") {
			s = strings.ReplaceAll(s, ",", "")
		} else {
			s = strings.ReplaceAll(s, ",", ".")
		}
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

// thousands reports whether every group after the first separator has
// exactly three digits.
func thousands(s, sep string) bool {
	parts := strings.Split(s, sep)
	for _, p := range parts[1:] {
		if len(p) != 3 {
			return false
		}
	}
	return true
}

// ParseBool reads the yes/no spellings a spreadsheet is likely to hold.
func ParseBool(s string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "ya", "y", "yes", "true", "1", "aktif", "benar", "x", "v":
		return true, true
	case "tidak", "t", "n", "no", "false", "0", "nonaktif", "non-aktif", "tidak aktif", "salah", "":
		return false, true
	}
	return false, false
}

var dateLayouts = []string{"2006-01-02", "2/1/2006", "02/01/2006", "2-1-2006", "02-01-2006", "2006/01/02"}

// ParseDate reads YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY or the ISO timestamp
// a date cell of an XLSX becomes, and returns YYYY-MM-DD.
func ParseDate(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if len(s) >= 10 && s[4] == '-' && (len(s) == 10 || s[10] == 'T' || s[10] == ' ') {
		if t, err := time.Parse("2006-01-02", s[:10]); err == nil {
			return t.Format("2006-01-02"), true
		}
		return "", false
	}
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02"), true
		}
	}
	return "", false
}

// ParseClock reads "06:30", "6:30", "06.30", "06:30:00", the ISO timestamp
// of an XLSX time cell or its day fraction (0.27 is 06:30), as HH:MM.
func ParseClock(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", false
	}
	if len(s) >= 16 && s[10] == 'T' {
		s = s[11:16]
	}
	// A day fraction has more digits than "HH.MM" ever has.
	if !strings.Contains(s, ":") && len(s) > 5 {
		if n, err := strconv.ParseFloat(s, 64); err == nil && n >= 0 && n < 1 {
			mins := int(math.Round(n * 24 * 60))
			return fmt.Sprintf("%02d:%02d", mins/60, mins%60), true
		}
	}
	s = strings.ReplaceAll(s, ".", ":")
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return "", false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 || len(parts[1]) != 2 {
		return "", false
	}
	return fmt.Sprintf("%02d:%02d", h, m), true
}

var weekdayNames = map[string]int{
	"senin": 1, "selasa": 2, "rabu": 3, "kamis": 4, "jumat": 5, "jum'at": 5, "sabtu": 6, "minggu": 7, "ahad": 7,
	"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7,
	"monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 7,
	"sen": 1, "sel": 2, "rab": 3, "kam": 4, "jum": 5, "sab": 6, "min": 7,
}

// ParseWeekday reads 1..7 (Monday first) or an Indonesian or English day
// name.
func ParseWeekday(s string) (int, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if n, ok := ParseInt(s); ok {
		return n, n >= 1 && n <= 7
	}
	d, ok := weekdayNames[s]
	return d, ok
}

// SplitList splits a cell on ";" or "|" into trimmed, non-empty items.
func SplitList(s string) []string {
	var out []string
	for _, item := range strings.FieldsFunc(s, func(r rune) bool { return r == ';' || r == '|' }) {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// Pair is one "key=value" item of a list cell.
type Pair struct{ Key, Value string }

// ParsePairs reads "DAGO=1200000; SNP=1300000" into pairs; an item without
// "=" fails.
func ParsePairs(s string) ([]Pair, bool) {
	var out []Pair
	for _, item := range SplitList(s) {
		k, v, ok := strings.Cut(item, "=")
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if !ok || k == "" || v == "" {
			return nil, false
		}
		out = append(out, Pair{k, v})
	}
	return out, true
}
