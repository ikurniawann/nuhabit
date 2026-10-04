package inbox

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/platform/database"
)

// GoogleBusinessAPI is a stopgap adapter: moves to the settings/integrations
// context once it is ported. It mirrors lib/crm/google-business-client.ts:
// credentials from configuration.app_settings (env as fallback), a refresh
// token exchanged for a cached access token, reviews pulled from every
// configured location, and reply upserts.
type GoogleBusinessAPI struct {
	Getenv func(string) string
	Client *http.Client
	Log    *slog.Logger

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

var _ GoogleBusiness = (*GoogleBusinessAPI)(nil)

const (
	googleTokenURL   = "https://oauth2.googleapis.com/token"
	googleReviewsAPI = "https://mybusiness.googleapis.com/v4"
	googleNotReady   = "Kredensial Google Business belum dikonfigurasi"
)

type googleConfig struct {
	clientID, clientSecret, refreshToken, accountID string
	locationIDs                                     []string
}

// config is nil when any credential or location is missing; a settings
// read failure falls back to the env.
func (g *GoogleBusinessAPI) config(ctx context.Context, q database.Querier) *googleConfig {
	keys := []string{"google_bp_client_id", "google_bp_client_secret", "google_bp_refresh_token", "google_bp_account_id", "google_bp_location_id"}
	stored, _ := appSettings(ctx, q, keys...)
	pick := func(key string) string { return settingOrEnv(stored, key, g.Getenv(strings.ToUpper(key))) }
	c := googleConfig{
		clientID: pick(keys[0]), clientSecret: pick(keys[1]), refreshToken: pick(keys[2]), accountID: pick(keys[3]),
		locationIDs: domain.ParseLocationIDs(pick(keys[4])),
	}
	if c.clientID == "" || c.clientSecret == "" || c.refreshToken == "" || c.accountID == "" || len(c.locationIDs) == 0 {
		return nil
	}
	return &c
}

// Status reports whether the integration is usable (diagnostics panel).
func (g *GoogleBusinessAPI) Status(ctx context.Context, q database.Querier) (bool, []string) {
	c := g.config(ctx, q)
	if c == nil {
		return false, []string{}
	}
	return true, c.locationIDs
}

// accessToken exchanges the refresh token, cached until a minute before it
// expires; "" on failure (logged).
func (g *GoogleBusinessAPI) accessToken(ctx context.Context, c *googleConfig) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" && g.expiresAt.After(time.Now().Add(time.Minute)) {
		return g.token
	}
	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	form := url.Values{"client_id": {c.clientID}, "client_secret": {c.clientSecret}, "refresh_token": {c.refreshToken}, "grant_type": {"refresh_token"}}
	res, err := doRequest(callCtx, httpClient(g.Client), http.MethodPost, googleTokenURL, form.Encode(),
		map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if err != nil {
		g.Log.Error("[google-bp] Gagal menukar refresh token", "error", fetchError(callCtx, err))
		return ""
	}
	token, _ := res.data["access_token"].(string)
	if !res.ok() || token == "" {
		g.Log.Error("[google-bp] Gagal menukar refresh token", "status", res.status)
		return ""
	}
	expires, _ := res.data["expires_in"].(float64)
	if expires == 0 {
		expires = 3600
	}
	g.token, g.expiresAt = token, time.Now().Add(time.Duration(expires)*time.Second)
	return token
}

// FetchReviews pulls up to five pages of 50 per location. One failing
// location does not fail the others; the sync fails only when none worked.
func (g *GoogleBusinessAPI) FetchReviews(ctx context.Context, q database.Querier) GoogleFetch {
	c := g.config(ctx, q)
	if c == nil {
		return GoogleFetch{Reason: googleNotReady, NotConfigured: true}
	}
	token := g.accessToken(ctx, c)
	if token == "" {
		return GoogleFetch{Reason: "Gagal mendapatkan access token Google"}
	}
	collected := []json.RawMessage{}
	var failures []string
	succeeded := 0
	for _, location := range c.locationIDs {
		if err := g.fetchLocation(ctx, c, location, token, &collected); err != "" {
			failures = append(failures, location+": "+err)
			g.Log.Warn("[google-bp] Gagal menarik ulasan", "location", location, "reason", err)
			continue
		}
		succeeded++
	}
	if succeeded == 0 && len(failures) > 0 {
		return GoogleFetch{Reason: strings.Join(failures, "; ")}
	}
	return GoogleFetch{OK: true, Reviews: collected}
}

func (g *GoogleBusinessAPI) fetchLocation(ctx context.Context, c *googleConfig, location, token string, collected *[]json.RawMessage) string {
	pageToken := ""
	for range 5 {
		u, err := url.Parse(googleReviewsAPI + "/" + c.accountID + "/" + location + "/reviews")
		if err != nil {
			return err.Error()
		}
		params := u.Query()
		params.Set("pageSize", "50")
		if pageToken != "" {
			params.Set("pageToken", pageToken)
		}
		u.RawQuery = params.Encode()
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		res, err := doRequest(callCtx, httpClient(g.Client), http.MethodGet, u.String(), nil, map[string]string{"Authorization": "Bearer " + token})
		cancel()
		if err != nil {
			return fetchError(callCtx, err)
		}
		if !res.ok() {
			return firstSet(res.apiError(), "HTTP "+strconv.Itoa(res.status))
		}
		var page struct {
			Reviews       []json.RawMessage `json:"reviews"`
			NextPageToken string            `json:"nextPageToken"`
		}
		_ = json.Unmarshal(res.raw, &page)
		*collected = append(*collected, page.Reviews...)
		if pageToken = page.NextPageToken; pageToken == "" {
			break
		}
	}
	return ""
}

// PutReply sets the review's single reply (a second call replaces it).
func (g *GoogleBusinessAPI) PutReply(ctx context.Context, q database.Querier, reviewName, comment string) GoogleReply {
	c := g.config(ctx, q)
	if c == nil {
		return GoogleReply{Reason: googleNotReady, NotConfigured: true}
	}
	token := g.accessToken(ctx, c)
	if token == "" {
		return GoogleReply{Reason: "Gagal mendapatkan access token Google"}
	}
	callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	res, err := doRequest(callCtx, httpClient(g.Client), http.MethodPut, googleReviewsAPI+"/"+reviewName+"/reply",
		map[string]string{"comment": comment}, map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"})
	if err != nil {
		return GoogleReply{Reason: fetchError(callCtx, err)}
	}
	if !res.ok() {
		return GoogleReply{Reason: firstSet(res.apiError(), "HTTP "+strconv.Itoa(res.status))}
	}
	return GoogleReply{OK: true}
}
