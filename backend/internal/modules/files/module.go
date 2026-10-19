// Package files serves the shared upload tree at GET
// /api/files/{bucket}/{path...}: port of
// frontend/src/app/api/files/[bucket]/[...path]/route.ts. Public buckets
// are anonymous, member-photos/<customer id>/... is readable by that member
// or staff, and every other bucket needs a staff session.
package files

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
)

// Name is the MODULES key.
const Name = "files"

const routePrefix = "/api/files/"

type mod struct {
	auth  *auth.Service
	store *storage.Store
}

func (mod) Name() string { return Name }

func (m mod) Routes() []module.Route {
	return []module.Route{{Pattern: "GET " + routePrefix + "{bucket}/{path...}", Handler: http.HandlerFunc(m.serve)}}
}

// New builds the module on the storage directory shared with Next.
func New(deps module.Deps) module.Module { return mod{auth: deps.Auth, store: storage.FromEnv()} }

func (m mod) serve(w http.ResponseWriter, r *http.Request) {
	bucket, segments, ok := routeParams(r.URL.EscapedPath())
	if !ok {
		notFound(w)
		return
	}
	abs, ok := m.store.UploadFile(bucket, segments)
	if !ok {
		notFound(w)
		return
	}
	// UploadFile accepted both, so neither is nil.
	access := storage.BucketAccess(storage.SafeSegments([]string{bucket})[0])
	if !m.canRead(r, access, storage.SafeSegments(segments)) {
		_ = httpx.JSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	if err := storage.ServeUpload(w, r, abs, access == storage.AccessPublic); err != nil {
		notFound(w)
	}
}

// canRead is the route's canRead: a member reads member-photos/<own
// customer id>/...; staff read every bucket. Lookup errors count as no
// session, as the TS .catch(() => null) does.
func (m mod) canRead(r *http.Request, access storage.Access, safe []string) bool {
	if access == storage.AccessPublic {
		return true
	}
	if access == storage.AccessMemberOwned && len(safe) > 1 {
		if member, err := m.auth.MemberSessionFromRequest(r); err == nil && member != nil && safe[0] == member.CustomerID {
			return true
		}
	}
	user, err := m.auth.CurrentUser(r)
	return err == nil && user != nil
}

// routeParams decodes each segment after /api/files/ once, as Next does
// for [bucket] and [...path], so an encoded "/" stays inside its segment
// for SafeSegments to reject.
func routeParams(escapedPath string) (string, []string, bool) {
	raw := strings.Split(strings.TrimPrefix(escapedPath, routePrefix), "/")
	if len(raw) < 2 {
		return "", nil, false
	}
	decoded := make([]string, len(raw))
	for i, seg := range raw {
		d, err := storage.DecodeURIComponent(seg)
		if err != nil {
			return "", nil, false
		}
		decoded[i] = d
	}
	return decoded[0], decoded[1:], true
}

func notFound(w http.ResponseWriter) {
	_ = httpx.JSON(w, http.StatusNotFound, map[string]string{"error": "File not found"})
}
