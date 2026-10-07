package domain

import "time"

// RateWindow is RATE_LIMIT_WINDOW in lib/rate-limit.ts: a fixed window that
// resets one minute after its first hit.
const RateWindow = time.Minute
