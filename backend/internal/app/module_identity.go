package app

import "nuhabit/backend/internal/modules/identity"

func init() { Register(identity.Name, identity.New) }
