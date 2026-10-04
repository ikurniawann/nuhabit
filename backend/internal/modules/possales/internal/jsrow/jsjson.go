package jsrow

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
)

// NormalizeJSON re-serializes JSON the way JSON.stringify(JSON.parse(raw))
// would: numbers lose trailing zeros and exponents ("15000.00" → 15000,
// "1e3" → 1000), key order and strings stay as they are. node-postgres
// parses json/jsonb columns, so embeds built with row_to_json/json_agg reach
// the TS response in this form.
func NormalizeJSON(raw []byte) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var buf bytes.Buffer
	if err := writeValue(dec, &buf); err != nil {
		return json.RawMessage(append([]byte(nil), raw...))
	}
	return json.RawMessage(buf.Bytes())
}

func writeValue(dec *json.Decoder, buf *bytes.Buffer) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			buf.WriteByte('{')
			first := true
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return err
				}
				if !first {
					buf.WriteByte(',')
				}
				first = false
				kb, _ := Marshal(keyTok.(string))
				buf.Write(kb)
				buf.WriteByte(':')
				if err := writeValue(dec, buf); err != nil {
					return err
				}
			}
			if _, err := dec.Token(); err != nil {
				return err
			}
			buf.WriteByte('}')
		case '[':
			buf.WriteByte('[')
			first := true
			for dec.More() {
				if !first {
					buf.WriteByte(',')
				}
				first = false
				if err := writeValue(dec, buf); err != nil {
					return err
				}
			}
			if _, err := dec.Token(); err != nil {
				return err
			}
			buf.WriteByte(']')
		}
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil || math.IsInf(f, 0) {
			buf.WriteString("null")
			return nil
		}
		buf.WriteString(jsNumber(f))
	case string:
		b, _ := Marshal(t)
		buf.Write(b)
	case bool:
		buf.WriteString(strconv.FormatBool(t))
	case nil:
		buf.WriteString("null")
	}
	return nil
}

// jsNumber formats a float like Number.prototype.toString.
func jsNumber(f float64) string {
	if f == 0 {
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		mant, exp, _ := strings.Cut(s, "e")
		sign, digits := exp[:1], strings.TrimLeft(exp[1:], "0")
		if digits == "" {
			digits = "0"
		}
		return mant + "e" + sign + digits
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// ParseArray parses a JSON array of objects into rows that keep their key
// order; each value is the (normalized) raw JSON of the field.
func ParseArray(raw []byte) ([]*Row, error) {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	out := make([]*Row, 0, len(items))
	for _, item := range items {
		row, err := ParseObject(item)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

// ParseObject parses one JSON object into an ordered row of raw values.
func ParseObject(raw []byte) (*Row, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, errNotObject
	}
	row := New()
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		var val json.RawMessage
		if err := dec.Decode(&val); err != nil {
			return nil, err
		}
		row.Set(keyTok.(string), rawValue(val))
	}
	return row, nil
}

var errNotObject = errors.New("jsrow: not a JSON object")

// rawValue unwraps scalars so Row.Str/Num work, keeping arrays and objects raw.
func rawValue(v json.RawMessage) any {
	var x any
	dec := json.NewDecoder(bytes.NewReader(v))
	dec.UseNumber()
	if err := dec.Decode(&x); err != nil {
		return v
	}
	switch t := x.(type) {
	case nil:
		return nil
	case string:
		return t
	case bool:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	}
	return NormalizeJSON(v)
}
