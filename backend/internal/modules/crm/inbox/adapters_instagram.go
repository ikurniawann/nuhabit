package inbox

import (
	"context"
	"net/http"
	"strconv"

	"nuhabit/backend/internal/platform/database"
)

// InstagramGraph is a stopgap adapter: moves to the settings/integrations
// context once it is ported. It mirrors lib/instagram/client.ts: credentials
// from configuration.app_settings (env as fallback), messages through the
// Meta Graph API.
type InstagramGraph struct {
	Getenv func(string) string
	Client *http.Client
	// GraphBase overrides https://graph.facebook.com/v21.0 (tests).
	GraphBase string
}

var _ Instagram = InstagramGraph{}

type instagramConfig struct {
	appSecret, verifyToken, accessToken, accountID string
}

// config reads the credentials; a settings read failure falls back to the env.
func (g InstagramGraph) config(ctx context.Context, q database.Querier) instagramConfig {
	stored, _ := appSettings(ctx, q, "ig_app_secret", "ig_verify_token", "ig_access_token", "ig_account_id")
	return instagramConfig{
		appSecret:   settingOrEnv(stored, "ig_app_secret", g.Getenv("IG_APP_SECRET")),
		verifyToken: settingOrEnv(stored, "ig_verify_token", g.Getenv("IG_VERIFY_TOKEN")),
		accessToken: settingOrEnv(stored, "ig_access_token", g.Getenv("IG_ACCESS_TOKEN")),
		accountID:   settingOrEnv(stored, "ig_account_id", g.Getenv("IG_ACCOUNT_ID")),
	}
}

// WebhookConfig needs only the app secret and verify token, so messages are
// received before a sender token exists.
func (g InstagramGraph) WebhookConfig(ctx context.Context, q database.Querier) *InstagramWebhookConfig {
	c := g.config(ctx, q)
	if c.appSecret == "" || c.verifyToken == "" {
		return nil
	}
	return &InstagramWebhookConfig{AppSecret: c.appSecret, VerifyToken: c.verifyToken}
}

// SendText sends one text message to an IGSID; Meta's error message is
// passed through because it usually names the real cause.
func (g InstagramGraph) SendText(ctx context.Context, q database.Querier, recipientID, message string) InstagramSend {
	c := g.config(ctx, q)
	if c.appSecret == "" || c.verifyToken == "" || c.accessToken == "" || c.accountID == "" {
		return InstagramSend{Reason: "Instagram belum dikonfigurasi — lengkapi kredensial di Settings."}
	}
	base := firstSet(g.GraphBase, "https://graph.facebook.com/v21.0")
	res, err := doRequest(ctx, httpClient(g.Client), http.MethodPost, base+"/"+c.accountID+"/messages",
		map[string]any{"recipient": map[string]string{"id": recipientID}, "message": map[string]string{"text": message}},
		map[string]string{"Content-Type": "application/json", "Authorization": "Bearer " + c.accessToken})
	if err != nil {
		return InstagramSend{Reason: fetchError(ctx, err)}
	}
	if !res.ok() {
		return InstagramSend{Reason: firstSet(res.apiError(), "Instagram menolak permintaan (HTTP "+strconv.Itoa(res.status)+")")}
	}
	out := InstagramSend{Success: true}
	if id, ok := res.data["message_id"].(string); ok {
		out.MessageID = &id
	}
	return out
}
