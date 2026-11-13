// Package idempotency replays the stored response when a client repeats a
// POST, PUT, PATCH or DELETE with the same Idempotency-Key header, so a
// checkout retried after a timeout does not record the sale twice.
//
// The key is scoped to the caller's session token (staff cookie, member
// cookie or Authorization header) plus the method and URL, and lives in Redis
// for 24 hours. While the first request runs, a repeat answers 409. A repeat
// with a different body answers 422. Only a response under 400 is stored: a
// 4xx or 5xx means nothing was recorded, so a retry with the same key runs
// again (stock may have arrived since). Requests without the header, with a body over 1 MB,
// or on an API without Redis pass through untouched.
package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

// Header is the request header clients set.
const Header = "Idempotency-Key"

const (
	keyTTL     = 24 * time.Hour
	pendingTTL = 3 * time.Minute // longer than the server's 120 s write timeout
	maxBytes   = 1 << 20
	maxKeyLen  = 255
)

var (
	errInProgress = httpx.Conflict("Permintaan yang sama masih diproses, tunggu sebentar lalu muat ulang")
	errReused     = &httpx.Error{Status: http.StatusUnprocessableEntity, Message: "Idempotency-Key sudah dipakai untuk permintaan lain"}
	errBadKey     = httpx.BadRequest("Idempotency-Key maksimal 255 karakter")
)

// record is what Redis holds per key: a pending marker, then the response.
type record struct {
	BodyHash    string `json:"h"`
	Pending     bool   `json:"p,omitempty"`
	Status      int    `json:"s,omitempty"`
	ContentType string `json:"t,omitempty"`
	Body        []byte `json:"b,omitempty"`
}

// Middleware returns the idempotency layer. rdb nil disables it.
func Middleware(rdb *redis.Client, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if rdb == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get(Header)
			if key == "" || !mutating(r.Method) {
				next.ServeHTTP(w, r)
				return
			}
			if len(key) > maxKeyLen {
				httpx.WriteError(w, r, errBadKey)
				return
			}
			body, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
			if err != nil {
				httpx.WriteError(w, r, httpx.BadRequest("Body permintaan tidak terbaca"))
				return
			}
			if len(body) > maxBytes {
				r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(body), r.Body))
				next.ServeHTTP(w, r)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			serve(w, r, next, rdb, log, redisKey(r, key), hashOf(body))
		})
	}
}

func serve(w http.ResponseWriter, r *http.Request, next http.Handler, rdb *redis.Client, log *slog.Logger, rk, bodyHash string) {
	ctx := r.Context()
	pending, _ := json.Marshal(record{BodyHash: bodyHash, Pending: true})
	claimed, err := rdb.SetNX(ctx, rk, pending, pendingTTL).Result()
	if err != nil {
		log.Warn("idempotency: redis unavailable, request runs unguarded", "error", err)
		next.ServeHTTP(w, r)
		return
	}
	if !claimed {
		replay(w, r, rdb, log, rk, bodyHash, next)
		return
	}

	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	defer func() {
		// Store with a context that outlives a client that hung up mid-request.
		store, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if rec.status >= 400 || rec.body.Len() > maxBytes {
			if err := rdb.Del(store, rk).Err(); err != nil {
				log.Warn("idempotency: release key failed", "error", err)
			}
			return
		}
		done, _ := json.Marshal(record{BodyHash: bodyHash, Status: rec.status, ContentType: w.Header().Get("Content-Type"), Body: rec.body.Bytes()})
		if err := rdb.Set(store, rk, done, keyTTL).Err(); err != nil {
			log.Warn("idempotency: store response failed", "error", err)
		}
	}()
	next.ServeHTTP(rec, r)
}

func replay(w http.ResponseWriter, r *http.Request, rdb *redis.Client, log *slog.Logger, rk, bodyHash string, next http.Handler) {
	raw, err := rdb.Get(r.Context(), rk).Bytes()
	if errors.Is(err, redis.Nil) {
		// The first request failed and released the key between
		// our SETNX and GET; a retry is allowed.
		serve(w, r, next, rdb, log, rk, bodyHash)
		return
	}
	var rec record
	if err == nil {
		err = json.Unmarshal(raw, &rec)
	}
	if err != nil {
		log.Warn("idempotency: read stored response failed, request runs unguarded", "error", err)
		next.ServeHTTP(w, r)
		return
	}
	switch {
	case rec.BodyHash != bodyHash:
		httpx.WriteError(w, r, errReused)
	case rec.Pending:
		httpx.WriteError(w, r, errInProgress)
	default:
		if rec.ContentType != "" {
			w.Header().Set("Content-Type", rec.ContentType)
		}
		w.Header().Set("Idempotent-Replayed", "true")
		w.WriteHeader(rec.Status)
		_, _ = w.Write(rec.Body)
	}
}

func mutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// redisKey hashes the caller's credentials, the route and the client key, so
// one caller can never read another caller's stored response.
func redisKey(r *http.Request, key string) string {
	member := ""
	if c, err := r.Cookie(auth.MemberSessionCookie); err == nil {
		member = c.Value
	}
	scope := auth.ReadSessionToken(r) + "\x00" + member + "\x00" + r.Header.Get("Authorization") +
		"\x00" + r.Method + " " + r.URL.RequestURI() + "\x00" + key
	return "idem:" + hashOf([]byte(scope))
}

func hashOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// recorder copies the response body while writing it through.
type recorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        bytes.Buffer
}

func (r *recorder) WriteHeader(status int) {
	if !r.wroteHeader {
		r.status, r.wroteHeader = status, true
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(b []byte) (int, error) {
	r.wroteHeader = true
	if r.body.Len() <= maxBytes {
		r.body.Write(b)
	}
	return r.ResponseWriter.Write(b)
}

func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
