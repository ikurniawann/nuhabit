package xlsx

import (
	"fmt"
	"strings"
)

// BOM is the UTF-8 byte order mark the CSV exports prepend so Excel reads
// them as UTF-8.
const BOM = "\ufeff"

// CSVCell is csvCell in lib/recruitment/candidate-csv.ts: always quoted,
// quotes doubled, and a value starting with = + - @ tab or CR gets a leading
// apostrophe so a spreadsheet does not run it as a formula. nil is "".
func CSVCell(v any) string {
	text := ""
	if v != nil {
		text = toJSString(v)
	}
	if text != "" && strings.ContainsRune("=+-@\t\r", rune(text[0])) {
		text = "'" + text
	}
	return `"` + strings.ReplaceAll(text, `"`, `""`) + `"`
}

// ToCSV is toCsv: CSVCell joined by commas, rows by "\n" (no BOM).
func ToCSV(rows [][]any) string {
	lines := make([]string, len(rows))
	for i, r := range rows {
		cells := make([]string, len(r))
		for j, v := range r {
			cells[j] = CSVCell(v)
		}
		lines[i] = strings.Join(cells, ",")
	}
	return strings.Join(lines, "\n")
}

// toJSString is String(v) for the values a CSV row holds.
func toJSString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return JSNumber(x)
	case float32:
		return JSNumber(float64(x))
	case fmt.Stringer:
		return x.String()
	}
	return fmt.Sprint(v)
}

// ParseCSVMatrix is parseCsvMatrix in lib/purchasing/import-spreadsheet.ts:
// split on "\n", drop blank lines, commas separate cells unless inside
// quotes, quotes are dropped, cells are trimmed. It does not handle escaped
// quotes or newlines inside quotes, like the TS.
func ParseCSVMatrix(text string) [][]string {
	var out [][]string
	for _, line := range strings.Split(text, "\n") {
		if jsTrim(line) == "" {
			continue
		}
		var row []string
		var cur strings.Builder
		inQuotes := false
		for _, ch := range line {
			switch {
			case ch == '"':
				inQuotes = !inQuotes
			case ch == ',' && !inQuotes:
				row = append(row, jsTrim(cur.String()))
				cur.Reset()
			default:
				cur.WriteRune(ch)
			}
		}
		out = append(out, append(row, jsTrim(cur.String())))
	}
	return out
}

// SpreadsheetMatrix is parseSpreadsheetMatrix: a .csv name is read as UTF-8
// text with ParseCSVMatrix, anything else as .xlsx with ParseMatrix.
func SpreadsheetMatrix(data []byte, fileName string) ([][]string, error) {
	if strings.HasSuffix(strings.ToLower(fileName), ".csv") {
		return ParseCSVMatrix(strings.ToValidUTF8(string(data), "\ufffd")), nil
	}
	return ParseMatrix(data, ReadOptions{})
}

// HeaderNormalizer is createHeaderNormalizer: "Nama Supplier" becomes
// "nama_supplier", then aliases map it to the canonical key.
func HeaderNormalizer(aliases map[string]string) func(string) string {
	return func(header string) string {
		key := whitespaceRuns(strings.ToLower(header))
		if alias, ok := aliases[key]; ok && alias != "" {
			return alias
		}
		return key
	}
}

// whitespaceRuns is s.replace(/\s+/g, "_").
func whitespaceRuns(s string) string {
	var b strings.Builder
	inSpace := false
	for _, r := range s {
		if isJSSpace(r) {
			if !inSpace {
				b.WriteByte('_')
			}
			inSpace = true
			continue
		}
		inSpace = false
		b.WriteRune(r)
	}
	return b.String()
}

func isJSSpace(r rune) bool { return jsTrim(string(r)) == "" }

// ImportRow is one data row keyed by normalized header. RowNumber is the
// row in the file, the header being row 1.
type ImportRow struct {
	RowNumber int
	Data      map[string]string
}

// MatrixToRows is matrixToRows: rows after the header keyed by the
// normalized header; missing cells are "".
func MatrixToRows(matrix [][]string, normalize func(string) string) []ImportRow {
	if len(matrix) == 0 {
		return nil
	}
	headers := make([]string, len(matrix[0]))
	for i, h := range matrix[0] {
		headers[i] = normalize(h)
	}
	out := make([]ImportRow, 0, len(matrix)-1)
	for i, cells := range matrix[1:] {
		data := make(map[string]string, len(headers))
		for j, h := range headers {
			if j < len(cells) {
				data[h] = cells[j]
			} else {
				data[h] = ""
			}
		}
		out = append(out, ImportRow{RowNumber: i + 2, Data: data})
	}
	return out
}

// IsBlankRow reports whether every key is blank in data.
func IsBlankRow(data map[string]string, keys ...string) bool {
	for _, k := range keys {
		if jsTrim(data[k]) != "" {
			return false
		}
	}
	return true
}
