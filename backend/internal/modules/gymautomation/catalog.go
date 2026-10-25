package gymautomation

// Setting is a whole-number job setting staff may change; the job reads it
// from platform.job_settings.config under Key, Default when unset.
type Setting struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Unit    string `json:"unit"`
	Min     int    `json:"min"`
	Max     int    `json:"max"`
	Default int    `json:"default"`
}

// jobInfo is how the page describes a job. Rules are the gym rule keys the
// job follows, edited on the rules page.
type jobInfo struct {
	Label       string
	Description string
	Settings    []Setting
	Rules       []string
}

// AutoCloseJob closes past sessions; AutoCloseGrace is how long after a
// session ends it waits.
const AutoCloseJob = "gym-scheduling.complete-past-sessions"

var AutoCloseGrace = Setting{Key: "graceMinutes", Label: "Masa tenggang setelah kelas berakhir", Unit: "menit", Min: 0, Max: 720, Default: 30}

var catalog = map[string]jobInfo{
	"gym-scheduling.class-reminders": {
		Label: "Pengingat kelas", Description: "Mengirim pengingat ke member yang booking, sekian menit sebelum kelas dimulai.",
		Rules: []string{ruleClassReminder},
	},
	"gym-scheduling.waitlist-offers": {
		Label: "Tawaran waitlist", Description: "Menawarkan kursi yang kosong ke antrean waitlist dan mencabut tawaran yang lewat waktu.",
	},
	"gym-scheduling.generate-from-templates": {
		Label: "Generate jadwal dari template", Description: "Membuat sesi dari template mingguan sampai horizon jadwal, melewati hari libur.",
	},
	AutoCloseJob: {
		Label: "Tutup sesi otomatis", Description: "Menandai sesi yang sudah berakhir sebagai selesai setelah masa tenggang.",
		Settings: []Setting{AutoCloseGrace},
	},
	"gym-coaching.pt-reminders": {
		Label: "Pengingat PT", Description: "Mengirim pengingat sesi personal training ke member.",
		Rules: []string{ruleClassReminder},
	},
	"gym-coaching.complete-past-appointments": {
		Label: "Tutup sesi PT otomatis", Description: "Menandai janji PT yang sudah lewat sebagai selesai.",
	},
	"gym-credits.purchase-reconcile": {
		Label: "Cek pembayaran paket", Description: "Memeriksa pembelian paket yang masih menunggu pembayaran di payment gateway.",
	},
	"gym-credits.reminders": {
		Label: "Pengingat kredit dan pass", Description: "Memberi tahu member saat kredit menipis, kredit akan kedaluwarsa, atau pass hampir berakhir.",
		Rules: []string{ruleLowBalance, ruleExpiryReminder},
	},
	"gym-credits.pass-renewals": {
		Label: "Perpanjangan pass otomatis", Description: "Menagih perpanjangan pass yang auto-renew dan mencoba ulang tagihan yang gagal.",
	},
	"gym-credits.pass-unfreeze": {
		Label: "Akhiri pembekuan pass", Description: "Mengaktifkan lagi pass yang masa bekunya sudah selesai.",
	},
	"gym-credits.expiry": {
		Label: "Kedaluwarsa kredit", Description: "Menghanguskan kredit yang lewat masa berlaku dan mengakui pendapatannya.",
	},
	"gym-credits.pass-revenue": {
		Label: "Pengakuan pendapatan pass", Description: "Mengakui pendapatan pass per hari dari pendapatan diterima di muka.",
	},
	"member-portal.referral-rewards": {
		Label: "Hadiah referral", Description: "Memberi hadiah referral setelah member yang diajak memenuhi syarat.",
	},
}

// Gym rule keys the reminder jobs follow.
const (
	ruleClassReminder  = "classReminderMinutes"
	ruleLowBalance     = "lowBalanceThreshold"
	ruleExpiryReminder = "expiryReminderDays"
)

// RuleLink is a gym rule a job follows, with its current global value.
type RuleLink struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value int    `json:"value"`
	Unit  string `json:"unit"`
}

func ruleLinks(r Rules, keys []string) []RuleLink {
	out := make([]RuleLink, 0, len(keys))
	for _, k := range keys {
		switch k {
		case ruleClassReminder:
			out = append(out, RuleLink{Key: k, Label: "Pengingat sebelum kelas", Value: r.ClassReminderMinutes, Unit: "menit"})
		case ruleLowBalance:
			out = append(out, RuleLink{Key: k, Label: "Batas kredit menipis", Value: r.LowBalanceThreshold, Unit: "kredit"})
		case ruleExpiryReminder:
			out = append(out, RuleLink{Key: k, Label: "Pengingat sebelum kedaluwarsa", Value: r.ExpiryReminderDays, Unit: "hari"})
		}
	}
	return out
}
