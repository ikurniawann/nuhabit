// Package auth resolves the caller of a request: staff sessions (cookie or
// Open API Bearer token) with IAM menu guards, the proxy auth gate, and
// member portal sessions. Every query and message mirrors the TS helpers in
// frontend/src/lib/auth, frontend/src/lib/api/auth.ts, frontend/src/lib/iam
// and frontend/src/lib/member-portal.
package auth

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// User mirrors ApiUser (id, full_name, role, brand_id) plus the session
// email, the configuration.users scope columns and the API token marker.
type User struct {
	ID        string
	Email     string
	Role      string
	FullName  string
	BrandID   *string
	CompanyID *string
	BranchID  *string
	// ViaAPIToken is app_metadata.auth_via === "api_token" in TS: the request
	// authenticated with a Bearer Open API token rather than a person.
	ViaAPIToken bool
	APITokenID  string
	APIScopes   []string
}

// Service resolves callers against the database.
type Service struct {
	db  *pgxpool.Pool
	log *slog.Logger
	now func() time.Time
	// databaseURL feeds the member OTP dev-bypass local-host check.
	databaseURL string
	production  bool
}

// Options are the environment facts the member dev bypass needs.
type Options struct {
	DatabaseURL string
	Production  bool
}

// NewService builds the auth service. log and now may be nil.
func NewService(db *pgxpool.Pool, log *slog.Logger, now func() time.Time, opts ...Options) *Service {
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	s := &Service{db: db, log: log, now: now}
	if len(opts) > 0 {
		s.databaseURL = opts[0].DatabaseURL
		s.production = opts[0].Production
	}
	return s
}

// CurrentUser mirrors getApiUser: nil (no error) when there is no session or
// no configuration.users profile row.
func (s *Service) CurrentUser(r *http.Request) (*User, error) {
	su, err := s.sessionUserFromRequest(r)
	if err != nil || su == nil {
		return nil, err
	}
	u := &User{
		ID:          su.ID,
		Email:       su.Email,
		ViaAPIToken: su.ViaAPIToken,
		APITokenID:  su.APITokenID,
		APIScopes:   su.APIScopes,
	}
	// The TS profile read goes through the query builder shim, which turns a
	// query failure into "no profile". Mirror that: any error is a 401.
	err = s.db.QueryRow(r.Context(),
		`SELECT full_name, role, brand_id::text, company_id::text, branch_id::text FROM users WHERE id = $1`, su.ID).
		Scan(&u.FullName, &u.Role, &u.BrandID, &u.CompanyID, &u.BranchID)
	if err != nil {
		if !isNoRows(err) {
			s.log.WarnContext(r.Context(), "auth: profile lookup failed", "user_id", su.ID, "error", err)
		}
		return nil, nil
	}
	return u, nil
}

// RequireUser mirrors requireApiUser: 401 "Authentication required".
func (s *Service) RequireUser(r *http.Request) (*User, error) {
	u, err := s.CurrentUser(r)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, httpx.Unauthorized("Authentication required")
	}
	return u, nil
}

// RequireMenuPrefix mirrors requireIamMenuPrefix: some granted menu code
// equals or sits below one of the prefixes, else 403.
func (s *Service) RequireMenuPrefix(r *http.Request, prefixes ...string) (*User, error) {
	u, err := s.RequireUser(r)
	if err != nil {
		return nil, err
	}
	granted, err := s.GrantedMenuCodes(r.Context(), u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	if !iam.HasAnyMenuPrefix(granted, prefixes) {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return u, nil
}

// RequireMenu mirrors requireIamMenu: one of the exact codes is granted.
func (s *Service) RequireMenu(r *http.Request, codes ...string) (*User, error) {
	u, err := s.RequireUser(r)
	if err != nil {
		return nil, err
	}
	granted, err := s.GrantedMenuCodes(r.Context(), u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	for _, code := range codes {
		if iam.HasMenuCode(granted, code) {
			return u, nil
		}
	}
	return nil, httpx.Forbidden("Insufficient permissions")
}

// RequireMenuAction mirrors requireIamAction: a menu under the prefixes
// grants the action (create/update/delete/approve).
func (s *Service) RequireMenuAction(r *http.Request, action string, prefixes ...string) (*User, error) {
	u, err := s.RequireUser(r)
	if err != nil {
		return nil, err
	}
	roleIDs, err := s.ResolveRoleIDs(r.Context(), u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	granted, err := s.GrantedMenuActions(r.Context(), roleIDs)
	if err != nil {
		return nil, err
	}
	if !iam.HasGrantedAction(granted, prefixes, action) {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return u, nil
}

// HasMenuPrefix mirrors userHasIamPrefix, for routes that branch on a grant
// instead of rejecting.
func (s *Service) HasMenuPrefix(ctx context.Context, u *User, prefixes ...string) (bool, error) {
	granted, err := s.GrantedMenuCodes(ctx, u.ID, u.Role)
	if err != nil {
		return false, err
	}
	return iam.HasAnyMenuPrefix(granted, prefixes), nil
}

// HasMenuAction mirrors userHasIamAction.
func (s *Service) HasMenuAction(ctx context.Context, u *User, action string, prefixes ...string) (bool, error) {
	roleIDs, err := s.ResolveRoleIDs(ctx, u.ID, u.Role)
	if err != nil {
		return false, err
	}
	granted, err := s.GrantedMenuActions(ctx, roleIDs)
	if err != nil {
		return false, err
	}
	return iam.HasGrantedAction(granted, prefixes, action), nil
}

func isNoRows(err error) bool { return database.IsNoRows(err) }
