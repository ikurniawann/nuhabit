package app

import (
	"context"
	"errors"

	"nuhabit/backend/internal/modules/crm/members"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmMembersPorts wires the CRM members area's ports: stopgap SQL adapters
// for the order and wallet reads until pos-sales and stored-value expose
// them, and the WhatsApp provider for password resets.
func crmMembersPorts(d module.Deps) members.Ports {
	return members.Ports{
		Orders:   members.OrdersSQL{},
		Wallet:   members.WalletSQL{},
		WhatsApp: passwordWhatsApp{client: whatsapp.New(d.Log)},
	}
}

// passwordWhatsApp sends a member's reset password as a WhatsApp text,
// logged to crm.wa_messages under the staff member who reset it.
type passwordWhatsApp struct{ client *whatsapp.Client }

func (p passwordWhatsApp) SendText(ctx context.Context, q database.Querier, target, message, sentByUserID string) error {
	res := p.client.SendText(ctx, q, target, message, "member_password", sentByUserID)
	if !res.Success {
		return errors.New(res.Reason)
	}
	return nil
}
