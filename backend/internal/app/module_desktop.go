package app

import "nuhabit/backend/internal/modules/desktop"

// desktop: the NüHabit OS board, its SSE stream, inbox, search, status,
// preferences and the wallpaper list (read-only reporting over other
// contexts' tables, as the TS routes query them).
func init() { Register(desktop.Name, desktop.New) }
