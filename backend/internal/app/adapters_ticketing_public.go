package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/modules/ticketing"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// ticketingPublicPorts wires the public booking flow: the Xendit invoice
// client, the stored-value promo service (preview, hold inside the booking
// transaction, capture on PAID) and the venue name from
// configuration.branches.
func ticketingPublicPorts(d module.Deps) ticketing.PublicPorts {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	return ticketing.PublicPorts{
		Payments: ticketingPayments{newXenditInvoices(os.Getenv, log)},
		Promo:    ticketingPromo{storedvalue.NewPromo(d, storedValuePorts(d))},
		Branches: branches.Service{},
	}
}

type ticketingPayments struct{ x xenditInvoices }

func (p ticketingPayments) Configured() bool { return p.x.configured() }

func (p ticketingPayments) ValidWebhookToken(token string) bool { return p.x.validWebhookToken(token) }

func (p ticketingPayments) CreateInvoice(ctx context.Context, in ticketing.InvoiceRequest) (ticketing.Invoice, error) {
	inv, err := p.x.create(ctx, in.ExternalID, in.Amount, in.PayerName, in.Description, in.RedirectURL)
	return ticketing.Invoice{ID: inv.id, URL: inv.url, ExpiresAt: inv.expiresAt}, err
}

// ticketingPromo adapts the stored-value promo service.
type ticketingPromo struct{ s *promo.Service }

func (t ticketingPromo) Preview(ctx context.Context, q database.Querier, in ticketing.PromoCheck) (ticketing.PromoPreview, error) {
	p, err := t.s.PreviewPromoCode(ctx, q, promo.PreviewInput{
		Scope: promo.VenueScope{CompanyID: in.CompanyID, BranchID: in.BranchID}, Code: in.Code, Channel: in.Channel,
		Subtotal: in.Subtotal, Phone: in.Phone,
	})
	return ticketing.PromoPreview{OK: p.OK, Discount: p.Discount, CampaignName: p.CampaignName, DiscountType: p.DiscountType,
		Reason: string(p.Reason), Message: p.Message}, err
}

func (t ticketingPromo) Hold(ctx context.Context, q database.Querier, in ticketing.PromoCheck, contextType, contextID string) (float64, error) {
	hold, err := t.s.HoldPromoRedemption(ctx, q, promo.HoldInput{
		Scope: promo.VenueScope{CompanyID: in.CompanyID, BranchID: in.BranchID}, Code: in.Code, Channel: in.Channel,
		ContextType: contextType, ContextID: contextID, Subtotal: in.Subtotal, Phone: in.Phone,
	})
	if rej, ok := errors.AsType[*promo.PromoRejectedError](err); ok {
		return 0, httpx.Status(http.StatusUnprocessableEntity, rej.Error())
	}
	return hold.Discount, err
}

func (t ticketingPromo) Capture(ctx context.Context, q database.Querier, contextType, contextID string) error {
	_, err := t.s.CapturePromoRedemption(ctx, q, contextType, contextID)
	return err
}
