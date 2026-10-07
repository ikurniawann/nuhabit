package sales

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"nuhabit/backend/internal/modules/possales/domain"
)

// readJSON is `await request.json()`: the decoded body (numbers as
// json.Number) or an error whose message approximates V8's JSON.parse
// message, which several routes leak in their 500 body.
func readJSON(r *http.Request) (any, error) {
	if r.Body == nil {
		return nil, errors.New("Unexpected end of JSON input")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, errors.New("Unexpected end of JSON input")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, errors.New("Unexpected token in JSON")
	}
	if dec.More() {
		return nil, errors.New("Unexpected non-whitespace character after JSON")
	}
	return v, nil
}

// readObj reads an object body; a non-object JSON value reads as {} (the
// routes destructure it), a parse error is returned.
func readObj(r *http.Request) (domain.Obj, error) {
	v, err := readJSON(r)
	if err != nil {
		return nil, err
	}
	m, _ := v.(map[string]any)
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// readObjOrEmpty is `await request.json().catch(() => ({}))`.
func readObjOrEmpty(r *http.Request) domain.Obj {
	o, err := readObj(r)
	if err != nil {
		return domain.Obj{}
	}
	return o
}

// jsonUnmarshalNumber decodes keeping numbers as json.Number.
func jsonUnmarshalNumber(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return dec.Decode(dst)
}
