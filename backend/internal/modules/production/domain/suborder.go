package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// OrderNumberPrefix is PROD-YYYYMM on the server clock (UTC).
func OrderNumberPrefix(now time.Time) string { return "PROD-" + now.UTC().Format("200601") }

// NextOrderNumber is the order number after last (the month's highest):
// PROD-202610-0010 after PROD-202610-0009, -0001 for the first.
func NextOrderNumber(prefix, last string) string {
	next := 1
	if last != "" {
		parts := strings.Split(last, "-")
		if n, err := strconv.ParseFloat(strings.TrimSpace(parts[len(parts)-1]), 64); err == nil && !math.IsInf(n, 0) {
			next = int(n) + 1
		}
	}
	return fmt.Sprintf("%s-%04d", prefix, next)
}

// SubOrderQty is the planned quantity of a sub-order for a shortage:
// rounded up to a multiple of the intermediate recipe's batch size when it
// has one, else to the order quantity scale (3 decimals).
func SubOrderQty(shortage, batchSize float64) float64 {
	if shortage <= 0 {
		return 0
	}
	if batchSize > 0 {
		return jsmath.RoundTo(math.Ceil(jsmath.RoundTo(shortage/batchSize, 9))*batchSize, 3)
	}
	return math.Ceil(jsmath.RoundTo(shortage*1000, 6)) / 1000
}

// Shortage is what an intermediate still lacks: needed minus stock minus
// what open sub-orders will make.
func Shortage(needed, onHand, onSubOrders float64) float64 {
	return RoundQty(math.Max(0, needed-onHand-onSubOrders))
}
