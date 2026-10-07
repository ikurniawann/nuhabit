package kit

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
)

// JSJSON rewrites JSON text the way JSON.stringify(JSON.parse(text)) would:
// key order kept, numbers in their JS form (jsonb prints 1.50, JS 1.5). The
// input is returned unchanged when it does not parse.
func JSJSON(raw []byte) json.RawMessage {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var out bytes.Buffer
	if err := reencode(dec, &out); err != nil {
		return json.RawMessage(raw)
	}
	return json.RawMessage(out.Bytes())
}

func reencode(dec *json.Decoder, out *bytes.Buffer) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '[' {
			out.WriteByte('[')
			for i := 0; dec.More(); i++ {
				if i > 0 {
					out.WriteByte(',')
				}
				if err := reencode(dec, out); err != nil {
					return err
				}
			}
			out.WriteByte(']')
			_, err := dec.Token()
			return err
		}
		// JS objects list array-index keys first, ascending, then the rest in
		// insertion order.
		type member struct {
			key   string
			index int64
			value []byte
		}
		var indexed, named []member
		for dec.More() {
			key, err := dec.Token()
			if err != nil {
				return err
			}
			var v bytes.Buffer
			if err := reencode(dec, &v); err != nil {
				return err
			}
			m := member{key: key.(string), value: v.Bytes()}
			if n, ok := arrayIndex(m.key); ok {
				m.index = n
				indexed = append(indexed, m)
			} else {
				named = append(named, m)
			}
		}
		if _, err := dec.Token(); err != nil {
			return err
		}
		sort.SliceStable(indexed, func(i, j int) bool { return indexed[i].index < indexed[j].index })
		out.WriteByte('{')
		for i, m := range append(indexed, named...) {
			if i > 0 {
				out.WriteByte(',')
			}
			kb, _ := MarshalNoEscape(m.key)
			out.Write(kb)
			out.WriteByte(':')
			out.Write(m.value)
		}
		out.WriteByte('}')
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil {
			return err
		}
		b, err := json.Marshal(f)
		if err != nil {
			return err
		}
		out.Write(b)
	default:
		b, err := MarshalNoEscape(t)
		if err != nil {
			return err
		}
		out.Write(b)
	}
	return nil
}

// arrayIndex reports whether key is a canonical array index (0 .. 2^32-2).
func arrayIndex(key string) (int64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseInt(key, 10, 64)
	if err != nil || n < 0 || n > 4294967294 || strconv.FormatInt(n, 10) != key {
		return 0, false
	}
	return n, true
}
