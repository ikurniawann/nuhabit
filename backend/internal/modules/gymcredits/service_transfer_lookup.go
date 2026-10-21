package gymcredits

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/memberportal/domain"
)

// Receiver lookup for member transfers. The typed number and the stored
// numbers are both read as 62... digits (the member portal registration
// normaliser), so 08..., +62... and 62... with spaces or dashes compare
// equal. An exact match wins; failing that, one member whose number ends
// in the same nine digits is accepted, more than one is ambiguous.

const (
	transferPhoneInvalid   = "Nomor HP penerima tidak valid"
	transferPhoneNotFound  = "Tidak ada member dengan nomor HP itu"
	transferPhoneAmbiguous = "Nomor HP penerima ambigu: beberapa member punya 9 digit akhir yang sama. Masukkan nomor lengkap."
)

const phoneTailDigits = 9

// phoneTail is the last nine digits of a normalised number.
func phoneTail(digits string) string {
	if len(digits) <= phoneTailDigits {
		return digits
	}
	return digits[len(digits)-phoneTailDigits:]
}

// pickTransferReceiver chooses the receiver among hits for the typed
// phone; the error names the problem.
func pickTransferReceiver(hits []MemberSummary, phone string) (string, error) {
	want := domain.NormalizePhoneDigits(phone)
	if want == "" {
		return "", fail(http.StatusBadRequest, transferPhoneInvalid)
	}
	var tailMatches []string
	for _, h := range hits {
		got := domain.NormalizePhoneDigits(h.Phone)
		switch {
		case got == "":
		case got == want:
			return h.ID, nil
		case phoneTail(got) == phoneTail(want):
			tailMatches = append(tailMatches, h.ID)
		}
	}
	switch len(tailMatches) {
	case 0:
		return "", fail(http.StatusNotFound, transferPhoneNotFound)
	case 1:
		return tailMatches[0], nil
	}
	return "", fail(http.StatusConflict, transferPhoneAmbiguous)
}

// findTransferReceiver resolves the member with that phone number.
func (s *Service) findTransferReceiver(ctx context.Context, phone string) (string, error) {
	want := domain.NormalizePhoneDigits(phone)
	if want == "" {
		return "", fail(http.StatusBadRequest, transferPhoneInvalid)
	}
	hits, err := s.ports.Members.Search(ctx, s.db, phoneTail(want), 20)
	if err != nil {
		return "", err
	}
	return pickTransferReceiver(hits, phone)
}
