package auth

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// Granter checks a request against IAM grants: *Service, or a stub in tests.
type Granter interface {
	RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*User, int, error)
}

// StaffFunc is the body of a staff route; user passed the guard.
type StaffFunc func(w http.ResponseWriter, r *http.Request, user *User) error

// Staff guards a route by IAM menu action: any one of grants passes the
// caller to fn; the guard's error (401 or 403) stops everyone else.
func Staff(guard Granter, fn StaffFunc, grants ...iam.Grant) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, _, err := guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		return fn(w, r, user)
	})
}
