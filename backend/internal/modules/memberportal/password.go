package memberportal

import (
	"context"
	"errors"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/featureflags"
)

var (
	errLoginInvalid        = fail(401, domain.LoginInvalidMessage)
	errLoginNoPassword     = fail(403, domain.LoginNoPasswordMessage)
	errLoginTooManyAccount = fail(429, domain.LoginTooManyForAccount)
	errLoginTooManyFromIP  = fail(429, domain.LoginTooManyFromNetwork)
	errResetUnavailable    = fail(503, "Password reset by WhatsApp code is not available right now. Ask the front desk to set a new password.")
	errResetCodeInvalid    = &failure{Status: 400, Message: "Incorrect or expired code. Request a new one.", Field: "code"}
	errResetTooManyTries   = &failure{Status: 429, Message: "Too many attempts. Request a new code.", Field: "code"}
)

// Login opens a session for a username (WhatsApp number or email) and
// password. Unknown accounts and wrong passwords share one answer, and
// bcrypt runs against a dummy hash when no account matches, so timing
// does not tell them apart either.
func (s *Service) Login(ctx context.Context, ip, username, password string) (*SignedIn, error) {
	if err := s.ipBrake(ctx, "login", ip); err != nil {
		return nil, err
	}
	if len(username) < 3 {
		return nil, &failure{Status: 400, Message: "Username is required", Field: "username"}
	}
	if password == "" {
		return nil, &failure{Status: 400, Message: "Password is required", Field: "password"}
	}
	allowed, _, err := s.limits.Sliding(ctx, "member-login-account:"+domain.LoginKey(username),
		domain.LoginAccountRule.Limit, domain.LoginAccountRule.Window, s.now())
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errLoginTooManyAccount
	}
	digits, email := domain.LoginLookup(username)
	account, err := s.repo.FindLoginAccount(ctx, digits, email)
	if err != nil {
		return nil, err
	}
	hash := domain.DummyPasswordHash
	if account != nil && account.PasswordHash != nil {
		hash = *account.PasswordHash
	}
	ok := auth.VerifyPassword(password, hash)
	switch {
	case account == nil:
		return nil, errLoginInvalid
	case account.PasswordHash == nil:
		return nil, errLoginNoPassword
	case !ok:
		return nil, errLoginInvalid
	}
	token, err := s.createSession(ctx, account.ID)
	if err != nil {
		return nil, err
	}
	return &SignedIn{Name: account.Name, Token: token}, nil
}

// ChangePassword sets the member's password. The current password is
// required only when the account already has one (OTP-registered members
// set their first password without it). Every other session of the member
// is revoked; the one behind currentToken stays.
func (s *Service) ChangePassword(ctx context.Context, customerID, currentToken string, current *string, next string) error {
	if msg := domain.NewPasswordProblem(next); msg != "" {
		return &failure{Status: 400, Message: msg, Field: "new_password"}
	}
	hash, err := s.repo.PasswordHash(ctx, customerID)
	if err != nil {
		return err
	}
	if hash != nil {
		if current == nil || *current == "" {
			return &failure{Status: 400, Message: "Current password is required", Field: "current_password"}
		}
		if !auth.VerifyPassword(*current, *hash) {
			return &failure{Status: 401, Message: "Current password is incorrect", Field: "current_password"}
		}
	}
	return s.setPassword(ctx, customerID, next, domain.HashSecret(currentToken))
}

// setPassword stores the hash and ends the member's other sessions.
func (s *Service) setPassword(ctx context.Context, customerID, password, keepTokenHash string) error {
	newHash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	if err := s.repo.SetPasswordHash(ctx, customerID, newHash); err != nil {
		return err
	}
	return s.repo.DeleteOtherSessions(ctx, customerID, keepTokenHash)
}

// ForgotResult is the answer of a forgot-password request.
type ForgotResult struct {
	Status      string `json:"status"`
	PhoneMasked string `json:"phone_masked,omitempty"`
}

// ForgotPassword sends a reset code to the account's WhatsApp number when
// OTP is enabled, else tells the member to ask the front desk. The answer
// never says whether the username exists: an unknown one gets the same
// otp_sent status and nothing is sent.
func (s *Service) ForgotPassword(ctx context.Context, ip, username string) (*ForgotResult, error) {
	if !featureflags.OTPEnabled() {
		return &ForgotResult{Status: "front_desk"}, nil
	}
	if err := s.ipBrake(ctx, "otp", ip); err != nil {
		return nil, err
	}
	if len(username) < 3 {
		return nil, &failure{Status: 400, Message: "Username is required", Field: "username"}
	}
	digits, email := domain.LoginLookup(username)
	account, err := s.repo.FindLoginAccount(ctx, digits, email)
	if err != nil {
		return nil, err
	}
	phone := digits
	if account != nil {
		phone = domain.NormalizePhoneDigits(account.Phone)
		if phone != "" {
			if _, err := s.issueOTP(ctx, phone); err != nil {
				return nil, err
			}
		}
	}
	return &ForgotResult{Status: "otp_sent", PhoneMasked: domain.MaskPhone(phone)}, nil
}

// ResetPassword consumes the code sent by ForgotPassword and sets the new
// password, ending every session of the member. A username without an
// account fails like a wrong code.
func (s *Service) ResetPassword(ctx context.Context, ip, username, code, next string) error {
	if !featureflags.OTPEnabled() {
		return errResetUnavailable
	}
	if msg := domain.NewPasswordProblem(next); msg != "" {
		return &failure{Status: 400, Message: msg, Field: "new_password"}
	}
	if !domain.IsOTPCode(code) {
		return &failure{Status: 400, Message: "Enter the 6-digit code", Field: "code"}
	}
	if err := s.ipBrake(ctx, "verify", ip); err != nil {
		return err
	}
	digits, email := domain.LoginLookup(username)
	account, err := s.repo.FindLoginAccount(ctx, digits, email)
	if err != nil {
		return err
	}
	phone := digits
	if account != nil {
		phone = domain.NormalizePhoneDigits(account.Phone)
	}
	switch err := consumeOTP(ctx, s.repo, phone, code, s.now()); {
	case err == nil:
	case errors.Is(err, errOTPTooManyTries):
		return errResetTooManyTries
	case errors.Is(err, errOTPExpired), errors.Is(err, errOTPWrongCode):
		return errResetCodeInvalid
	default:
		return err
	}
	if account == nil {
		return errResetCodeInvalid
	}
	return s.setPassword(ctx, account.ID, next, "")
}
