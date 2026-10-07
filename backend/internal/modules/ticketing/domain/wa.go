package domain

// WhatsApp texts for paid bookings (booking-wa.ts).

// PaidBooking is what the booking messages show.
type PaidBooking struct {
	BookingCode        string
	AccessToken        string
	VisitDate          string
	CustomerName       string
	Total              float64
	Discount           float64
	GiftRecipientName  *string
	GiftRecipientPhone *string
}

func totalLines(b PaidBooking) string {
	if b.Discount <= 0 {
		return "Total: " + FormatRupiah(b.Total) + "\n\n"
	}
	paid := Round2(b.Total - b.Discount)
	return "Total: " + FormatRupiah(b.Total) + "\n" +
		"Potongan promo: -" + FormatRupiah(b.Discount) + "\n" +
		"Dibayar: " + FormatRupiah(paid) + "\n\n"
}

func statusURL(origin string, b PaidBooking) string {
	return origin + "/booking/status/" + b.AccessToken
}

// BookingPaidMessage is buildBookingPaidMessage.
func BookingPaidMessage(origin string, b PaidBooking) string {
	msg := "*Pembayaran diterima* ✅\n\n" +
		"Kode booking: *" + b.BookingCode + "*\n" +
		"Tanggal kunjungan: " + FormatDateLong(b.VisitDate) + "\n" +
		"Atas nama: " + b.CustomerName + "\n" +
		totalLines(b)
	if b.GiftRecipientName != nil && *b.GiftRecipientName != "" {
		return msg + "E-tiket HADIAH telah dikirim ke WA " + *b.GiftRecipientName + ". " +
			"Link di bawah adalah salinan untukmu:\n" + statusURL(origin, b)
	}
	return msg + "Tunjukkan QR di halaman ini ke petugas loket:\n" + statusURL(origin, b)
}

// BookingGiftMessage is buildBookingGiftMessage.
func BookingGiftMessage(origin string, b PaidBooking) string {
	recipient := ""
	if b.GiftRecipientName != nil {
		recipient = *b.GiftRecipientName
	}
	return "*Kamu menerima hadiah tiket!* 🎁\n\n" +
		"Dari: " + b.CustomerName + "\n" +
		"Untuk: *" + recipient + "*\n" +
		"Kode booking: *" + b.BookingCode + "*\n" +
		"Tanggal kunjungan: " + FormatDateLong(b.VisitDate) + "\n\n" +
		"Tunjukkan QR di halaman ini ke petugas loket:\n" + statusURL(origin, b)
}
