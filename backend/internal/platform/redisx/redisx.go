// Package redisx opens the optional Redis client named by REDIS_URL. The API
// runs without it: idempotency keys are then ignored and IAM grants are read
// from Postgres on every request.
package redisx

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Open parses url (redis:// or rediss://) and pings the server. An empty url
// returns nil, nil.
func Open(ctx context.Context, url string) (*redis.Client, error) {
	if url == "" {
		return nil, nil
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL tidak valid: %w", err)
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis tidak menjawab: %w", err)
	}
	return client, nil
}
