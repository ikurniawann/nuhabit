package app

import (
	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/platform/module"
)

// crm: loyalty, members, engagement, marketing, inbox, sales rules and
// reporting. Ports to other contexts are built in adapters_crm*.go.
func init() {
	Register(crm.Name, func(d module.Deps) module.Module {
		return crm.New(d, crm.Ports{
			Pos:          crmPosReads{},
			Loyalty:      crmLoyaltyPorts(d),
			Members:      crmMembersPorts(d),
			Collectibles: crmCollectiblesPorts(d),
			Marketing:    crmMarketingPorts(d),
			Engagement:   crmEngagementPorts(d),
			Partners:     crmPartnersPorts(d),
			Inbox:        crmInboxPorts(d),
			Reports:      crmReportsPorts(d),
			Advance:      crmAdvancePorts(d),
			Reporting:    crmReportingPorts(d),
		})
	})
}
