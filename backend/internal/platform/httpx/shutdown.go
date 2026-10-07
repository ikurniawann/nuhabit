package httpx

import "context"

type shutdownKey struct{}

// WithShutdown returns ctx carrying draining, a channel the server closes
// when it starts shutting down. cmd/api uses it as the server's BaseContext.
func WithShutdown(ctx context.Context, draining <-chan struct{}) context.Context {
	return context.WithValue(ctx, shutdownKey{}, draining)
}

// Draining is closed once the server shuts down. http.Server.Shutdown waits
// for every handler without cancelling request contexts, so a stream that
// never ends on its own (SSE) selects on this and returns; the client
// reconnects to the next instance. Without a server it never closes.
func Draining(ctx context.Context) <-chan struct{} {
	ch, _ := ctx.Value(shutdownKey{}).(<-chan struct{})
	return ch
}
