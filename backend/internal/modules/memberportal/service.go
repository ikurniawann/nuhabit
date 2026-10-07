// Package memberportal is the member portal and member app API
// (/api/member-portal/**): OTP sign-in and self registration, the member
// profile, notifications, promos, events, challenges, rewards, collectibles,
// reviews, ARK Coin top-up and the app home screens.
package memberportal

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/ratelimit"
)

// Repository is the module's storage. InTx runs fn against a transaction.
type Repository interface {
	AuthRepository
	AccountRepository
	FeedRepository
	EngagementRepository
	CollectionRepository
	InTx(ctx context.Context, fn func(Repository) error) error
}

// Service holds the member portal use cases.
type Service struct {
	repo       Repository
	notifier   Notifier
	pusher     Pusher
	payments   Payments
	wallet     WalletLedger
	loyalty    Loyalty
	log        *slog.Logger
	now        func() time.Time
	limits     *ratelimit.Limiter
	bypass     func() domain.DevBypass
	brand      string
	production bool
	appOrigin  string
	// google verifies ID tokens for GOOGLE_CLIENT_ID; nil disables Google sign-in.
	google         *googleKeys
	googleAudience string
	ticketSecret   []byte
}
