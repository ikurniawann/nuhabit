package app

import (
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/platform/module"
)

// stored-value: ARK Coin wallet, top-ups, member bills, member cards and
// refunds, gift cards, promo codes and offers.
func init() {
	Register(storedvalue.Name, func(d module.Deps) module.Module {
		return storedvalue.New(d, storedValuePorts(d))
	})
}
