package ratelimit

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// shared is the Redis client every Limiter counts in once UseRedis ran.
var shared atomic.Pointer[redis.Client]

// UseRedis moves every limiter of this process to Redis: one script call per
// hit instead of a Postgres upsert. cmd/api calls it at startup when
// REDIS_URL is set; nil switches back to Postgres. A hit whose Redis call
// fails is counted in Postgres instead, so an outage never lifts a limit.
func UseRedis(rdb *redis.Client) { shared.Store(rdb) }

// Times cross into Lua as Unix microseconds, the precision of timestamptz,
// and follow the caller's clock like the Postgres rows do. Key expiry runs on
// Redis' own clock, one window after the last hit.

// fixedScript: KEYS[1] hash {count, reset}; ARGV now, now+window, limit, window ms.
var fixedScript = redis.NewScript(`
local now, reset, limit = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local row = redis.call('HMGET', KEYS[1], 'count', 'reset')
local count, expires = tonumber(row[1]), tonumber(row[2])
local allowed = 1
if not count or now > expires then
  count, expires = 1, reset
elseif count >= limit then
  allowed = 0
else
  count = count + 1
end
redis.call('HSET', KEYS[1], 'count', count, 'reset', expires)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
return {allowed, count, expires}`)

// slidingScript: KEYS[1] sorted set of hit times; ARGV now, now-window,
// limit, window ms, unique member. Returns {allowed, oldest counted hit}.
var slidingScript = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
local allowed = redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[3])
if allowed then
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[5])
end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
if allowed then
  return {1, 0}
end
return {0, tonumber(redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2])}`)

func fixedKey(key string) string   { return "rl:f:" + key }
func slidingKey(key string) string { return "rl:s:" + key }

func redisFixed(ctx context.Context, rdb *redis.Client, key string, limit int, window time.Duration, now time.Time) (Window, error) {
	out, err := fixedScript.Run(ctx, rdb, []string{fixedKey(key)},
		now.UnixMicro(), now.Add(window).UnixMicro(), limit, window.Milliseconds()).Int64Slice()
	if err != nil {
		return Window{}, err
	}
	return Window{Allowed: out[0] == 1, Count: int(out[1]), ResetAt: time.UnixMicro(out[2])}, nil
}

func redisPeek(ctx context.Context, rdb *redis.Client, key string) (*Window, error) {
	row, err := rdb.HMGet(ctx, fixedKey(key), "count", "reset").Result()
	if err != nil {
		return nil, err
	}
	count, ok1 := row[0].(string)
	reset, ok2 := row[1].(string)
	if !ok1 || !ok2 {
		return nil, nil
	}
	n, err := strconv.Atoi(count)
	if err != nil {
		return nil, err
	}
	micros, err := strconv.ParseInt(reset, 10, 64)
	if err != nil {
		return nil, err
	}
	return &Window{Count: n, ResetAt: time.UnixMicro(micros)}, nil
}

func redisSliding(ctx context.Context, rdb *redis.Client, key string, limit int, window time.Duration, now time.Time) (bool, time.Duration, error) {
	member := make([]byte, 8)
	_, _ = rand.Read(member)
	out, err := slidingScript.Run(ctx, rdb, []string{slidingKey(key)},
		now.UnixMicro(), now.Add(-window).UnixMicro(), limit, window.Milliseconds(), hex.EncodeToString(member)).Int64Slice()
	if err != nil {
		return false, 0, err
	}
	if out[0] == 1 {
		return true, 0, nil
	}
	return false, time.UnixMicro(out[1]).Add(window).Sub(now), nil
}

func redisSlidingCount(ctx context.Context, rdb *redis.Client, key string, window time.Duration, now time.Time) (int, error) {
	n, err := rdb.ZCount(ctx, slidingKey(key), "("+strconv.FormatInt(now.Add(-window).UnixMicro(), 10), "+inf").Result()
	return int(n), err
}

// redisDown reports an error worth falling back to Postgres for; a caller's
// cancelled context is not one.
func redisDown(ctx context.Context, err error) bool {
	return err != nil && ctx.Err() == nil
}
