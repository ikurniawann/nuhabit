package app

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/inbox"
	inboxdomain "nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/partners"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/settings"
	"nuhabit/backend/internal/modules/integrations/webhooks"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Ports of the integrations module's settings pages and webhooks. The CRM
// inbox (crm.wa_messages, conversations, CS rules) is reached through its
// exported inbox.Gateway; gym purchases through gymcredits; the other
// pending payments and the flash report are reads of pos-sales and
// stored-value tables ported from the TS.

// crmInboxGateway is the CRM inbox service on the shared WhatsApp client.
func crmInboxGateway(d module.Deps) inbox.Gateway {
	return inbox.Gateway{WhatsApp: &inbox.WhatsAppGateway{Client: whatsapp.New(d.Log)}, Log: d.Log,
		BrandName: domain.BrandName(os.Getenv("NEXT_PUBLIC_APP_NAME"))}
}

func integrationsSettingsPorts(d module.Deps) settings.Ports {
	return settings.Ports{Messages: integrationsMessageLog{inbox: crmInboxGateway(d)}, Flash: integrationsFlashSQL{}}
}

func integrationsWebhookPorts(d module.Deps) webhooks.Ports {
	return webhooks.Ports{
		Payments: integrationsPayments{deps: d},
		Inbox:    integrationsInbox{gw: crmInboxGateway(d)},
		Partners: integrationsPartners{events: partners.NewEvents(crm.NewEngine(d, crmPosReads{}))},
	}
}

/* ── WhatsApp message log (crm.wa_messages) ──────────────────────────── */

type integrationsMessageLog struct{ inbox inbox.Gateway }

var _ settings.MessageLog = integrationsMessageLog{}

func (integrationsMessageLog) List(ctx context.Context, q database.Querier, f settings.MessageFilter) ([]settings.MessageRow, settings.MessageSummary, error) {
	var args []any
	var where []string
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.Direction == "in" || f.Direction == "out" {
		add("m.direction = $%d", f.Direction)
	}
	if f.Type != "" && f.Type != "all" {
		add("m.message_type = $%d", f.Type)
	}
	if f.Status != "" && f.Status != "all" {
		add("m.status = $%d", f.Status)
	}
	if f.Search != "" {
		pattern := "%" + strings.NewReplacer("%", "", "_", "").Replace(f.Search) + "%"
		args = append(args, pattern)
		where = append(where, fmt.Sprintf("(m.phone LIKE $%d OR c.name ILIKE $%d)", len(args), len(args)))
	}
	filter := ""
	if len(where) > 0 {
		filter = "WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, f.Limit)
	rows, err := q.Query(ctx, `SELECT m.id::text, m.direction, m.message_type, m.phone, m.body, m.media_type,
            m.status, m.provider, m.provider_message_id, m.error_reason,
            m.wa_from_me, m.created_at, c.name
       FROM crm.wa_messages m
       LEFT JOIN pos.pos_customers c ON c.id = m.customer_id
      `+filter+`
      ORDER BY m.created_at DESC
      LIMIT $`+fmt.Sprint(len(args))+`::text::bigint`, args...)
	if err != nil {
		return nil, settings.MessageSummary{}, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (settings.MessageRow, error) {
		var m settings.MessageRow
		var created *time.Time
		err := row.Scan(&m.ID, &m.Direction, &m.MessageType, &m.Phone, &m.Body, &m.MediaType, &m.Status, &m.Provider,
			&m.ProviderMessageID, &m.ErrorReason, &m.WaFromMe, &created, &m.CustomerName)
		m.CreatedAt = httpx.NewJSTime(created)
		return m, err
	})
	if err != nil {
		return nil, settings.MessageSummary{}, err
	}
	if list == nil {
		list = []settings.MessageRow{}
	}
	var s settings.MessageSummary
	err = q.QueryRow(ctx, `SELECT COUNT(*) FILTER (WHERE direction = 'out')::int,
            COUNT(*) FILTER (WHERE direction = 'in')::int,
            COUNT(*) FILTER (WHERE status = 'failed')::int
       FROM crm.wa_messages`).Scan(&s.TotalOut, &s.TotalIn, &s.TotalFailed)
	return list, s, err
}

func (integrationsMessageLog) Outbound(ctx context.Context, q database.Querier, id string) (*settings.OutboundMessage, error) {
	var m settings.OutboundMessage
	err := q.QueryRow(ctx, `SELECT id::text, phone, body, message_type, status, conversation_id::text
       FROM crm.wa_messages WHERE id = $1 AND direction = 'out'`, id).
		Scan(&m.ID, &m.Phone, &m.Body, &m.MessageType, &m.Status, &m.ConversationID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &m, err
}

func (l integrationsMessageLog) Resend(ctx context.Context, db database.DB, m settings.OutboundMessage, sentByUserID string) settings.SendResult {
	res := l.inbox.SendText(ctx, db, strOrEmpty(m.Phone), strOrEmpty(m.Body), m.MessageType, sentByUserID, strOrEmpty(m.ConversationID))
	return settings.SendResult{Success: res.Success, Reason: res.Reason, MessageID: res.MessageID}
}

func (integrationsMessageLog) MarkResent(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_messages
        SET status = 'sent', error_reason = 'Dikirim ulang manual — lihat baris terbaru'
      WHERE id = $1`, id)
	return err
}

/* ── Daily Flash Report (pos-sales orders) ───────────────────────────── */

type integrationsFlashSQL struct{}

var _ settings.FlashReports = integrationsFlashSQL{}

// flashPaid is PAID_FILTER of lib/wa/flash-report.ts.
const flashPaid = `o.payment_status = 'paid'
  AND o.status NOT IN ('cancelled', 'voided', 'merged')
  AND o.ordered_at >= $1 AND o.ordered_at < $2`

// Gather is gatherFlashReportData.
func (integrationsFlashSQL) Gather(ctx context.Context, q database.Querier, dateWib string) (domain.FlashReportData, error) {
	var d domain.FlashReportData
	start, end, err := domain.WibDayRange(dateWib)
	if err != nil {
		return d, err
	}
	err = q.QueryRow(ctx, `SELECT COALESCE(SUM(o.subtotal), 0)::float8, COALESCE(SUM(o.discount_amount), 0)::float8,
            COALESCE(SUM(o.total_amount), 0)::float8,
            COUNT(*) FILTER (WHERE c.member_type = 'card')::float8,
            COUNT(*) FILTER (WHERE o.subtotal > 0 AND o.discount_amount >= o.subtotal)::float8,
            COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'kol_comp'), 0)::float8,
            COUNT(*) FILTER (WHERE o.comp_type = 'kol_comp')::float8,
            COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'owner_comp'), 0)::float8,
            COUNT(*) FILTER (WHERE o.comp_type = 'owner_comp')::float8,
            COALESCE(SUM(o.subtotal) FILTER (WHERE o.comp_type = 'foc_comp'), 0)::float8,
            COUNT(*) FILTER (WHERE o.comp_type = 'foc_comp')::float8,
            COALESCE(SUM(COALESCE(NULLIF(o.guest_count, 0), 1)), 0)::float8
       FROM pos.pos_orders o
       LEFT JOIN pos.pos_customers c ON c.id = o.customer_id
      WHERE `+flashPaid, start, end).Scan(&d.Revenue, &d.Discount, &d.NettSales, &d.CitizenCardTx, &d.FullDiscountTx,
		&d.KolCompIdr, &d.KolCompTx, &d.OwnerCompIdr, &d.OwnerCompTx, &d.FocCompIdr, &d.FocCompTx, &d.GuestCount)
	if err != nil {
		return d, err
	}
	var first, last *time.Time
	if err := q.QueryRow(ctx, `SELECT MIN(o.ordered_at), MAX(o.ordered_at) FROM pos.pos_orders o WHERE `+flashPaid, start, end).
		Scan(&first, &last); err != nil {
		return d, err
	}
	if first != nil && last != nil {
		hours := domain.ClockLabel(*first) + "–" + domain.ClockLabel(*last) + " WIB"
		d.OperationHour = &hours
	}
	lines := func(sql, fallback string, args ...any) ([]domain.FlashLine, error) {
		rows, err := q.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.FlashLine, error) {
			var l domain.FlashLine
			var name *string
			err := row.Scan(&name, &l.Revenue, &l.Pcs)
			l.Name = strOrEmpty(name)
			if l.Name == "" {
				l.Name = fallback
			}
			return l, err
		})
	}
	sold, err := lines(`SELECT w.name, COALESCE(SUM(oi.total_amount), 0)::float8, COALESCE(SUM(oi.quantity), 0)::float8
       FROM pos.pos_order_items oi
       JOIN pos.pos_orders o ON o.id = oi.order_id
       LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
      WHERE `+flashPaid+` GROUP BY w.name`, "Tanpa stall", start, end)
	if err != nil {
		return d, err
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT w.name
       FROM pos.pos_products pp
       JOIN item.products ip ON ip.id = pp.source_product_id
       JOIN configuration.warehouses w ON w.id = ip.warehouse_id
      WHERE pp.is_active`)
	if err != nil {
		return d, err
	}
	stalls, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return d, err
	}
	d.ByStall = flashStalls(stalls, sold)
	if d.ByCategory, err = lines(`SELECT cat.name, COALESCE(SUM(oi.total_amount), 0)::float8, COALESCE(SUM(oi.quantity), 0)::float8
       FROM pos.pos_order_items oi
       JOIN pos.pos_orders o ON o.id = oi.order_id
       LEFT JOIN pos.pos_products p ON p.id = oi.product_id
       LEFT JOIN pos.pos_categories cat ON cat.id = p.category_id
      WHERE `+flashPaid+` GROUP BY cat.name ORDER BY 2 DESC`, "Tanpa kategori", start, end); err != nil {
		return d, err
	}
	d.TopProducts, err = lines(`SELECT oi.product_name, 0::float8, COALESCE(SUM(oi.quantity), 0)::float8
       FROM pos.pos_order_items oi
       JOIN pos.pos_orders o ON o.id = oi.order_id
      WHERE `+flashPaid+` GROUP BY oi.product_name ORDER BY 3 DESC LIMIT 5`, "", start, end)
	return d, err
}

// flashStalls lists every stall with POS products (Rp 0 when it sold
// nothing) plus any other stall that sold, by revenue descending.
func flashStalls(all []string, sold []domain.FlashLine) []domain.FlashLine {
	byName := map[string]domain.FlashLine{}
	names := all
	for _, s := range sold {
		byName[s.Name] = s
		names = append(names, s.Name)
	}
	seen := map[string]bool{}
	out := []domain.FlashLine{}
	for _, n := range names {
		if !seen[n] {
			seen[n] = true
			out = append(out, domain.FlashLine{Name: n, Revenue: byName[n].Revenue, Pcs: byName[n].Pcs})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Revenue > out[j].Revenue })
	return out
}

// strOrEmpty is `value ?? ""`.
func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

/* ── pending payments (gym, stored-value, pos-sales) ─────────────────── */

type integrationsPayments struct{ deps module.Deps }

var _ webhooks.Payments = integrationsPayments{}

func (integrationsPayments) IsGymPurchaseReference(ref string) bool {
	return gymcredits.IsGymPurchaseReference(ref)
}

// pending reads one (id, amount) row; nil when none or more than one, as
// the TS .maybeSingle() yields no data for either.
func pending(ctx context.Context, q database.Querier, sql string, args ...any) (*webhooks.Pending, error) {
	rows, err := q.Query(ctx, sql+" LIMIT 2", args...)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, pgx.RowToStructByPos[webhooks.Pending])
	if err != nil || len(found) != 1 {
		return nil, err
	}
	return &found[0], nil
}

func (integrationsPayments) GymPurchase(ctx context.Context, q database.Querier, ref string) (*webhooks.Pending, error) {
	return pending(ctx, q, `SELECT id::text, total_idr::text FROM gym.credit_purchases WHERE external_id = $1`, ref)
}

// SettleGymPurchase runs gym-credits' settlement on the caller's database
// handle: the webhook answers with its result.
func (p integrationsPayments) SettleGymPurchase(ctx context.Context, db database.DB, ref string, paymentID *string) (any, error) {
	return gymcredits.NewDefaultService(p.deps, db).SettleByReference(ctx, ref, paymentID)
}

func (integrationsPayments) Topup(ctx context.Context, q database.Querier, column, value string) (*webhooks.Pending, error) {
	if column != "xendit_transaction_id" && column != "reference_id" {
		return nil, fmt.Errorf("integrations: unknown top-up column %q", column)
	}
	return pending(ctx, q, `SELECT id::text, COALESCE(amount::text, '') FROM pos.pos_wallet_transactions
		WHERE `+column+` = $1 AND type = 'topup'`, value)
}

func (integrationsPayments) Checkout(ctx context.Context, q database.Querier, ref string) (*webhooks.Pending, error) {
	return pending(ctx, q, `SELECT id::text, COALESCE(total_amount::text, '') FROM pos.pos_checkouts WHERE xendit_external_id = $1`, ref)
}

func (integrationsPayments) CheckoutChildren(ctx context.Context, q database.Querier, checkoutID string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT COUNT(*)::int FROM pos.pos_orders WHERE checkout_id = $1`, checkoutID).Scan(&n)
	return n, err
}

func (integrationsPayments) Order(ctx context.Context, q database.Querier, ref string) (*webhooks.Pending, error) {
	return pending(ctx, q, `SELECT id::text, COALESCE(total_amount::text, '') FROM pos.pos_orders WHERE xendit_external_id = $1`, ref)
}

/* ── CRM inbox ───────────────────────────────────────────────────────── */

type integrationsInbox struct{ gw inbox.Gateway }

var _ webhooks.Inbox = integrationsInbox{}

func (i integrationsInbox) Record(ctx context.Context, db database.DB, m domain.GatewayInbound) (bool, string, error) {
	return i.gw.Record(ctx, db, inboxdomain.Inbound{
		Channel: m.Channel, ExternalID: m.ExternalID, Phone: m.Phone, Direction: m.Direction, Body: m.Body,
		MediaType: m.MediaType, ProviderMessageID: m.ProviderMessageID, PushName: m.PushName, SentAt: m.SentAt,
	})
}

func (i integrationsInbox) OnInbound(ctx context.Context, db database.DB, conversationID string, body *string, at time.Time) (*string, error) {
	out, err := i.gw.OnInboundMessage(ctx, db, conversationID, body, at)
	return out.AutoReplyText, err
}

func (i integrationsInbox) AutoReply(ctx context.Context, db database.DB, phone, conversationID, text string) {
	i.gw.SendText(ctx, db, phone, text, "system", "", conversationID)
}

/* ── CRM loyalty partners ────────────────────────────────────────────── */

// integrationsPartners is the CRM partners' event service.
type integrationsPartners struct{ events partners.Events }

var _ webhooks.Partners = integrationsPartners{}

func (a integrationsPartners) FindByCode(ctx context.Context, q database.Querier, code string) (*webhooks.Partner, error) {
	p, err := a.events.FindPartner(ctx, q, code)
	if p == nil || err != nil {
		return nil, err
	}
	return &webhooks.Partner{ID: p.ID, IsActive: p.IsActive, SigningSecret: p.SigningSecret}, nil
}

func (a integrationsPartners) Ingest(ctx context.Context, db database.DB, p webhooks.Partner, e webhooks.PartnerEvent) (webhooks.PartnerEventResult, error) {
	r, err := a.events.Ingest(ctx, db, p.ID, partners.Event{
		ExternalID: e.ExternalID, EventType: e.EventType, Subject: e.Subject, OccurredAt: e.OccurredAt, Payload: e.Payload,
	})
	return webhooks.PartnerEventResult{ID: r.ID, Status: r.Status, XPAwarded: r.XPAwarded, Duplicate: r.Duplicate}, err
}
