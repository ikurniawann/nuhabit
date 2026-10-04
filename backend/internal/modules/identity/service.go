// Package identity serves the signed-in staff identity (GET /api/auth/me).
// Sessions and IAM live in platform/auth; this module only reads the
// configuration.users profile.
package identity

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

// Profile is the configuration.users row the route returns.
type Profile struct {
	ID       string
	FullName *string
	Role     *string
	BrandID  *string
}

// Repository reads profiles.
type Repository interface {
	// Profile returns nil, nil when the user has no configuration.users row.
	Profile(ctx context.Context, userID string) (*Profile, error)
}

// Sessions resolves the session behind a request.
type Sessions interface {
	Session(r *http.Request) (*auth.SessionUser, error)
}

// Service holds the use cases.
type Service struct {
	repo     Repository
	sessions Sessions
}

// NewService wires the use cases.
func NewService(repo Repository, sessions Sessions) *Service {
	return &Service{repo: repo, sessions: sessions}
}

// Me is the response data of GET /api/auth/me, in the TS key order
// ({...profile, id, email}).
type Me struct {
	ID       string  `json:"id"`
	FullName *string `json:"full_name"`
	Role     *string `json:"role"`
	BrandID  *string `json:"brand_id"`
	Email    string  `json:"email"`
}

// Me mirrors frontend/src/app/api/auth/me/route.ts: a session without a
// configuration.users row counts as signed out (401 "Not authenticated").
func (s *Service) Me(r *http.Request) (*Me, error) {
	user, err := s.sessions.Session(r)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, httpx.Unauthorized("Not authenticated")
	}
	p, err := s.repo.Profile(r.Context(), user.ID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, httpx.Unauthorized("Not authenticated")
	}
	return &Me{ID: user.ID, FullName: p.FullName, Role: p.Role, BrandID: p.BrandID, Email: user.Email}, nil
}
