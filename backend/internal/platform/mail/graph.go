package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Microsoft Graph endpoints (learn.microsoft.com/graph/api/user-sendmail and
// learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow).
const (
	DefaultGraphBaseURL = "https://graph.microsoft.com/v1.0"
	DefaultGraphLogin   = "https://login.microsoftonline.com"
	graphScope          = "https://graph.microsoft.com/.default"
	// tokenSlack refreshes a token this long before it expires.
	tokenSlack = time.Minute
)

// Graph sends with POST /users/{mailbox}/sendMail as an application
// (OAuth2 client credentials, Mail.Send application permission). The access
// token stays in memory until a minute before it expires.
type Graph struct {
	TenantID     string
	ClientID     string
	ClientSecret string
	// Mailbox is the user principal name or id the message is sent as.
	Mailbox string
	// BaseURL and LoginURL override the endpoints (tests).
	BaseURL  string
	LoginURL string
	Client   *http.Client
	Now      func() time.Time

	mu     sync.Mutex
	token  string
	expiry time.Time
}

func (g *Graph) Name() string { return ProviderGraph }

// Same reports whether g was built from the same credentials, so the token
// cache can be kept across configuration reloads.
func (g *Graph) Same(c Config) bool {
	return g.TenantID == c.TenantID && g.ClientID == c.ClientID && g.ClientSecret == c.ClientSecret && g.Mailbox == c.Mailbox()
}

func (g *Graph) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// accessToken returns the cached token or fetches a new one.
func (g *Graph) accessToken(ctx context.Context) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.token != "" && g.now().Add(tokenSlack).Before(g.expiry) {
		return g.token, nil
	}
	login := g.LoginURL
	if login == "" {
		login = DefaultGraphLogin
	}
	form := url.Values{
		"client_id":     {g.ClientID},
		"client_secret": {g.ClientSecret},
		"scope":         {graphScope},
		"grant_type":    {"client_credentials"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, login+"/"+url.PathEscape(g.TenantID)+"/oauth2/v2.0/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := httpClient(g.Client).Do(req)
	if err != nil {
		return "", Transient(fmt.Errorf("token Microsoft: %w", err))
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode/100 != 2 {
		var e struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(raw, &e)
		detail := strings.TrimSpace(e.Error + " " + firstLine(e.Description))
		if detail == "" {
			detail = http.StatusText(res.StatusCode)
		}
		return "", httpError("token Microsoft", res.StatusCode, detail)
	}
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.AccessToken == "" {
		return "", errors.New("token Microsoft: respons tanpa access_token")
	}
	g.token = out.AccessToken
	g.expiry = g.now().Add(time.Duration(out.ExpiresIn) * time.Second)
	return g.token, nil
}

// invalidate drops the cached token after a 401.
func (g *Graph) invalidate() {
	g.mu.Lock()
	g.token, g.expiry = "", time.Time{}
	g.mu.Unlock()
}

type graphRecipient struct {
	EmailAddress struct {
		Address string `json:"address"`
		Name    string `json:"name,omitempty"`
	} `json:"emailAddress"`
}

type graphAttachment struct {
	ODataType    string `json:"@odata.type"`
	Name         string `json:"name"`
	ContentType  string `json:"contentType"`
	ContentBytes string `json:"contentBytes"`
}

// sendMailBody is the JSON of POST /sendMail.
type sendMailBody struct {
	Message struct {
		Subject string `json:"subject"`
		Body    struct {
			ContentType string `json:"contentType"`
			Content     string `json:"content"`
		} `json:"body"`
		From         *graphRecipient   `json:"from,omitempty"`
		ToRecipients []graphRecipient  `json:"toRecipients"`
		Attachments  []graphAttachment `json:"attachments,omitempty"`
	} `json:"message"`
	SaveToSentItems bool `json:"saveToSentItems"`
}

func (g *Graph) Send(ctx context.Context, m Message) (string, error) {
	var body sendMailBody
	body.Message.Subject = m.Subject
	body.Message.Body.ContentType = "HTML"
	body.Message.Body.Content = m.HTML
	var to graphRecipient
	to.EmailAddress.Address = m.To
	body.Message.ToRecipients = []graphRecipient{to}
	if m.FromName != "" {
		from := &graphRecipient{}
		from.EmailAddress.Address = g.Mailbox
		from.EmailAddress.Name = m.FromName
		body.Message.From = from
	}
	for _, a := range m.Attachments {
		ct := a.ContentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		body.Message.Attachments = append(body.Message.Attachments, graphAttachment{
			ODataType: "#microsoft.graph.fileAttachment", Name: a.Filename, ContentType: ct,
			ContentBytes: base64.StdEncoding.EncodeToString(a.Content),
		})
	}
	body.SaveToSentItems = true
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	requestID := newRequestID()
	for attempt := 0; ; attempt++ {
		token, err := g.accessToken(ctx)
		if err != nil {
			return "", err
		}
		status, detail, err := g.post(ctx, token, requestID, payload)
		if err != nil {
			return "", Transient(err)
		}
		if status == http.StatusUnauthorized && attempt == 0 {
			g.invalidate()
			continue
		}
		if status/100 != 2 {
			return "", httpError("Graph", status, detail)
		}
		return requestID, nil
	}
}

// post sends one sendMail request; detail is the Graph error text of a
// non-2xx answer.
func (g *Graph) post(ctx context.Context, token, requestID string, payload []byte) (int, string, error) {
	base := g.BaseURL
	if base == "" {
		base = DefaultGraphBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/users/"+url.PathEscape(g.Mailbox)+"/sendMail", bytes.NewReader(payload))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("client-request-id", requestID)
	res, err := httpClient(g.Client).Do(req)
	if err != nil {
		return 0, "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode/100 == 2 {
		return res.StatusCode, "", nil
	}
	var e struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &e)
	detail := strings.TrimSpace(e.Error.Code + " " + e.Error.Message)
	if detail == "" {
		detail = http.StatusText(res.StatusCode)
	}
	return res.StatusCode, detail, nil
}

// newRequestID is a UUID v4 for client-request-id, also the log's reference.
func newRequestID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

// firstLine keeps the message of an AADSTS description, not its trace ids.
func firstLine(s string) string {
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		return s[:i]
	}
	return s
}

// httpClient is c or a bounded default.
func httpClient(c *http.Client) *http.Client {
	if c != nil {
		return c
	}
	return defaultHTTPClient
}

var defaultHTTPClient = &http.Client{Timeout: 20 * time.Second}
