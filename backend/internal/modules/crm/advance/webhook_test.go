package advance

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/module"
)

// A workflow webhook URL is user input: it must not reach loopback, private
// or cloud metadata addresses, nor plain http.
func TestWebhookRefusesInternalDestinations(t *testing.T) {
	hooks := &recorder{}
	internal := hooks.server(t, 200).URL + "/hook" // http://127.0.0.1:<port>
	h := newHandler(nil, module.Deps{}, Ports{})
	for _, url := range []string{
		internal,
		"https://169.254.169.254/latest/meta-data/",
		"https://[::1]:1/hook",
		"https://10.0.0.8/hook",
		"http://example.com/hook",
	} {
		_, err := h.webhookAction(context.Background(), workflowAction{Type: "webhook", URL: &url}, &actionCtx{rec: &record{}})
		if err == nil || err.Error() != msgWebhookBlocked {
			t.Errorf("%s: err = %v, want %q", url, err, msgWebhookBlocked)
		}
	}
	if hooks.count() != 0 {
		t.Fatalf("internal receiver hit %d times", hooks.count())
	}
}
