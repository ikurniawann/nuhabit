package memberportal

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
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

// LoginAccount is the member a password sign-in checks.
type LoginAccount struct {
	ID           string
	Name         *string
	Phone        string
	PasswordHash *string
}

// Venue is the default company/branch stamped on wallet and XP rows.
type Venue struct {
	CompanyID *string
	BranchID  *string
}

// AuthRepository is the OTP, session and registration storage.
type AuthRepository interface {
	FindMemberByPhone(ctx context.Context, phone string) (*MemberRef, error)
	// MemberEmail is the member's email, "" when none is stored.
	MemberEmail(ctx context.Context, customerID string) (string, error)
	// FindMemberByGoogle matches the linked Google subject first, then an
	// active member with that email.
	FindMemberByGoogle(ctx context.Context, sub, email string) (*MemberRef, error)
	// LinkGoogle stores the Google subject on a member that has none.
	LinkGoogle(ctx context.Context, customerID, sub string) error
	CountRecentOTP(ctx context.Context, phone string, window time.Duration) (int, error)
	InsertOTP(ctx context.Context, phone, codeHash string, ttl time.Duration) error
	LatestOTP(ctx context.Context, phone string) (*OTPRecord, error)
	ClaimOTPAttempt(ctx context.Context, id string, max int) (bool, error)
	ConsumeOTP(ctx context.Context, id string) (bool, error)
	MarkWAVerified(ctx context.Context, customerID string) error
	CreateSession(ctx context.Context, tokenHash, customerID string, expiresAt time.Time) error
	DeleteSession(ctx context.Context, tokenHash string) error
	FindLoginAccount(ctx context.Context, digits, email string) (*LoginAccount, error)
	PasswordHash(ctx context.Context, customerID string) (*string, error)
	SetPasswordHash(ctx context.Context, customerID, hash string) error
	DeleteOtherSessions(ctx context.Context, customerID, keepTokenHash string) error
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
	errOTPTooManyToday  = fail(429, domain.TooManyCodesToday)
	errTooManyFromIP    = fail(429, domain.TooManyFromIP)
	errOTPNoEmail       = &failure{Status: 409, Code: "otp_no_email",
		Message: "Kode masuk dikirim lewat email, tapi akun ini belum punya email. Masuk dengan password atau hubungi front desk."}
)

// ipBrake applies the per-IP brake for kind "otp", "verify", "google" or "login",
// shared by every replica.
func (s *Service) ipBrake(ctx context.Context, kind, ip string) error {
	rule, refusal := domain.IPRuleOTP, errTooManyFromIP
	switch kind {
	case "verify":
		rule = domain.IPRuleVerify
	case "login":
		rule, refusal = domain.IPRuleLogin, errLoginTooManyFromIP
	}
	allowed, _, err := s.limits.Sliding(ctx, "member-"+kind+":"+ip, rule.Limit, rule.Window, s.now())
	if err == nil && !allowed {
		return refusal
	}
	if err != nil || kind != "otp" {
		return err
	}
	daily := domain.IPRuleOTPDaily
	allowed, _, err = s.limits.Sliding(ctx, "member-otp-day:"+ip, daily.Limit, daily.Window, s.now())
	if err == nil && !allowed {
		return refusal
	}
	return err
}

// OTPIssued is the result of sending a code: the channel it went out on
// and whether the provider accepted it.
type OTPIssued struct {
	Channel     string
	WADelivered bool
	DevBypass   bool
}

// RequestLoginOTP sends a code to a registered member. Unknown numbers get
// 404 not_registered: the table-order sheet uses it to offer guest checkout,
// and the per-IP brake limits enumeration through it.
func (s *Service) RequestLoginOTP(ctx context.Context, ip string, rawPhone any) (*OTPIssued, error) {
	if err := s.ipBrake(ctx, "otp", ip); err != nil {
		return nil, err
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
	email, err := s.repo.MemberEmail(ctx, member.ID)
	if err != nil {
		return nil, err
	}
	issued, err := s.issueOTP(ctx, phone, email)
	if err != nil {
		return nil, err
	}
	issued.DevBypass = s.bypass().Active()
	return issued, nil
}

// RequestRegisterOTP sends a code for self registration, to the email the
// visitor typed when email is the only channel. The answer is the same for
// members and non-members so it never reveals who is registered.
func (s *Service) RequestRegisterOTP(ctx context.Context, ip string, rawPhone any, email string) (*OTPIssued, error) {
	if err := s.ipBrake(ctx, "otp", ip); err != nil {
		return nil, err
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
	if s.otpChannel(ctx) == ChannelEmail && !domain.ValidEmail(email) {
		return nil, &failure{Status: 400, Message: "Masukkan email yang valid untuk menerima kode", Field: "email"}
	}
	return s.issueOTP(ctx, phone, email)
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

// issueOTP stores a fresh code for the number and sends it on WhatsApp, or
// to email when that is the only channel: 3 per number per 10 minutes and
// 10 per number per day.
func (s *Service) issueOTP(ctx context.Context, phone, email string) (*OTPIssued, error) {
	channel := s.otpChannel(ctx)
	if channel == ChannelEmail && email == "" {
		return nil, errOTPNoEmail
	}
	recent, err := s.repo.CountRecentOTP(ctx, phone, domain.OTPRateLimitWindow)
	if err != nil {
		return nil, err
	}
	if recent >= domain.OTPRateLimitCount {
		return nil, errOTPTooManyIssued
	}
	daily := domain.PhoneRuleOTPDaily
	allowed, _, err := s.limits.Sliding(ctx, "member-otp-phone:"+phone, daily.Limit, daily.Window, s.now())
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errOTPTooManyToday
	}
	code, err := domain.GenerateOTPCode()
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertOTP(ctx, phone, domain.HashSecret(code), domain.OTPTTL); err != nil {
		return nil, err
	}
	var delivered bool
	reason := "no channel configured"
	switch channel {
	case ChannelWhatsApp:
		sent := s.notifier.SendOTP(ctx, phone, code, domain.OTPMessage(s.brand, code))
		delivered, reason = sent.Delivered, sent.Reason
	case ChannelEmail:
		subject, body := otpEmail(s.brand, code)
		delivered, reason = s.mailer.Send(ctx, email, subject, body), "email send failed"
	}
	if !delivered {
		// The code only reaches non-production logs: in production anyone
		// reading logs could sign in as any member.
		if s.production {
			s.log.Error("[member-portal] OTP gagal terkirim", "phone", phone, "channel", channel, "reason", reason)
		} else {
			s.log.Warn("[member-portal] OTP gagal terkirim; kode utk debug dev", "phone", phone, "channel", channel, "reason", reason, "code", code)
		}
	}
	return &OTPIssued{Channel: channel, WADelivered: delivered && channel == ChannelWhatsApp}, nil
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
		if err := s.ipBrake(ctx, "verify", ip); err != nil {
			return nil, err
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

// GoogleSignInResult is a session for a known member, or the ticket a new
// one carries into registration.
type GoogleSignInResult struct {
	SignedIn    *SignedIn
	Ticket      domain.GoogleTicket
	TicketValue string
}

// GoogleSignIn verifies a Google ID token. A member linked to the Google
// account, or holding that verified email, gets a session; otherwise the
// identity is signed into a short-lived ticket for Register.
func (s *Service) GoogleSignIn(ctx context.Context, ip, idToken string) (*GoogleSignInResult, error) {
	if s.google == nil {
		return nil, fail(503, "Masuk dengan Google belum diaktifkan")
	}
	if err := s.ipBrake(ctx, "google", ip); err != nil {
		return nil, err
	}
	if idToken == "" {
		return nil, fail(400, "Token Google wajib diisi")
	}
	var lookupErr error
	claims, err := domain.ParseGoogleIDToken(idToken, func(kid string) *rsa.PublicKey {
		key, err := s.google.Key(ctx, kid)
		lookupErr = err
		return key
	}, s.googleAudience, s.now())
	if lookupErr != nil {
		return nil, lookupErr
	}
	if err != nil {
		return nil, fail(401, err.Error())
	}
	if !claims.EmailVerified || claims.Email == "" {
		return nil, fail(401, "Email akun Google belum terverifikasi")
	}
	member, err := s.repo.FindMemberByGoogle(ctx, claims.Sub, claims.Email)
	if err != nil {
		return nil, err
	}
	if member == nil {
		ticket := domain.GoogleTicket{Sub: claims.Sub, Email: claims.Email, Name: claims.Name}
		return &GoogleSignInResult{Ticket: ticket, TicketValue: domain.SignGoogleTicket(s.ticketSecret, ticket, s.now())}, nil
	}
	if err := s.repo.LinkGoogle(ctx, member.ID, claims.Sub); err != nil {
		return nil, err
	}
	token, err := s.createSession(ctx, member.ID)
	if err != nil {
		return nil, err
	}
	return &GoogleSignInResult{SignedIn: &SignedIn{Name: member.Name, Token: token}}, nil
}

// Register verifies the code, creates the member and its CRM profile and
// opens a session. One transaction with an advisory lock per number, so two
// concurrent requests cannot create the same member twice. A Google ticket
// supplies the verified email and links the Google account.
func (s *Service) Register(ctx context.Context, ip string, body map[string]any) (*SignedIn, error) {
	var google *domain.GoogleTicket
	if raw := jsString(body["google_ticket"]); raw != "" {
		t, err := domain.ParseGoogleTicket(s.ticketSecret, raw, s.now())
		if err != nil {
			return nil, &failure{Status: 401, Message: err.Error(), Field: "google_ticket"}
		}
		google = &t
		body["email"] = t.Email
	}
	reg, verr := domain.ValidateRegistration(domain.RegistrationInput{
		Phone: body["phone"], Name: body["name"], Email: body["email"],
		BirthDate: body["birth_date"], WAConsent: body["wa_consent"],
	}, s.now())
	if verr != nil {
		return nil, &failure{Status: 400, Message: verr.Message, Field: verr.Field}
	}
	if google != nil {
		reg.GoogleSub = &google.Sub
	}
	code := jsString(body["code"])
	devBypass := s.bypass().CanBypass(code)
	if !devBypass && !domain.IsOTPCode(code) {
		return nil, &failure{Status: 400, Message: "Kode harus 6 digit", Field: "code"}
	}
	if !devBypass {
		if err := s.ipBrake(ctx, "verify", ip); errors.Is(err, errTooManyFromIP) {
			return nil, &failure{Status: 429, Message: domain.TooManyFromIP, Field: "code"}
		} else if err != nil {
			return nil, err
		}
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
		if google != nil {
			linked, err := tx.FindMemberByGoogle(ctx, google.Sub, "")
			if err != nil {
				return err
			}
			if linked != nil {
				rejected = &failure{Status: 409, Message: "Akun Google ini sudah terhubung ke member lain. Silakan masuk.", Field: "google_ticket"}
				return nil
			}
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
	s.attachReferral(ctx, member.ID, jsString(body["referral_code"]), jsString(body["device_id"]))
	token, err := s.createSession(ctx, member.ID)
	if err != nil {
		return nil, err
	}
	return &SignedIn{Name: member.Name, Token: token}, nil
}

// attachReferral records the sign-up's referral code and device. A failure
// is logged and never fails the registration.
func (s *Service) attachReferral(ctx context.Context, customerID, code, deviceID string) {
	if s.referrals == nil {
		return
	}
	if err := s.referrals.Attach(ctx, customerID, code, deviceID); err != nil {
		s.log.ErrorContext(ctx, "[member-portal] referral gagal dicatat", "customer_id", customerID, "error", err)
	}
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
