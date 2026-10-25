package app

import "nuhabit/backend/internal/modules/gymcare"

// gym-care: member flags, the PAR-Q health declaration and coach session notes.
func init() {
	Register(gymcare.Name, gymcare.New)
}
