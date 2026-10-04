package app

import "nuhabit/backend/internal/modules/athlete"

func init() { Register(athlete.Name, athlete.New) }
