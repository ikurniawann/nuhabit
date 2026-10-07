package adapters

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Notifier ports the WhatsApp sends of the POS sale on platform/whatsapp:
// sendWhatsAppText, the owner's comp alert (lib/wa/comp-notification.ts),
// the large-void alert (notifications-sender.ts) and the gift card code
// message (lib/giftcard/gift-card-wa.ts). It runs on the pool, outside any
// sale transaction, like the TS.
type Notifier struct {
	db  database.Querier
	log *slog.Logger
	now func() time.Time
	wa  *whatsapp.Client
}

var _ ports.Notifier = (*Notifier)(nil)

// NewNotifier reads provider credentials from the process environment.
func NewNotifier(db database.Querier, log *slog.Logger, now func() time.Time) *Notifier {
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	return &Notifier{db: db, log: log, now: now, wa: whatsapp.New(log)}
}

// SendText is sendWhatsAppText: dispatch, then log to crm.wa_messages.
func (n *Notifier) SendText(ctx context.Context, target, message, messageType, sentByUserID string) ports.Delivery {
	res := n.wa.SendText(ctx, n.db, target, message, messageType, sentByUserID)
	return ports.Delivery{OK: res.Success, Reason: res.Reason}
}

// NotifyComp is notifyCompTransaction: one gateway message to the owner per
// comp (dedup 'komplimen'), the claim released on a clear failure.
func (n *Notifier) NotifyComp(ctx context.Context, c ports.CompNotice) {
	var name *string
	if c.CustomerID != nil && *c.CustomerID != "" {
		_ = n.db.QueryRow(ctx, `SELECT name FROM pos.pos_customers WHERE id = $1`, *c.CustomerID).Scan(&name)
	}
	message := buildCompNotifMessage(c, name, n.now())
	id, err := whatsapp.Claim(ctx, n.db, "komplimen", compDedupKey(c), message, []string{compNotifTarget})
	if err != nil {
		n.log.Error("[wa-comp] notifikasi komplimen error", "error", err.Error())
		return
	}
	if id == "" {
		return // already sent
	}
	gateway := n.wa.LoadGateway(ctx, n.db)
	if gateway == nil {
		n.log.Warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati")
		_ = whatsapp.Release(ctx, n.db, id)
		return
	}
	if res := gateway.SendText(ctx, compNotifTarget, message); !res.Success && !res.TimedOut {
		n.log.Error("[wa-comp] gagal kirim ke " + compNotifTarget + ": " + res.Reason)
		_ = whatsapp.Release(ctx, n.db, id)
	}
}

// NotifyLargeVoid is step 5 of the void route: when the voided total
// reaches wa_notif_config.voidThresholdRp, sendOwnerNotification('voidBesar').
func (n *Notifier) NotifyLargeVoid(ctx context.Context, v ports.VoidNotice) {
	cfg, err := whatsapp.LoadNotifConfig(ctx, n.db)
	if err != nil {
		n.log.Error("[wa-notif] gagal menyiapkan notif void", "error", err.Error())
		return
	}
	if v.Total < cfg.VoidThresholdRp {
		return
	}
	orderNumber := v.OrderNumber
	if orderNumber == "" {
		orderNumber = sliceUTF16(v.OrderID, 8)
	}
	message := buildVoidBesarMessage(orderNumber, v.Total, v.Reason, v.SupervisorName)
	if err := n.wa.SendOwnerNotification(ctx, n.db, "voidBesar", v.OrderID, message, &cfg); err != nil {
		n.log.Error("[wa-notif] voidBesar gagal terkirim", "error", err.Error())
	}
}

// NotifyGiftCardsSold is sendGiftCardSoldWa (gateway only, best-effort).
func (n *Notifier) NotifyGiftCardsSold(ctx context.Context, g ports.GiftCardsSoldNotice) {
	if g.BuyerPhone == "" || len(g.Cards) == 0 {
		return
	}
	gateway := n.wa.LoadGateway(ctx, n.db)
	if gateway == nil {
		n.log.Error("[giftcard] WA gateway belum dikonfigurasi — kode tidak terkirim")
		return
	}
	if res := gateway.SendText(ctx, g.BuyerPhone, buildGiftCardSoldMessage(g.BuyerName, g.Cards)); !res.Success {
		n.log.Error("[giftcard] kirim WA gagal: " + res.Reason)
	}
}
