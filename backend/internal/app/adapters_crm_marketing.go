package app

import (
	"context"

	"nuhabit/backend/internal/modules/crm/marketing"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/promo"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// crmMarketingPorts wires the CRM marketing area's ports: vouchers through
// stored-value's promo service, settings and the sales funnel through
// stopgap SQL adapters.
func crmMarketingPorts(d module.Deps) marketing.Ports {
	return marketing.Ports{
		Settings: marketing.AppSettingsSQL{},
		Promo:    crmPromo{svc: storedvalue.NewPromo(d, storedValuePorts(d))},
		Funnel:   marketing.FunnelSQL{},
	}
}

// crmPromo adapts the promo service to the marketing Promo port, on the
// caller's Querier (a campaign start's transaction).
type crmPromo struct{ svc *promo.Service }

var _ marketing.Promo = crmPromo{}

func (p crmPromo) IssueCode(ctx context.Context, q database.Querier, companyID, branchID, promoCampaignID, code string) (bool, error) {
	return p.svc.IssueVoucher(ctx, q, companyID, branchID, promoCampaignID, code)
}

func (p crmPromo) BatchConversion(ctx context.Context, q database.Querier, codes []string) (marketing.Conversion, error) {
	count, value, err := p.svc.VoucherConversion(ctx, q, codes)
	return marketing.Conversion{Count: count, Value: value}, err
}

func (p crmPromo) PublicConversion(ctx context.Context, q database.Querier, promoCampaignID string, phones []string) (marketing.Conversion, error) {
	count, value, err := p.svc.PhoneConversion(ctx, q, promoCampaignID, phones)
	return marketing.Conversion{Count: count, Value: value}, err
}
