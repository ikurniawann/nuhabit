// Package desktop serves the NüHabit OS desktop under /api/desktop: the
// owner monitoring board (overview and its SSE stream), the decision inbox,
// spotlight search, menubar status lights, per-user preferences and the
// wallpaper list. The board, inbox and search are read-only reporting over
// other contexts' tables with the TS queries kept as they are; the module
// owns only configuration.user_desktop_prefs.
package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/desktop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Repository is the board's reporting reads plus the preferences table.
type Repository interface {
	SalesByDay(ctx context.Context, today string) ([]DayRow, error)
	GrossProfitToday(ctx context.Context, today string) (*GrossProfit, error)
	RevenueTotals(ctx context.Context, summary domain.PeriodSummary) (FnbTotals, B2bTotals, error)
	GuestsSeated(ctx context.Context) (*GuestsSeated, error)
	PromoLines(ctx context.Context, p domain.Period) ([]PromoLine, error)
	TeamToday(ctx context.Context, today string) (*TeamToday, error)
	PendingDecisions(ctx context.Context) (*PendingDecisions, error)
	LowStockItems(ctx context.Context) ([]LowStockItem, error)
	CrmPulse(ctx context.Context) (*CrmPulse, error)

	InboxSection(ctx context.Context, key string) (*InboxSection, error)
	SearchSource(ctx context.Context, key, pattern string) ([]domain.SearchHit, error)

	Ping(ctx context.Context) error
	PrintQueue(ctx context.Context) (pending, oldestMinutes int, err error)
	// Setting is getSetting: nil when the key has no row or a NULL value.
	Setting(ctx context.Context, key string) (*string, error)

	// Preferences returns nil when the user saved none.
	Preferences(ctx context.Context, userID string) ([]byte, error)
	SavePreferences(ctx context.Context, userID string, prefs []byte, at time.Time) error
}

// DayRow is one WIB day of paid sales.
type DayRow struct {
	Tanggal string
	Omzet   float64
	Pesanan int
}

// FnbTotals is the POS side of the revenue card.
type FnbTotals struct {
	Omzet, BandingOmzet     float64
	Pesanan, BandingPesanan int
	Baris                   int
}

// B2bTotals is the paid B2B side of the revenue card.
type B2bTotals struct {
	Omzet, BandingOmzet float64
	Baris               int
}

// Users resolves the caller and their IAM menus (platform/auth).
type Users interface {
	RequireUser(r *http.Request) (*auth.User, error)
	GrantedMenuCodes(ctx context.Context, userID, role string) ([]string, error)
}

// Service holds the use cases.
type Service struct {
	repo  Repository
	users Users
	log   *slog.Logger
	now   func() time.Time
	// probe is the client for the WhatsApp gateway at base (its /status).
	probe func(base string) *http.Client
	cache overviewCache
	board *broadcaster
	// heartbeat is the SSE keepalive interval.
	heartbeat time.Duration
}

// NewService wires the use cases.
func NewService(repo Repository, users Users, log *slog.Logger, now func() time.Time) *Service {
	s := &Service{repo: repo, users: users, log: log, now: now,
		probe: whatsapp.GatewayClient, cache: overviewCache{entries: map[string]cachedOverview{}}, heartbeat: heartbeatEvery}
	s.board = newBroadcaster(func(ctx context.Context) *Overview { return s.BuildOverview(ctx, "today") }, log)
	return s
}

// requireBoard is the overview and stream guard: a dashboard menu, or no
// IAM data at all and an owner role.
func (s *Service) requireBoard(r *http.Request) (*auth.User, error) {
	user, err := s.users.RequireUser(r)
	if err != nil {
		return nil, err
	}
	granted, err := s.users.GrantedMenuCodes(r.Context(), user.ID, user.Role)
	if err != nil {
		return nil, err
	}
	if iam.HasAnyMenuPrefix(granted, iam.Dashboard) || (len(granted) == 0 && slices.Contains(OverviewRoles, user.Role)) {
		return user, nil
	}
	return nil, httpx.Forbidden("Insufficient permissions")
}

// ── inbox ────────────────────────────────────────────────────────────────

// InboxSection is one "Perlu Keputusan" list.
type InboxSection struct {
	Key   string      `json:"key"`
	Label string      `json:"label"`
	Total int         `json:"total"`
	Items []InboxItem `json:"items"`
}

// InboxItem is one decision. Only leave requests are actionable from the
// widget (they have an approval API); the rest open their page.
type InboxItem struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Subtitle   string `json:"subtitle"`
	Href       string `json:"href"`
	Actionable bool   `json:"actionable,omitempty"`
}

// Inbox is GET /api/desktop/inbox: the sections the caller's menus allow,
// loaded concurrently; a failing section is dropped, empty ones too.
func (s *Service) Inbox(ctx context.Context, user *auth.User) ([]*InboxSection, error) {
	granted, err := s.users.GrantedMenuCodes(ctx, user.ID, user.Role)
	if err != nil {
		return nil, err
	}
	keys := domain.AllowedInboxSections(user.Role, granted)
	sections := make([]*InboxSection, len(keys))
	var wg sync.WaitGroup
	for i, key := range keys {
		wg.Go(func() {
			sec, err := s.repo.InboxSection(ctx, key)
			if err != nil {
				s.log.WarnContext(ctx, "[desktop/inbox] seksi "+key+" gagal", "error", err)
				return
			}
			sections[i] = sec
		})
	}
	wg.Wait()
	out := []*InboxSection{}
	for _, sec := range sections {
		if sec != nil && sec.Total > 0 {
			out = append(out, sec)
		}
	}
	return out, nil
}

// ── search ───────────────────────────────────────────────────────────────

// SearchResult is the data of GET /api/desktop/search.
type SearchResult struct {
	Groups []domain.SearchGroup `json:"groups"`
	Query  string               `json:"query"`
}

// Search is the spotlight: each source the caller's menus allow, queried
// concurrently; a failing source contributes nothing.
func (s *Service) Search(ctx context.Context, user *auth.User, raw string) (*SearchResult, error) {
	query := domain.NormalizeSearchQuery(raw)
	if !domain.IsSearchable(query) {
		return &SearchResult{Groups: []domain.SearchGroup{}, Query: query}, nil
	}
	granted, err := s.users.GrantedMenuCodes(ctx, user.ID, user.Role)
	if err != nil {
		return nil, err
	}
	sources := domain.AllowedSources(granted)
	pattern := domain.LikePattern(query)
	results := make([][]domain.SearchHit, len(sources))
	var wg sync.WaitGroup
	for i, src := range sources {
		wg.Go(func() {
			hits, err := s.repo.SearchSource(ctx, src.Key, pattern)
			if err != nil {
				s.log.WarnContext(ctx, "[desktop/search] sumber "+src.Key+" gagal", "error", err)
				return
			}
			results[i] = hits
		})
	}
	wg.Wait()
	hits := slices.Concat(results...)
	return &SearchResult{Groups: domain.GroupHitsBySource(domain.RankSearchHits(hits, query)), Query: query}, nil
}

// ── status ───────────────────────────────────────────────────────────────

// probeTimeout is PROBE_TIMEOUT_MS.
const probeTimeout = 2500 * time.Millisecond

// StatusResult is the data of GET /api/desktop/status.
type StatusResult struct {
	Items []domain.StatusItem `json:"items"`
	Level string              `json:"level"`
}

// Status checks the database, the print queue and the WhatsApp gateway
// concurrently; each check degrades to its own level instead of failing.
// Only a failed gateway URL read fails the route, as in TS.
func (s *Service) Status(ctx context.Context) (*StatusResult, error) {
	items := make([]domain.StatusItem, 3)
	var waErr error
	var wg sync.WaitGroup
	wg.Go(func() { items[0] = s.checkDatabase(ctx) })
	wg.Go(func() { items[1] = s.checkPrintQueue(ctx) })
	wg.Go(func() { items[2], waErr = s.checkWhatsApp(ctx) })
	wg.Wait()
	if waErr != nil {
		return nil, waErr
	}
	return &StatusResult{Items: items, Level: domain.RollupStatus(items)}, nil
}

func (s *Service) checkDatabase(ctx context.Context) domain.StatusItem {
	if err := s.repo.Ping(ctx); err != nil {
		return domain.StatusItem{Key: "db", Label: "Database", Level: "down", Detail: "Tidak bisa dihubungi"}
	}
	return domain.StatusItem{Key: "db", Label: "Database", Level: "ok"}
}

func (s *Service) checkPrintQueue(ctx context.Context) domain.StatusItem {
	pending, oldest, err := s.repo.PrintQueue(ctx)
	if err != nil {
		return domain.StatusItem{Key: "print", Label: "Antrian cetak", Level: "unknown", Detail: "Tidak terbaca"}
	}
	item := domain.StatusItem{Key: "print", Label: "Antrian cetak", Detail: "Kosong"}
	var stuck *int
	if pending > 0 {
		stuck = &oldest
		item.Detail = fmt.Sprintf("%d job, tertua %d menit", pending, oldest)
	}
	item.Level = domain.PrintQueueLevel(pending, stuck)
	return item
}

func (s *Service) checkWhatsApp(ctx context.Context) (domain.StatusItem, error) {
	item := domain.StatusItem{Key: "wa", Label: "WhatsApp"}
	raw, err := s.repo.Setting(ctx, "wa_gateway_url")
	if err != nil {
		return item, err
	}
	base := ""
	if raw != nil {
		base = strings.TrimRight(*raw, "/")
	}
	if base == "" {
		item.Level, item.Detail = "unknown", "Belum dikonfigurasi"
		return item, nil
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/status", nil)
	var res *http.Response
	if err == nil {
		res, err = s.probe(base).Do(req)
	}
	if err != nil {
		item.Level, item.Detail = "down", "Gateway tidak menjawab"
		return item, nil
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		item.Level, item.Detail = "warn", fmt.Sprintf("Gateway menjawab %d", res.StatusCode)
		return item, nil
	}
	var body struct {
		Connected any `json:"connected"`
		State     any `json:"state"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	if body.Connected == true || body.State == "connected" {
		item.Level, item.Detail = "ok", "Terhubung"
	} else {
		item.Level, item.Detail = "warn", "Gateway hidup, sesi belum terhubung"
	}
	return item, nil
}

// ── preferences / wallpapers ─────────────────────────────────────────────

// Preferences is GET /api/desktop/preferences: the saved preferences,
// normalized, or nil when the user saved none.
func (s *Service) Preferences(ctx context.Context, userID string) (*domain.Preferences, error) {
	raw, err := s.repo.Preferences(ctx, userID)
	if err != nil || raw == nil {
		return nil, err
	}
	prefs := domain.NormalizePreferences(raw)
	return &prefs, nil
}

// SavePreferences is PUT /api/desktop/preferences: the body is normalized
// first so a client cannot park arbitrary keys in the jsonb; a body that is
// not JSON saves the defaults.
func (s *Service) SavePreferences(ctx context.Context, userID string, body []byte) (*domain.Preferences, error) {
	prefs := domain.NormalizePreferences(body)
	raw, err := json.Marshal(prefs)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SavePreferences(ctx, userID, raw, s.now()); err != nil {
		return nil, err
	}
	return &prefs, nil
}

// Wallpapers is GET /api/desktop/wallpapers: the uploaded wallpapers kept
// in configuration.app_settings (desktop_wallpapers).
func (s *Service) Wallpapers(ctx context.Context) ([]domain.Wallpaper, error) {
	raw, err := s.repo.Setting(ctx, "desktop_wallpapers")
	if err != nil {
		return nil, err
	}
	return domain.ParseWallpapers(raw), nil
}
