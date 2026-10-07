package app

import "nuhabit/backend/internal/modules/gymcredits"

func init() { Register(gymcredits.Name, gymcredits.New) }
