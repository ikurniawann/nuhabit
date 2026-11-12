/**
 * Prefix menu IAM untuk gate API/halaman.
 * Role baru yang di-grant menu di bawah prefix ini lolos tanpa ubah kode.
 */
export const IAM = {
  dashboard: ["dashboard"],
  ess: ["ess"],
  items: ["items"],
  itemsPurchasing: ["items.product.purchasing", "items.raw-material.purchasing"],
  itemsInventory: ["items.product.inventory", "items.raw-material.inventory"],
  itemsApproval: ["items.product.approval", "items.raw-material.approval"],
  itemsReports: ["items.reports"],
  /** Items → Produksi: langkah produksi, WIP dan biaya batch (/api/production). */
  itemsProduction: ["items.product.production", "items.raw-material.production"],
  /** Items → sub-modul per jenis item; API Items memadukan grup ini per rute. */
  itemsProductMaster: ["items.product.master"],
  itemsRawMaterialMaster: ["items.raw-material.master"],
  itemsGeneralMaster: ["items.general.master"],
  itemsProductPurchasing: ["items.product.purchasing"],
  itemsRawMaterialPurchasing: ["items.raw-material.purchasing"],
  /** Items General → Pembelian (PR, PO, penerimaan, invoice, persetujuan PR/PO). */
  itemsGeneralPurchasing: ["items.general.purchasing"],
  itemsProductInventory: ["items.product.inventory"],
  itemsRawMaterialInventory: ["items.raw-material.inventory"],
  itemsGeneralInventory: ["items.general.inventory"],
  /** Accounting → Hutang Usaha: membuka detail PO, termin dan pembayaran vendor. */
  itemsPayables: ["accounting.accounts-payable"],
  pos: ["pos"],
  posOperations: ["pos.operations", "pos.cashier.central"],
  /** POS → Operasional → Tagihan (tagihan member, 2026-10-01). */
  posMemberBills: ["pos.operations.member-bills"],
  posCatalog: ["pos.catalog"],
  posKitchen: ["pos.kitchen"],
  posLoyalty: ["pos.loyalty"],
  posReports: ["pos.reports"],
  posSupervisors: ["pos.settings.supervisors"],
  /** POS → halaman kasir (tablet, klasik, restoran, kasir pusat). */
  posCashier: [
    "pos.operations.cashier",
    "pos.operations.cashier-classic",
    "pos.operations.restaurant",
    "pos.cashier.central",
  ],
  hris: ["hris"],
  hrisKepegawaian: ["hris.kepegawaian"],
  hrisWorkforce: ["hris.workforce"],
  hrisCompensation: ["hris.compensation"],
  hrisPerformance: ["hris.performance"],
  hrisRecruitment: ["hris.recruitment"],
  accounting: ["accounting"],
  /**
   * Accounting per sub-modul (kode menu daun). Guard API memakai kode halaman
   * yang memanggilnya; href induk (Overview, Payable, Receivable, Cash & Bank,
   * Fiscal Years) ikut menutup halaman di bawah path-nya.
   */
  accountingOverview: ["accounting.dashboard.overview"],
  accountingCoa: ["accounting.master.chart-of-accounts"],
  accountingAccountTypes: ["accounting.master.account-types"],
  accountingJournalMappings: ["accounting.master.journal-mappings"],
  accountingJournalEntries: ["accounting.ledger.journal-entries"],
  accountingJournalHistory: ["accounting.ledger.journal-history"],
  accountingGeneralLedger: ["accounting.ledger.general-ledger"],
  accountingSubsidiary: ["accounting.ledger.subsidiary"],
  accountingTrialBalance: ["accounting.ledger.trial-balance"],
  accountingCashBank: ["accounting.cash-bank.accounts"],
  accountingCashIn: ["accounting.cash-bank.cash-in"],
  accountingCashOut: ["accounting.cash-bank.cash-out"],
  accountingCashTransfer: ["accounting.cash-bank.transfer"],
  accountingAr: ["accounting.receivable.list"],
  accountingArInvoices: ["accounting.receivable.invoices"],
  accountingArInvoicesB2b: ["accounting.receivable.invoices-b2b"],
  accountingArReceipts: ["accounting.receivable.receipts"],
  accountingArAging: ["accounting.receivable.aging"],
  accountingAp: ["accounting.accounts-payable.payable"],
  accountingApInvoices: ["accounting.accounts-payable.invoices"],
  accountingApPayments: ["accounting.accounts-payable.payments"],
  accountingApAging: ["accounting.accounts-payable.aging"],
  accountingFiscalYears: ["accounting.period.fiscal-years"],
  accountingBeginningBalance: ["accounting.period.beginning-balance"],
  accountingPeriods: ["accounting.period.accounting-period"],
  accountingClosing: ["accounting.period.closing"],
  accountingBalanceSheet: ["accounting.reports.balance-sheet"],
  accountingIncomeStatement: ["accounting.reports.income-statement"],
  accountingCashFlow: ["accounting.reports.cash-flow"],
  /** Form bahan baku memilih akun COA (lookup GET chart-of-accounts). */
  accountingCoaItemReaders: ["items.raw-material.master.materials"],
  crm: ["crm"],
  crmSettings: ["crm.settings"],
  crmMembers: ["crm.members"],
  crmInbox: ["crm.members.inbox"],
  crmReviews: ["crm.members.reviews"],
  crmLoyalty: ["crm.loyalty"],
  crmReports: ["crm.reports"],
  crmPromo: ["crm.promo", "promo"],
  /** CRM → Engagement: pengumuman, event, challenge, check-in (port NüHabit). */
  crmEngagement: ["crm.engagement"],
  /** CRM → Customer Care → Ulasan Member (ulasan order dari portal). */
  crmMemberReviews: ["crm.members.member-reviews"],
  /** CRM → Loyalty → Partner Loyalty (event eksternal bertanda tangan). */
  crmPartners: ["crm.loyalty.partners"],
  /*
   * CRM per sub-modul: satu key per menu daun, plus key gabungan untuk
   * lookup yang dipanggil beberapa halaman CRM.
   */
  crmDashboard: ["crm.overview.dashboard"],
  crmMemberList: ["crm.members.list"],
  /** Cari member: halaman Members dan klaim redemption di Rewards. */
  crmMemberLookup: ["crm.members.list", "crm.loyalty.rewards"],
  crmRewards: ["crm.loyalty.rewards"],
  /** Katalog reward dan riwayat redemption: Rewards dan detail member. */
  crmRewardsRead: ["crm.loyalty.rewards", "crm.members.list"],
  crmAvatars: ["crm.loyalty.avatars"],
  /** Katalog avatar: halaman Avatars dan inventori di detail member. */
  crmAvatarsRead: ["crm.loyalty.avatars", "crm.members.list"],
  crmBadges: ["crm.badges"],
  crmWallpapers: ["crm.wallpapers"],
  /** Unggah gambar koleksi: Avatars, Badges, Wallpapers. */
  crmCollectibleUpload: ["crm.loyalty.avatars", "crm.badges", "crm.wallpapers"],
  /** Daftar tier: semua halaman CRM yang memilih tier. */
  crmTiersRead: [
    "crm.members.list",
    "crm.loyalty.rewards",
    "crm.loyalty.avatars",
    "crm.wallpapers",
    "crm.engagement.announcements",
    "crm.settings.config",
  ],
  /** Pengaturan CRM: konfigurasi, tier, aturan XP, template inbox. */
  crmSettingsConfig: ["crm.settings.config"],
  crmApprovalRules: ["crm.settings.approvals"],
  crmWorkflows: ["crm.settings.workflows"],
  crmScoring: ["crm.settings.scoring"],
  crmCustomFields: ["crm.settings.custom-fields"],
  /** Inbox approval diskon quotation (halaman Sales Funnel → Approval). */
  crmApprovalInbox: ["sales-funnel.approvals"],
  crmAnnouncements: ["crm.engagement.announcements"],
  crmChallenges: ["crm.engagement.challenges"],
  crmCheckins: ["crm.engagement.checkins"],
  crmEvents: ["crm.engagement.events"],
  /** Analisis AI percakapan: Inbox dan Laporan CRM. */
  crmInboxAnalyze: ["crm.members.inbox", "crm.reports.overview"],
  crmCampaigns: ["crm.campaigns"],
  crmSegments: ["crm.marketing.segments"],
  /** Daftar segmen: halaman Segmen dan pemilih segmen di Campaign. */
  crmSegmentsRead: ["crm.marketing.segments", "crm.campaigns"],
  crmForms: ["crm.marketing.forms"],
  crmReportsOverview: ["crm.reports.overview"],
  crmReportBuilder: ["crm.reports.builder"],
  /** Jalankan definisi report: Report Builder dan Atribusi. */
  crmReportRun: ["crm.reports.builder", "crm.marketing.attribution"],
  /** Daftar report tersimpan: Builder, Dashboard, Jadwal. */
  crmSavedReports: ["crm.reports.builder", "crm.reports.dashboards", "crm.reports.schedules"],
  crmReportDashboards: ["crm.reports.dashboards"],
  crmReportSchedules: ["crm.reports.schedules"],
  settings: ["settings"],
  settingsUsers: ["settings.users"],
  settingsRoles: ["settings.roles"],
  settingsMenus: ["settings.menus"],
  settingsBusiness: ["settings.business"],
  settingsIntegrations: ["settings.integrations"],
  settingsAppearance: ["settings.appearance"],
  settingsPaymentGateways: ["settings.payment-gateways"],
  settingsWaGateway: ["settings.wa_gateway"],
  /** Settings → Audit Trail (jejak audit server-side). */
  settingsAudit: ["settings.audit"],
  /** Settings → Notifikasi WA (penerima, ambang, alert order). */
  settingsWaNotifications: ["settings.wa_notifications"],
  /** Settings → Pengiriman (kurir dan origin toko online). */
  settingsShipping: ["settings.shipping"],
  shop: ["shop"],
  /** Toko Online per sub-modul: pesanan (dan ulasan), storefront, mitra wholesale, marketplace. */
  shopOrders: ["shop.orders"],
  shopSettings: ["shop.settings"],
  shopWholesale: ["shop.wholesale"],
  shopMarketplace: ["shop.marketplace"],
  ticketing: ["ticketing"],
  ticketingAdmin: [
    "ticketing.settings",
    "ticketing.tickets",
    "ticketing.channel-manager",
    "ticketing.mapping",
  ],
  ticketingOperator: [
    "ticketing.loket",
    "ticketing.gate",
    "ticketing.booking",
    "ticketing.gate_pass",
    "ticketing.passes",
  ],
  ticketingReports: ["ticketing.reports"],
  salesFunnel: ["sales-funnel"],
  promo: ["promo", "crm.promo"],
  dataroom: ["dataroom"],
  resort: ["resort"],
  /** Resort per sub-modul: Front Office, Reservasi, Kamar & Tipe. */
  resortFrontOffice: ["resort.front-office"],
  resortReservations: ["resort.reservations"],
  resortRooms: ["resort.rooms"],
  /** Sales funnel per sub-modul (satu halaman dashboard per kode). */
  salesFunnelLeads: ["sales-funnel.leads"],
  salesFunnelPipeline: ["sales-funnel.pipeline"],
  salesFunnelAccounts: ["sales-funnel.accounts"],
  salesFunnelContacts: ["sales-funnel.contacts"],
  salesFunnelFollowups: ["sales-funnel.followups"],
  salesFunnelForecast: ["sales-funnel.forecast"],
  salesFunnelReports: ["sales-funnel.reports"],
  salesFunnelSettings: ["sales-funnel.settings"],
  /** Halaman CRM yang memakai picker owner sales funnel. */
  salesFunnelCrmOwnerPickers: [
    "crm.settings.workflows",
    "crm.settings.approvals",
    "crm.reports.schedules",
    "crm.marketing.forms",
  ],
  /** Halaman CRM yang memakai picker stage sales funnel (workflow rules). */
  salesFunnelCrmStagePickers: ["crm.settings.workflows"],
  /** Ticketing per sub-modul. */
  ticketingBooking: ["ticketing.booking"],
  ticketingLoket: ["ticketing.loket"],
  ticketingGate: ["ticketing.gate"],
  ticketingGatePass: ["ticketing.gate_pass"],
  ticketingPasses: ["ticketing.passes"],
  ticketingTickets: ["ticketing.tickets"],
  ticketingMapping: ["ticketing.mapping"],
  ticketingChannelManager: ["ticketing.channel-manager"],
  ticketingSettings: ["ticketing.settings"],
  /** Kasir POS yang mengecek saldo tab gelang ticketing. */
  ticketingPosTab: [
    "pos.operations.cashier",
    "pos.operations.cashier-classic",
    "pos.operations.restaurant",
    "pos.cashier.central",
  ],
  /** POS → Member → Dompet: paket top-up, koreksi saldo, pembayaran online, aturan saldo. */
  posWallet: ["pos.loyalty.wallet"],
  /** Gym → Stasiun & Latihan (pustaka HYROX + substitusi). */
  gymExercises: ["gym.exercises"],
  /** Gym → Race HYROX (kalender race + peserta). */
  gymRaces: ["gym.races"],
  /** Gym → Insentif Coach (skema, statement, payout). */
  gymIncentives: ["gym.incentives"],
  /** Gym → Paket Kredit (katalog paket kelas). */
  gymPackages: ["gym.packages"],
  /** Gym → Kredit Member (saldo, lot, koreksi, jual paket di front desk). */
  gymCredits: ["gym.credits"],
  /** Gym → Aturan Gym (global + override cabang). */
  gymRules: ["gym.rules"],
  /** Gym → jadwal, sesi & absensi, booking, jenis kelas, coach. */
  gymScheduling: ["gym.schedule", "gym.sessions", "gym.bookings", "gym.class-types", "gym.coaches"],
  /** Gym → Check-in (scan QR front desk; juga dibuka dari Sesi & Absensi). */
  gymCheckin: ["gym.checkin", "gym.sessions"],
  /** Gym → seluruh menu gym (daftar cabang untuk form gym). */
  gym: ["gym"],
  /** Gym → halaman Check-in saja (scan, log akses, cari member di desk, waiver). */
  gymCheckinPage: ["gym.checkin"],
  /** Gym → Template Jadwal (template mingguan, generate sesi). */
  gymScheduleTemplates: ["gym.schedule.templates"],
  /** Gym → halaman yang memilih cabang (GET /api/gym/branches). */
  gymBranchPickers: [
    "gym.schedule",
    "gym.sessions",
    "gym.coaches",
    "gym.checkin",
    "gym.gate-devices",
    "gym.coach-leave",
    "gym.credits",
    "gym.rules",
  ],
  /** Gym → Jadwal Kelas (kalender mingguan, salin minggu). */
  gymSchedule: ["gym.schedule"],
  /** Gym → Sesi & Absensi (roster, check-in manual, no-show, tutup sesi). */
  gymSessions: ["gym.sessions"],
  /** Gym → Booking (daftar booking, batal, booking oleh staf). */
  gymBookings: ["gym.bookings"],
  /** Gym → Jenis Kelas. */
  gymClassTypes: ["gym.class-types"],
  /** Gym → Coach. */
  gymCoaches: ["gym.coaches"],
  /** Gym → Member (daftar member, profil 360, catatan staf, daftar di front desk). */
  gymMembers: ["gym.members"],
  /** Gym → Laporan Gym (kehadiran, okupansi, pendapatan, member, coach). */
  gymReports: ["gym.reports"],
  /** Gym → Kelas Saya (portal coach: kelas, roster, absensi, insentif sendiri). */
  gymMyClasses: ["gym.my-classes"],
  /** Gym → Cuti & Pengganti Coach (antrean Program Director, blackout, disiplin, laporan perubahan). */
  gymCoachLeave: ["gym.coach-leave"],
  /** Gym → Personal Training (janji PT, ketersediaan coach). */
  gymPt: ["gym.pt"],
  /** Gym → Asesmen Kebugaran (metrik tubuh dan benchmark HYROX member). */
  gymAssessments: ["gym.assessments"],
  /** Gym → Perangkat Gate (turnstile per cabang, kunci perangkat). */
  gymGateDevices: ["gym.gate-devices"],
  /** Gym → Referral (pengaturan program, daftar referral, leaderboard). */
  gymReferrals: ["gym.referrals"],
  /** Investor → seluruh portal investor (ringkasan, kinerja, progres, dokumen); hanya baca. */
  investor: ["investor"],
  /** Investor → Update untuk Investor: editor progres yang dikelola direksi. */
  investorUpdates: ["investor.updates"],
  /** Investor per halaman portal; Ringkasan (/dashboard/investor) menutup semua halaman baca. */
  investorOverview: ["investor.overview"],
  investorPerformance: ["investor.performance"],
  investorProgress: ["investor.progress"],
  investorDocuments: ["investor.documents"],
  /** Gym → Keluhan (tiket keluhan member, SLA, eskalasi, laporan). */
  gymComplaints: ["gym.complaints"],
  /** Tugas Saya: daftar tugas sendiri (baca, buat, ubah milik sendiri). */
  tasks: ["tasks"],
  /** Papan tugas departemen untuk manajer; kepala departemen lolos lewat cek modul. */
  tasksTeam: ["tasks.team"],
  /** Tampilan KPI & Tugas per indikator. */
  tasksKpi: ["tasks.kpi"],
  /** Gym → Membership & Progres (tier dari belanja, XP kehadiran, status member). */
  gymLoyalty: ["gym.loyalty"],
  /** Gym → Member Perhatian Khusus (penanda member; read_medical = detail medis). */
  gymMemberFlags: ["gym.member-flags"],
  /** Gym → SOP Coach (dokumen SOP berversi; read_own = baca dan konfirmasi sendiri). */
  gymSop: ["gym.sop"],
  /** Gym → Otomasi & Pengingat (job latar, sakelar, jalankan sekarang, log notifikasi member). */
  gymAutomation: ["gym.automation"],
  /** Gym → News Member (berita, event, tips dan promo di aplikasi member). */
  gymNews: ["gym.news"],
  /** HRIS → Master Data (departemen, jabatan, status kepegawaian). */
  hrisMaster: ["hris.master"],
  /** HRIS → Organisasi (struktur organisasi, seksi). */
  hrisOrganization: ["hris.organization"],
  /** HRIS → Insights (analitik rekrutmen, laporan HR). */
  hrisInsights: ["hris.insights"],
  /*
   * HRIS per sub-modul: satu key per menu daun. Guard API HRIS memakai key ini
   * agar role dengan satu sub-modul tidak bisa memanggil API sub-modul lain.
   */
  /** Kepegawaian → Karyawan (/dashboard/employees: profil, dokumen, kontrak, riwayat). */
  hrisEmployees: ["hris.kepegawaian.users"],
  hrisContracts: ["hris.kepegawaian.contracts"],
  hrisShifts: ["hris.kepegawaian.shifts"],
  hrisHolidays: ["hris.kepegawaian.holidays"],
  hrisLoans: ["hris.kepegawaian.loans"],
  hrisOvertime: ["hris.kepegawaian.overtime"],
  hrisAnnouncements: ["hris.kepegawaian.announcements"],
  hrisAttendance: ["hris.workforce.attendance"],
  hrisLeaves: ["hris.workforce.leaves"],
  hrisOrgChart: ["hris.organization.org-chart"],
  hrisPayroll: ["hris.compensation.payroll"],
  hrisSalary: ["hris.compensation.salary"],
  hrisKpiScorecard: ["hris.performance.kpi-scorecard"],
  hrisKpiConfig: ["hris.performance.kpi-config"],
  /** Pengelola Feedback 360° (siklus, penugasan, persetujuan, hasil). */
  hrisFeedback360: ["hris.performance.feedback-360"],
  hrisCandidates: ["hris.recruitment.candidates"],
  hrisPipeline: ["hris.recruitment.pipeline"],
  hrisPsikotes: ["hris.recruitment.psikotes"],
  hrisTalentPool: ["hris.recruitment.talent-pool"],
  hrisJobPortal: ["hris.recruitment.job-portal"],
  hrisLiveMonitoring: ["hris.recruitment.live-monitoring"],
  hrisAnalytics: ["hris.insights.analytics"],
  hrisReports: ["hris.insights.reports"],
  hrisDepartments: ["hris.master.departments"],
  hrisPositions: ["hris.master.positions"],
  hrisEmploymentStatuses: ["hris.master.employment-statuses"],
  /** Ticketing → Pengaturan memakai pemilih karyawan HRIS (staff pass). */
  hrisPickerTicketing: ["ticketing.settings"],
  /** Tulis katalog produk POS (PATCH produk, SKU merchandise). */
  posCatalogProducts: ["pos.catalog.products"],
  /** Tulis pengaturan ARK & XP (kurs ARK, preset top-up). */
  posLoyaltySettings: ["pos.loyalty.settings"],
  /** Tulis profil Tax & Service (billing kasir). */
  settingsBilling: ["settings.billing"],
  /** Master produk/bahan & resep: halaman Items + POS katalog (picker produk, recipe-builder). */
  itemsCatalog: ["items", "pos.catalog"],
  /** Items → buat PR per modul (general, produk, bahan baku). */
  itemsPr: [
    "items.general.purchasing.pr",
    "items.product.purchasing.pr",
    "items.raw-material.purchasing.pr",
  ],
  /** Situs → Konten, Artikel, Event (site publik). */
  site: ["site"],
  siteContent: ["site.content"],
  siteArticles: ["site.articles"],
  siteEvents: ["site.events"],
  /** Event → Kalender Event: satu kalender untuk event, kelas dan PT. */
  eventsCalendar: ["events.calendar"],
  /** Halaman pengelola event yang memakai dialog kalender (tautan, checklist, tempat). */
  eventsAdmin: ["crm.engagement.events", "site.events"],
  /** Items → approval PR per modul. */
  itemsPrApproval: [
    "items.general.purchasing.approval-pr",
    "items.product.approval.pr",
    "items.raw-material.approval.pr",
  ],
} as const;

export type IamPrefixGroup = (typeof IAM)[keyof typeof IAM];
