package kit

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// OK writes successResponse(data[, message]): {"success":true,"data":...[,"message":...]}.
func OK(w http.ResponseWriter, data any, message ...string) error {
	msg := ""
	if len(message) > 0 {
		msg = message[0]
	}
	return httpx.DataMessage(w, http.StatusOK, data, msg)
}

// Created writes createdResponse(data, message) with status 201.
func Created(w http.ResponseWriter, data any, message string) error {
	return httpx.DataMessage(w, http.StatusCreated, data, message)
}

// NoContent writes noContentResponse(): 204 without a body.
func NoContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// Success writes {"success":true}.
func Success(w http.ResponseWriter) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
	}{true})
}

// SuccessMessage writes {"success":true,"message":msg}, or {"success":true}
// when msg is empty.
func SuccessMessage(w http.ResponseWriter, msg string) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Message string `json:"message,omitempty"`
	}{true, msg})
}

// Meta is the {schemaReady} block several CRM reads add.
type Meta struct {
	SchemaReady bool `json:"schemaReady"`
}

// WithMeta writes {"success":true,"data":data,"meta":{"schemaReady":ready}}.
func WithMeta(w http.ResponseWriter, data any, ready bool) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
		Data    any  `json:"data"`
		Meta    Meta `json:"meta"`
	}{true, data, Meta{ready}})
}

// ErrInvalidJSON is what `await request.json()` throws on a malformed body:
// apiHandler renders it as a 500.
var ErrInvalidJSON = errors.New("crm: request body is not valid JSON")

// ReadJSON mirrors `await request.json()`: a missing or malformed body is
// ErrInvalidJSON (500). Numbers decode as json.Number for validate.
func ReadJSON(r *http.Request) (any, error) {
	v, ok := validate.ReadBody(r)
	if !ok {
		return nil, ErrInvalidJSON
	}
	return v, nil
}

// Form reads the body like `await request.json()` and starts a validate.Form.
func Form(r *http.Request) (*validate.Form, error) {
	v, err := ReadJSON(r)
	if err != nil {
		return nil, err
	}
	return validate.New(v, true), nil
}

// CrmInputErr mirrors parseCrmInput: 400 with the first custom (refine)
// message, else "Data tidak valid", and the issues as details.
func CrmInputErr(f *validate.Form) error {
	if f.Valid() {
		return nil
	}
	msg := "Data tidak valid"
	for _, is := range f.Issues() {
		if is.Code == "custom" {
			msg = is.Message
			break
		}
	}
	return httpx.BadRequest(msg, f.Issues())
}

// IsMissingCrmSchema mirrors isMissingCrmSchema: undefined table or column.
func IsMissingCrmSchema(err error) bool {
	code := database.PgCode(err)
	return code == "42P01" || code == "42703"
}

// CrmSchemaError mirrors crmSchemaError: a missing CRM table is 409
// "CRM migration belum diterapkan"; anything else passes through.
func CrmSchemaError(err error) error {
	if IsMissingCrmSchema(err) {
		return httpx.Conflict("CRM migration belum diterapkan")
	}
	return err
}

// RawBody reads the request body as text (request.text()).
func RawBody(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, nil
	}
	return io.ReadAll(io.LimitReader(r.Body, 10<<20))
}

// DecodeLoose unmarshals JSON keeping numbers as json.Number.
func DecodeLoose(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return v, nil
}
