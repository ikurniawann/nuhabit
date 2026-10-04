package app

import (
	"nuhabit/backend/internal/modules/crm/members"
	"nuhabit/backend/internal/platform/module"
)

// crmMembersPorts wires the CRM members area's ports to its stopgap SQL
// adapters until pos-sales and stored-value expose these reads.
func crmMembersPorts(d module.Deps) members.Ports {
	_ = d
	return members.Ports{Orders: members.OrdersSQL{}, Wallet: members.WalletSQL{}}
}
