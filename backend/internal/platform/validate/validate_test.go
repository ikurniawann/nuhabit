package validate

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/httpx"
)

func form(t *testing.T, body string) *Form {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return New(v, true)
}

func TestFieldsInSchemaOrder(t *testing.T) {
	f := form(t, `{"name":"  ","qty":1.5,"kind":"x","spec":{"distanceM":-1}}`)
	f.Str("name", Rule{}, StrOpts{Trim: true, Min: 1})
	f.Int("qty", Rule{}, NumOpts{})
	f.Enum("kind", Rule{}, []string{"run", "row"})
	f.Child("spec").Num("distanceM", Rule{}, NumOpts{Min: Bound(0)})
	f.UUID("id", Rule{Optional: true})

	got := []string{}
	for _, is := range f.Issues() {
		got = append(got, is.Code+" "+is.Message)
	}
	want := []string{
		"too_small Too small: expected string to have >=1 characters",
		"invalid_type Invalid input: expected int, received number",
		`invalid_value Invalid option: expected one of "run"|"row"`,
		"too_small Too small: expected number to be >=0",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("issues = %q", got)
	}
	if p := f.Issues()[3].Path; !reflect.DeepEqual(p, []any{"spec", "distanceM"}) {
		t.Fatalf("nested path = %v", p)
	}
}

func TestErrShapes(t *testing.T) {
	f := form(t, `{"items":[{"sku":""}]}`)
	f.List("items", Rule{}, 10, func(items *Form, i int, v any) {
		items.Item(i, v).Str("sku", Rule{}, StrOpts{Min: 1})
	})
	var he *httpx.Error
	if err := f.ErrAtPath("Data tidak valid"); !errors.As(err, &he) || he.Status != 400 || he.Message != "Data tidak valid: items.0.sku" {
		t.Fatalf("ErrAtPath = %v", err)
	}
	if err := f.Err("Validation failed"); !errors.As(err, &he) || he.Message != "Validation failed" {
		t.Fatalf("Err = %v", err)
	}
	if err := form(t, `{}`).Err("Validation failed"); err != nil {
		t.Fatalf("empty schema should pass, got %v", err)
	}
}

func TestMissingBodyAndNulls(t *testing.T) {
	f := New(nil, false)
	if f.Valid() || f.Issues()[0].Message != "Invalid input: expected object, received undefined" {
		t.Fatalf("missing body issues = %v", f.Issues())
	}
	g := form(t, `{"note":null,"tag":null}`)
	if g.Str("note", Rule{Nullable: true}, StrOpts{}) != nil || !g.Valid() {
		t.Fatal("nullable null should pass as nil")
	}
	g.Str("tag", Rule{Optional: true}, StrOpts{})
	if g.Valid() || g.Issues()[0].Message != "Invalid input: expected string, received null" {
		t.Fatalf("optional rejects null: %v", g.Issues())
	}
	if g.StrDefault("missing", "def", StrOpts{}) != "def" || g.BoolDefault("flag", true) != true {
		t.Fatal("defaults")
	}
}

func TestJSStringRules(t *testing.T) {
	if UTF16Len("😀") != 2 {
		t.Fatal("emoji counts as two UTF-16 units, like JS length")
	}
	if JSTrim("\uFEFF a \u00a0") != "a" {
		t.Fatal("JSTrim drops the BOM and NBSP")
	}
	if !ValidURL("mailto:x@y.z") || ValidURL("https://") || ValidURL("no-scheme") {
		t.Fatal("ValidURL follows new URL()")
	}
	if !IsUUID("00000000-0000-0000-0000-000000000000") || IsUUID("123") {
		t.Fatal("IsUUID")
	}
}
