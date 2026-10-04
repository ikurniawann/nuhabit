package memberportal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// MemberRef is the id and name of a member.
type MemberRef struct {
	ID   string
	Name *string
}

// OTPRecord is the newest OTP row of a number.
type OTPRecord struct {
	ID         string
	CodeHash   string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

// Venue is the default company/branch stamped on wallet and XP rows.
type Venue struct {
	CompanyID *string
	BranchID  *string
}

// AuthRepository is the OTP, session and registration storage.
type AuthRepository interface {
	FindMemberByPhone(ctx context.Context, phone string) (*MemberRef, error)
	CountRecentOTP(ctx context.Context, phone string, window time.Duration) (int, error)
	InsertOTP(ctx context.Context, phone, codeHash string, ttl time.Duration) error
	LatestOTP(ctx context.Context, phone string) (*OTPRecord, error)
	ClaimOTPAttempt(ctx context.Context, id string, max int) (bool, error)
	ConsumeOTP(ctx context.Context, id string) (bool, error)
	MarkWAVerified(ctx context.Context, customerID string) error
	CreateSession(ctx context.Context, tokenHash, customerID string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	LockRegistration(ctx context.Context, phoneDigits string) error
	InsertRegisteredMember(ctx context.Context, reg domain.Registration) (*MemberRef, error)
	DefaultVenue(ctx context.Context) Venue
	SetMarketingConsent(ctx context.Context, customerID string, enabled bool, venue Venue) error
	ReadMarketingConsent(ctx context.Context, customerID string) (bool, error)
}

var (
	errOTPExpired       = fail(400, "Kode kedaluwarsa. Minta kode baru")
	errOTPTooManyTries  = fail(429, "Terlalu banyak percobaan. Minta kode baru")
	errOTPWrongCode     = fail(400, "Kode salah")
	errOTPTooManyIssued = fail(429, "Terlalu banyak permintaan. Coba lagi dalam 10 menit")
	errTooManyFromIP    = fail(429, domain.TooManyFromIP)
)

// ipAllowed applies the per-IP brake for kind "otp" or "verify".
func (s *Service) ipAllowed(kind, ip string) bool {
	rule := domain.IPRuleOTP
	if kind == "verify" {
		rule = domain.IPRuleVerify
	}
	return s.ipLimiter.Allow("member-"+kind+":"+ip, rule, s.now())
}

// OTPIssued is the result of sending a code.
type OTPIssued struct {
	WADelivered bool
	DevBypass   bool
}

// RequestLoginOTP sends a code to a registered member. Unknown numbers get
// 404 not_registered: the table-order sheet uses it to offer guest checkout,
// and the per-IP brake limits enumeration through it.
func (s *Service) RequestLoginOTP(ctx context.Context, ip string, rawPhone any) (*OTPIssued, error) {
	if !s.ipAllowed("otp", ip) {
		return nil, errTooManyFromIP
	}
	phone, err := phoneArg(rawPhone)
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fail(400, "Nomor WhatsApp tidak valid")
	}
	member, err := s.repo.FindMemberByPhone(ctx, phone)
	if err != nil {
		return nil, err
	}
	if member == nil {
		return nil, &failure{Status: 404, Message: "Nomor belum terdaftar sebagai member. Daftar dulu lewat tombol Daftar.", Code: "not_registered"}
	}
	delivered, err := s.issueOTP(ctx, phone)
	if err != nil {
		return nil, err
	}
	return &OTPIssued{WADelivered: delivered, DevBypass: s.bypass().Active()}, nil
}

// RequestRegisterOTP sends a code for self registration. The answer is the
// same for members and non-members so it never reveals who is registered.
func (s *Service) RequestRegisterOTP(ctx context.Context, ip string, rawPhone any) (*OTPIssued, error) {
	if !s.ipAllowed("otp", ip) {
		return nil, errTooManyFromIP
	}
	phone, err := phoneArg(rawPhone)
	if err != nil {
		return nil, err
	}
	if phone == "" {
		return nil, fail(400, "Nomor WhatsApp tidak valid")
	}
	if s.bypass().Active() {
		return &OTPIssued{WADelivered: false, DevBypass: true}, nil
	}
	delivered, err := s.issueOTP(ctx, phone)
	if err != nil {
		return nil, err
	}
	return &OTPIssued{WADelivered: delivered}, nil
}

// phoneArg mirrors normalizePhoneDigits(body.phone): missing is empty, a
// non-string value made the TS throw (500).
func phoneArg(raw any) (string, error) {
	switch v := raw.(type) {
	case nil:
		return "", nil
	case string:
		return domain.NormalizePhoneDigits(v), nil
	}
	return "", errors.New("phone is not a string")
}

// issueOTP stores and sends a fresh code, 3 per number per 10 minutes.
func (s *Service) issueOTP(ctx context.Context, phone string) (bool, error) {
	recent, err := s.repo.CountRecentOTP(ctx, phone, domain.OTPRateLimitWindow)
	if err != nil {
		return false, err
	}
	if recent >= domain.OTPRateLimitCount {
		return false, errOTPTooManyIssued
	}
	code, err := domain.GenerateOTPCode()
	if err != nil {
		return false, err
	}
	if err := s.repo.InsertOTP(ctx, phone, domain.HashSecret(code), domain.OTPTTL); err != nil {
		return false, err
	}
	sent := s.notifier.SendOTP(ctx, phone, code, domain.OTPMessage(s.brand, code))
	if !sent.Delivered {
		// The code only reaches non-production logs: in production anyone
		// reading logs could sign in as any member.
		if s.production {
			s.log.Error("[member-portal] OTP WA gagal terkirim", "phone", phone, "reason", sent.Reason)
		} else {
			s.log.Warn("[member-portal] OTP WA gagal terkirim; kode utk debug dev", "phone", phone, "reason", sent.Reason, "code", code)
		}
	}
	return sent.Delivered, nil
}

// consumeOTP checks the newest code of the number and marks it used. Each
// try claims an attempt atomically before comparing, so parallel guesses
// cannot exceed the 5 attempts per code.
func consumeOTP(ctx context.Context, repo AuthRepository, phone, code string, now time.Time) error {
	otp, err := repo.LatestOTP(ctx, phone)
	if err != nil {
		return err
	}
	if otp == nil || otp.ConsumedAt != nil || otp.ExpiresAt.Before(now) {
		return errOTPExpired
	}
	claimed, err := repo.ClaimOTPAttempt(ctx, otp.ID, domain.OTPMaxAttempts)
	if err != nil {
		return err
	}
	if !claimed {
		return errOTPTooManyTries
	}
	if !domain.SafeEqual(otp.CodeHash, domain.HashSecret(code)) {
		return errOTPWrongCode
	}
	consumed, err := repo.ConsumeOTP(ctx, otp.ID)
	if err != nil {
		return err
	}
	if !consumed {
		return errOTPExpired
	}
	return nil
}

// SignedIn is a new member session.
type SignedIn struct {
	Name  *string
	Token string
}

// Verify checks the code (or the local dev bypass), stamps wa_verified_at
// and opens a session. The bypass never skips the member lookup.
func (s *Service) Verify(ctx context.Context, ip string, rawPhone any, code string) (*SignedIn, error) {
	phone, err := phoneArg(rawPhone)
	if err != nil {
		return nil, err
	}
	devBypass := s.bypass().CanBypass(code)
	if phone == "" || (!devBypass && !domain.IsOTPCode(code)) {
		return nil, fail(400, "Nomor/kode tidak valid")
	}
	if devBypass {
		s.log.Warn("[member-portal] OTP dev bypass dipakai", "phone", phone)
	} else {
		if !s.ipAllowed("verify", ip) {
			return nil, errTooManyFromIP
		}
		if err := consumeOTP(ctx, s.repo, phone, code, s.now()); err != nil {
			return nil, err
		}
	}
	member, err := s.repo.FindMemberByPhone(ctx, phone)
	if err != nil {
		return nil, err
	}
	if member == nil {
		return nil, fail(404, "Member tidak ditemukan")
	}
	if err := s.repo.MarkWAVerified(ctx, member.ID); err != nil {
		return nil, err
	}
	token, err := s.createSession(ctx, member.ID)
	if err != nil {
		return nil, err
	}
	return &SignedIn{Name: member.Name, Token: token}, nil
}

// Register verifies the code, creates the member and its CRM profile and
// opens a session. One transaction with an advisory lock per number, so two
// concurrent requests cannot create the same member twice.
func (s *Service) Register(ctx context.Context, ip string, body map[string]any) (*SignedIn, error) {
	reg, verr := domain.ValidateRegistration(domain.RegistrationInput{
		Phone: body["phone"], Name: body["name"], Email: body["email"],
		BirthDate: body["birth_date"], WAConsent: body["wa_consent"],
	}, s.now())
	if verr != nil {
		return nil, &failure{Status: 400, Message: verr.Message, Field: verr.Field}
	}
	code := jsString(body["code"])
	devBypass := s.bypass().CanBypass(code)
	if !devBypass && !domain.IsOTPCode(code) {
		return nil, &failure{Status: 400, Message: "Kode harus 6 digit", Field: "code"}
	}
	if !devBypass && !s.ipAllowed("verify", ip) {
		return nil, &failure{Status: 429, Message: domain.TooManyFromIP, Field: "code"}
	}

	var member *MemberRef
	var rejected *failure
	err := s.repo.InTx(ctx, func(tx Repository) error {
		if err := tx.LockRegistration(ctx, reg.PhoneDigits); err != nil {
			return err
		}
		// Code first, membership second: without a valid code the answer
		// must not tell a member's number from a new one.
		if devBypass {
			s.log.Warn("[member-portal] OTP dev bypass dipakai untuk daftar", "phone", reg.PhoneDigits)
		} else if err := consumeOTP(ctx, tx, reg.PhoneDigits, code, s.now()); err != nil {
			var f *failure
			if errors.As(err, &f) {
				rejected = &failure{Status: f.Status, Message: f.Message, Field: "code"}
				return nil
			}
			return err
		}
		existing, err := tx.FindMemberByPhone(ctx, reg.PhoneDigits)
		if err != nil {
			return err
		}
		if existing != nil {
			rejected = &failure{Status: 409, Message: "Nomor ini sudah terdaftar. Silakan masuk.", Field: "phone"}
			return nil
		}
		member, err = tx.InsertRegisteredMember(ctx, reg)
		if err != nil {
			return err
		}
		return tx.SetMarketingConsent(ctx, member.ID, reg.WAConsent, s.repo.DefaultVenue(ctx))
	})
	if err != nil {
		// The same number stored in another format (an inactive member).
		if database.IsUniqueViolation(err) {
			return nil, &failure{Status: 409, Message: "Nomor ini sudah tercatat. Hubungi kasir untuk mengaktifkannya.", Field: "phone"}
		}
		return nil, err
	}
	if rejected != nil {
		return nil, rejected
	}
	token, err := s.createSession(ctx, member.ID)
	if err != nil {
		return nil, err
	}
	return &SignedIn{Name: member.Name, Token: token}, nil
}

// createSession stores the hash of a random 32 byte token for 30 days.
func (s *Service) createSession(ctx context.Context, customerID string) (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b[:])
	if err := s.repo.CreateSession(ctx, domain.HashSecret(token), customerID, s.now().Add(domain.SessionTTL)); err != nil {
		return "", err
	}
	return token, nil
}

// Logout deletes the session behind the token, if any.
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repo.DeleteSession(ctx, domain.HashSecret(token))
}

// SetConsent switches WhatsApp promos and returns the effective opt-in.
func (s *Service) SetConsent(ctx context.Context, customerID string, enabled bool) (bool, error) {
	if err := s.repo.SetMarketingConsent(ctx, customerID, enabled, s.repo.DefaultVenue(ctx)); err != nil {
		return false, err
	}
	return s.repo.ReadMarketingConsent(ctx, customerID)
}
