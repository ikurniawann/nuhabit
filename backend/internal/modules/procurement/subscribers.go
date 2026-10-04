package procurement

import (
	"context"

	"github.com/jackc/pgx/v5"

	accounting "nuhabit/backend/internal/contracts/accounting"
	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscribe registers the procurement handlers: accounting's voided AP
// payments, and the owner WhatsApp alert for urgent PRs (owner
// notifications are not in a porting wave, so procurement delivers its own
// alert through the OwnerNotifier port).
func Subscribe(bus *outbox.Bus, ports Ports) {
	if bus == nil {
		return
	}
	bus.Subscribe(accounting.TopicApPaymentVoided, "procurement.void-vendor-payment", voidVendorPayment)
	if ports.Owner != nil {
		bus.Subscribe(contracts.TopicPurchaseRequestUrgent, "procurement.pr-urgent-owner-whatsapp", urgentPrAlert(ports))
	}
}

// urgentPrAlert is notifyPrMendesak: build the alert and send it once per
// PR and status (the dedup key).
func urgentPrAlert(ports Ports) outbox.Handler {
	return func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
		var p contracts.PurchaseRequestUrgent
		if err := e.Decode(&p); err != nil {
			return err
		}
		if !domain.IsUrgentPriority(p.Priority) {
			return nil
		}
		var department *string
		if p.DepartmentID != nil && *p.DepartmentID != "" {
			names, err := ports.Directory.DepartmentNames(ctx, tx, []string{*p.DepartmentID})
			if err != nil {
				return err
			}
			if name, ok := names[*p.DepartmentID]; ok {
				department = &name
			}
		}
		items := make([]domain.UrgentPrItem, len(p.Items))
		for i, it := range p.Items {
			items[i] = domain.UrgentPrItem{Description: it.Description, Qty: it.Qty, Unit: it.Unit}
		}
		msg := domain.BuildPrMendesakMessage(domain.UrgentPr{PrNumber: p.PrNumber, Status: p.Status, RequesterName: p.RequesterName,
			DepartmentName: department, TotalAmount: p.TotalAmount, RequiredDate: p.RequiredDate, Notes: p.Notes, Items: items})
		return ports.Owner.Notify(ctx, tx, "prMendesak", p.DedupKey, msg)
	}
}

// voidVendorPayment voids the purchasing.vendor_payments row linked to a
// voided AP payment, as lib/purchasing/ap-void.ts did inline, so the
// sync_purchase_order_payment_term trigger recalculates the PO term. A
// payment that is already void is left alone (idempotent).
func voidVendorPayment(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var p accounting.ApPaymentVoided
	if err := e.Decode(&p); err != nil {
		return err
	}
	if p.VendorPaymentID == "" {
		return nil
	}
	var actor *string
	if p.UserID != "" {
		actor = &p.UserID
	}
	_, err := tx.Exec(ctx, `UPDATE purchasing.vendor_payments
		SET status = 'void', voided_at = now(), voided_by = $2, void_reason = $3, updated_at = now(), updated_by = $2
		WHERE id = $1 AND status <> 'void'`, p.VendorPaymentID, actor, p.Reason)
	return err
}
