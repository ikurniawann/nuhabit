package domain

import (
	"time"
	"unicode/utf8"
)

// Assessment is one fitness assessment of a member. Nil metrics were not
// measured. Benchmark times are in seconds.
type Assessment struct {
	AssessedOn string // YYYY-MM-DD in the coach's zone (Jakarta without a coach)

	WeightKg     *float64
	BodyFatPct   *float64
	MuscleMassKg *float64
	RestingHR    *int

	Run1kmSec          *int
	Ski1kmSec          *int
	Row1kmSec          *int
	WallBallsMaxReps   *int
	SledPushSec        *int
	SledPullSec        *int
	BurpeeBroadJumpSec *int

	Notes string
	Goals string
}

const (
	NotesMax = 2000
	GoalsMax = 1000
)

type floatRange struct {
	value    *float64
	min, max float64
	label    string
}

type intRange struct {
	value    *int
	min, max int
	label    string
}

// Problem is the first thing wrong with the assessment, "" when it is
// valid. today is the current local date: an assessment cannot be dated later.
func (a Assessment) Problem(today string) string {
	on, err := time.Parse(time.DateOnly, a.AssessedOn)
	if err != nil || on.Year() < 2000 {
		return "Tanggal asesmen tidak valid"
	}
	if a.AssessedOn > today {
		return "Tanggal asesmen tidak boleh di masa depan"
	}
	floats := []floatRange{
		{a.WeightKg, 20, 300, "Berat badan"},
		{a.BodyFatPct, 2, 70, "Lemak tubuh"},
		{a.MuscleMassKg, 5, 150, "Massa otot"},
	}
	ints := []intRange{
		{a.RestingHR, 25, 150, "Denyut nadi istirahat"},
		{a.Run1kmSec, 120, 1800, "Lari 1 km"},
		{a.Ski1kmSec, 120, 1800, "SkiErg 1 km"},
		{a.Row1kmSec, 120, 1800, "Row 1 km"},
		{a.WallBallsMaxReps, 0, 500, "Wall ball"},
		{a.SledPushSec, 10, 1800, "Sled push"},
		{a.SledPullSec, 10, 1800, "Sled pull"},
		{a.BurpeeBroadJumpSec, 30, 1800, "Burpee broad jump"},
	}
	measured := false
	for _, f := range floats {
		if f.value == nil {
			continue
		}
		measured = true
		if *f.value < f.min || *f.value > f.max {
			return f.label + " di luar rentang wajar"
		}
	}
	for _, f := range ints {
		if f.value == nil {
			continue
		}
		measured = true
		if *f.value < f.min || *f.value > f.max {
			return f.label + " di luar rentang wajar"
		}
	}
	if a.WeightKg != nil && a.MuscleMassKg != nil && *a.MuscleMassKg >= *a.WeightKg {
		return "Massa otot harus lebih kecil dari berat badan"
	}
	if !measured {
		return "Isi minimal satu metrik"
	}
	if utf8.RuneCountInString(a.Notes) > NotesMax {
		return "Catatan terlalu panjang"
	}
	if utf8.RuneCountInString(a.Goals) > GoalsMax {
		return "Target terlalu panjang"
	}
	return ""
}
