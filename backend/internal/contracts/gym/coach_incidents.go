package gym

// CoachIncident is an active discipline incident of a coach (no-show,
// short notice leave, late arrival) with the commission deduction rule
// snapshotted when it was recorded. gym-coach-leave owns the rows and reads
// them with gymcoachleave.IncidentsSQL.IncidentsFor(ctx, q, coachID, month);
// a coach commission declares its own port over that method.
type CoachIncident struct {
	ID         string
	Kind       string // no_show, short_notice_leave or late
	OccurredOn string // YYYY-MM-DD
	SessionID  *string
	LeaveID    *string
	// DeductionPercent of the month's commission for this incident.
	DeductionPercent float64
}
