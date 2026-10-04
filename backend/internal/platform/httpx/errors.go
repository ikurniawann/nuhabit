// Package httpx is the transport toolkit shared by every module: a handler
// wrapper that turns returned errors into the TS error envelope, JSON helpers
// and middleware.
package httpx

import (
	"net/http"
)

// Error crosses the transport boundary. Handle renders it as
// {"success":false,"error":Message[,"details":Details]} with Status, the
// shape of ApiError.toResponse() in frontend/src/lib/api/auth.ts.
type Error struct {
	Status  int
	Message string
	Details any
}

func (e *Error) Error() string { return e.Message }

// Status builds an error with an arbitrary status.
func Status(status int, msg string) *Error { return &Error{Status: status, Message: msg} }

// BadRequest is a 400; the optional details are serialized under "details".
func BadRequest(msg string, details ...any) *Error {
	e := &Error{Status: http.StatusBadRequest, Message: msg}
	if len(details) > 0 {
		e.Details = details[0]
	}
	return e
}

// Unauthorized is a 401, default "Authentication required".
func Unauthorized(msg string) *Error {
	return &Error{Status: http.StatusUnauthorized, Message: orDefault(msg, "Authentication required")}
}

// Forbidden is a 403, default "Insufficient permissions".
func Forbidden(msg string) *Error {
	return &Error{Status: http.StatusForbidden, Message: orDefault(msg, "Insufficient permissions")}
}

// NotFound is a 404, default "Resource not found".
func NotFound(msg string) *Error {
	return &Error{Status: http.StatusNotFound, Message: orDefault(msg, "Resource not found")}
}

// Conflict is a 409.
func Conflict(msg string) *Error { return &Error{Status: http.StatusConflict, Message: msg} }

// TooManyRequests is a 429 with the TS default message.
func TooManyRequests(msg string) *Error {
	return &Error{
		Status:  http.StatusTooManyRequests,
		Message: orDefault(msg, "Terlalu banyak permintaan. Silakan coba lagi dalam beberapa saat."),
	}
}

func orDefault(msg, fallback string) string {
	if msg == "" {
		return fallback
	}
	return msg
}

// pgErrors mirrors PG_ERRORS in frontend/src/lib/api/handler.ts.
var pgErrors = map[string]*Error{
	"23505": {Status: http.StatusConflict, Message: "Data sudah ada di sistem"},
	"23503": {Status: http.StatusBadRequest, Message: "Referensi data tidak valid"},
	"23514": {Status: http.StatusBadRequest, Message: "Data tidak memenuhi ketentuan"},
	"23502": {Status: http.StatusBadRequest, Message: "Data wajib diisi"},
	"22P02": {Status: http.StatusBadRequest, Message: "Format data tidak valid"},
}

// internalError is the body every unexpected failure gets.
var internalError = &Error{Status: http.StatusInternalServerError, Message: "Terjadi kesalahan server"}
