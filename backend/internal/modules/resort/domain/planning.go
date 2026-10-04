package domain

import (
	"fmt"

	"nuhabit/backend/internal/platform/jsmath"
)

// Refusal is a business rejection with the HTTP status the TS ApiError
// carries (404, 409 or 400).
type Refusal struct {
	Status  int
	Message string
}

func (r *Refusal) Error() string { return r.Message }

// RoomType is a loadRoomTypes row, in SELECT order.
type RoomType struct {
	ID               string   `json:"id"`
	Code             string   `json:"code"`
	Name             string   `json:"name"`
	Description      *string  `json:"description"`
	Zone             *string  `json:"zone"`
	CapacityAdults   int      `json:"capacity_adults"`
	CapacityChildren int      `json:"capacity_children"`
	ExtraBedCapacity int      `json:"extra_bed_capacity"`
	RateWeekday      float64  `json:"rate_weekday"`
	RateWeekend      float64  `json:"rate_weekend"`
	ExtraBedRate     float64  `json:"extra_bed_rate"`
	Amenities        []string `json:"amenities"`
	IsActive         bool     `json:"is_active"`
	SortOrder        int      `json:"sort_order"`
	RoomCount        int      `json:"room_count"`
}

func (t RoomType) rate() RoomTypeRate {
	return RoomTypeRate{ID: t.ID, RateWeekday: t.RateWeekday, RateWeekend: t.RateWeekend, ExtraBedRate: t.ExtraBedRate}
}

// Booked is a BookedRow: one room line of a reservation that still holds
// stock in the range.
type Booked struct {
	RoomTypeID string
	RoomID     *string
	CheckIn    string
	CheckOut   string
}

// UnitRoom is an active, sellable room.
type UnitRoom struct {
	ID         string
	Code       string
	Name       string
	RoomTypeID string
	Status     string
}

// NightUse is one per_night entry.
type NightUse struct {
	Date      string `json:"date"`
	Rooms     int    `json:"rooms"`
	Booked    int    `json:"booked"`
	Available int    `json:"available"`
}

// FreeRoom is one free_rooms entry.
type FreeRoom struct {
	ID     string `json:"id"`
	Code   string `json:"code"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// TypeAvailability is one summarizeAvailability entry: the type row
// followed by its availability and a one-room quote.
type TypeAvailability struct {
	RoomType
	RoomsTotal int        `json:"rooms_total"`
	Available  int        `json:"available"`
	PerNight   []NightUse `json:"per_night"`
	FreeRooms  []FreeRoom `json:"free_rooms"`
	Quote      StayQuote  `json:"quote"`
}

// SummarizeAvailability is summarizeAvailability: units, rooms used per
// night, the minimum left over the stay, free rooms and a one-room quote.
func SummarizeAvailability(types []RoomType, rooms []UnitRoom, booked []Booked, seasons []RateSeason, checkIn, checkOut string) []TypeAvailability {
	nights := EachNight(checkIn, checkOut)
	busy := map[string]bool{}
	for _, b := range booked {
		if b.RoomID != nil && *b.RoomID != "" {
			busy[*b.RoomID] = true
		}
	}
	out := make([]TypeAvailability, 0, len(types))
	for _, t := range types {
		var units []UnitRoom
		for _, r := range rooms {
			if r.RoomTypeID == t.ID {
				units = append(units, r)
			}
		}
		perNight := make([]NightUse, len(nights))
		available := len(units)
		for i, date := range nights {
			used := 0
			for _, b := range booked {
				if b.RoomTypeID == t.ID && date >= b.CheckIn && date < b.CheckOut {
					used++
				}
			}
			perNight[i] = NightUse{Date: date, Rooms: len(units), Booked: used, Available: max(0, len(units)-used)}
			if i == 0 || perNight[i].Available < available {
				available = perNight[i].Available
			}
		}
		free := []FreeRoom{}
		for _, r := range units {
			if !busy[r.ID] {
				free = append(free, FreeRoom{ID: r.ID, Code: r.Code, Name: r.Name, Status: r.Status})
			}
		}
		out = append(out, TypeAvailability{
			RoomType: t, RoomsTotal: len(units), Available: available, PerNight: perNight, FreeRooms: free,
			Quote: QuoteStay(t.rate(), checkIn, checkOut, 0, seasons),
		})
	}
	return out
}

// RoomRequest is one rooms[] entry of the create body.
type RoomRequest struct {
	RoomTypeID string
	Qty        int
	ExtraBed   int
	GuestName  *string
	RoomID     *string
}

// Line is one reservation_rooms row to insert (one per unit).
type Line struct {
	TypeID    string
	TypeName  string
	ExtraBed  int
	GuestName *string
	RoomID    *string
	Quote     StayQuote
}

// Plan is planReservation's result.
type Plan struct {
	Lines      []Line
	RoomTotal  float64
	ExtraTotal float64
	Total      float64
	Nights     int
}

// PlanReservation is planReservation: per-type stock (active units minus
// booked must cover the request), the extra bed cap, then one line per
// unit; only the first unit of a request keeps its room_id.
func PlanReservation(rooms []RoomRequest, checkIn, checkOut string, discount float64, types []RoomType, booked []Booked, unitsByType map[string]int, seasons []RateSeason) (*Plan, error) {
	typeByID := make(map[string]RoomType, len(types))
	for _, t := range types {
		typeByID[t.ID] = t
	}
	p := &Plan{Lines: []Line{}}
	for _, req := range rooms {
		t, ok := typeByID[req.RoomTypeID]
		if !ok {
			return nil, &Refusal{404, "Tipe kamar tidak ditemukan atau tidak aktif"}
		}
		already := 0
		for _, b := range booked {
			if b.RoomTypeID == req.RoomTypeID {
				already++
			}
		}
		requested := 0
		for _, r := range rooms {
			if r.RoomTypeID == req.RoomTypeID {
				requested += r.Qty
			}
		}
		total := unitsByType[req.RoomTypeID]
		if already+requested > total {
			return nil, &Refusal{409, fmt.Sprintf("%s: sisa %d kamar untuk tanggal tersebut, diminta %d", t.Name, max(0, total-already), requested)}
		}
		if req.ExtraBed > t.ExtraBedCapacity {
			return nil, &Refusal{400, fmt.Sprintf("%s: maksimal %d extra bed per kamar", t.Name, t.ExtraBedCapacity)}
		}
		quote := QuoteStay(t.rate(), checkIn, checkOut, req.ExtraBed, seasons)
		for i := range req.Qty {
			line := Line{TypeID: req.RoomTypeID, TypeName: t.Name, ExtraBed: req.ExtraBed, GuestName: req.GuestName, Quote: quote}
			if i == 0 {
				line.RoomID = req.RoomID
			}
			p.Lines = append(p.Lines, line)
		}
	}
	for _, l := range p.Lines {
		p.RoomTotal += l.Quote.RoomSubtotal
	}
	for _, l := range p.Lines {
		p.ExtraTotal += l.Quote.ExtraBedTotal
	}
	p.Total = max(0, p.RoomTotal+p.ExtraTotal-discount)
	if len(p.Lines) > 0 {
		p.Nights = p.Lines[0].Quote.Nights
	}
	return p, nil
}

// NightlyAverage is the reservation_rooms.nightly_rate snapshot.
func (l Line) NightlyAverage() float64 {
	if l.Quote.Nights == 0 {
		return 0
	}
	return jsmath.Round(l.Quote.RoomSubtotal / float64(l.Quote.Nights))
}

// Occupancy is occupancySummary.
type Occupancy struct {
	RoomsTotal   int     `json:"rooms_total"`
	Occupied     int     `json:"occupied"`
	Vacant       int     `json:"vacant"`
	OccupancyPct float64 `json:"occupancy_pct"`
	Arrivals     int     `json:"arrivals"`
	Departures   int     `json:"departures"`
}

// OccupancySummary is occupancySummary: a room is occupied when a
// checked-in guest holds it; the percentage keeps one decimal.
func OccupancySummary(roomsTotal, occupied, arrivals, departures int) Occupancy {
	pct := 0.0
	if roomsTotal > 0 {
		pct = jsmath.Round(float64(float64(occupied)/float64(roomsTotal)*1000)) / 10
	}
	return Occupancy{RoomsTotal: roomsTotal, Occupied: occupied, Vacant: roomsTotal - occupied, OccupancyPct: pct, Arrivals: arrivals, Departures: departures}
}
