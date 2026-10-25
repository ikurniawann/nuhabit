# Entering real data

How the team loads the gym's own data before go-live, in which order, and
how the seeded demo content comes out again. Every dataset below has an
"Impor CSV" button on its dashboard page next to the create button, with a
template download. The same rules apply to rows typed in by hand.

## How an import works

1. Download the template from the dialog (`Unduh template CSV`) and fill it
   in Excel or Google Sheets. Keep the header row as it is; column order
   does not matter and the label (`Jenis kelas`) is accepted as well as the
   key (`jenis_kelas`). Save as CSV (UTF-8) or XLSX, at most 2,000 rows.
2. Drop the file on the dialog. The server validates every row without
   writing anything (a dry run inside a rolled-back transaction) and shows
   the preview: each row as `Baru`, `Diperbarui`, `Tidak berubah` or
   `Gagal` with the row number and the reason.
3. `Terapkan` runs the same file for real. Failed rows are skipped, the
   rest commit together, and one row goes to `audit.audit_log`
   (action `import`, entity the dataset, counts in `after`).

Imports are idempotent: every dataset has a natural key, so the same file
can be imported again after a correction. Matching rows with the same
values report `Tidak berubah`; changed ones are updated in place; nothing
is duplicated. Each import needs the `create` action of the menu that owns
the data, the same grant as the create button.

Cell conventions: dates are `YYYY-MM-DD` (Excel date cells work too),
times `HH:MM`, yes/no cells take `ya`/`tidak` (also `true`/`false`, `1`/`0`),
rupiah amounts accept `1500000`, `1.500.000` or `Rp 1.500.000`, and lists
are separated by `;` (commas are for the CSV).

## Order of entry

Later datasets reference earlier ones by code or name, so load them in this
order. The dashboard page and menu grant are listed for each.

| # | Dataset | Page | Template | Natural key |
|---|---|---|---|---|
| 1 | Companies and branches | Pengaturan > Bisnis (form, no import) | | branch code |
| 2 | Departments | Master > Departemen (`hris.master`) | `template-departemen.csv` | `kode` |
| 3 | Positions | Master > Jabatan (`hris.master`) | `template-jabatan.csv` | `jabatan` |
| 4 | Users (login accounts) | Pengaturan > Manajemen User (form, no import) | | email |
| 5 | Employees | Karyawan (`hris.kepegawaian`) | `template-karyawan.csv` | `email`, then `nip` |
| 6 | Class types | Gym > Jenis Kelas (`gym.class-types`) | `template-jenis-kelas.csv` | `nama` |
| 7 | Coaches | Gym > Coach (`gym.coaches`) | `template-coach.csv` | `nama` |
| 8 | Schedule templates | Gym > Template Jadwal (`gym.schedule`) | `template-jadwal-mingguan.csv` | class type + branch + weekday + start time |
| 9 | Packages | Gym > Paket Kredit (`gym.packages`) | `template-paket.csv` | `nama` |
| 10 | Members | Gym > Member (`gym.members`) | `template-member.csv` | `telepon`, then `email` |

Branches are referenced by their code (Pengaturan > Bisnis), class types,
coaches, positions and departments by name or code, users and employees by
email. A row that names something that does not exist yet fails with
`tidak ditemukan` and the name, so import the earlier dataset first.

### 2. Departments: `kode, nama, deskripsi, aktif`

`kode` is uppercased and must be unique. `aktif` defaults to `ya`.

### 3. Positions: `jabatan, departemen, level, aktif`

`departemen` is a department name or code already imported (default
`Operations`). `level` is one of Staff, Senior Staff, Supervisor, Assistant
Manager, Manager, Senior Manager, General Manager, Director, C-Level
(default Staff). Department heads are positions with a managerial level
whose employee is the `atasan_email` of the others; the org chart reads
that reporting line.

### 5. Employees: `nama, email, nip, telepon, tanggal_bergabung, status_kepegawaian, departemen, jabatan, atasan_email, email_user, aktif`

`nip` left blank gets the automatic `EMP-<year>-NNNNN`.
`status_kepegawaian` is a code from Master > Status Kepegawaian (default
`permanent`; any code is accepted while that list is empty). `departemen`
is a department code, `jabatan` a position title. `atasan_email` is the
email of the direct manager, who must be in an earlier row or already
exist: import managers first, or run the file twice. `email_user` links
the employee to the login account with that email, which is what the ESS
menus, Kelas Saya and payroll use.

### 6. Class types: `nama, deskripsi, durasi_menit, biaya_kredit, kapasitas, warna, status`

Duration 15 to 240 minutes, credit cost 1 to 20, capacity 1 to 200. `warna`
is one of lime, info, warning, danger, success, ink. `status` is `active`
or `archived`.

### 7. Coaches: `nama, bio, spesialisasi, cabang, email_user, status`

`cabang` is a branch code (empty: all branches). `email_user` is the email
of the coach's staff account; it turns on the Kelas Saya menu for that
account and lets coach incentives post to payroll (the account's employee
record is matched by the same user). `status` is `active` or `inactive`.

### 8. Schedule templates: `jenis_kelas, cabang, hari, jam_mulai, durasi_menit, coach, kapasitas, biaya_kredit, berlaku_mulai, berlaku_sampai, area, aktif`

One row per weekly slot. `hari` is Senin to Minggu (or 1 to 7),
`jam_mulai` is in the branch time zone. Blank `durasi_menit`, `kapasitas`
and `biaya_kredit` take the class type defaults. `berlaku_mulai` defaults
to today; `berlaku_sampai` empty means open-ended. After the import, press
`Generate sekarang` on the page (or wait for the hourly job) to create the
sessions up to the schedule horizon.

### 9. Packages: `nama, jenis, kredit, masa_berlaku_hari, harga, harga_cabang, cabang, jenis_kelas, termasuk_pt, publik, batas_beli_per_member, badge, deskripsi, urutan`

`jenis` is `credits` (needs `kredit` 1 to 1000) or `pass` (unlimited
booking, `kredit` empty). `masa_berlaku_hari` counts from the purchase.
`harga` is the base price; `harga_cabang` overrides it per branch as
`KODE=harga` items separated by `;`. `cabang` restricts the sale to one
branch. `jenis_kelas` lists the class types the package pays for
(empty: all). `termasuk_pt` is for passes that also cover PT sessions.
`publik` `tidak` hides the package from the member app and the site.

### 10. Members: `nama, telepon, email, tanggal_bergabung, saldo_kredit, kredit_berlaku_sampai, paket_pass, pass_berakhir, catatan`

Members are registered the way the front desk does it, with a CRM
profile, without the WhatsApp verification. `telepon` is the WhatsApp
number (08xx or 62xx). `tanggal_bergabung` is stored for new members only.

Opening balances: `saldo_kredit` writes the credits a member still has
from the old records as one adjustment lot, note `Saldo awal (impor)` plus
`catatan`, expiring on `kredit_berlaku_sampai` (default: the
`creditExpiryDays` rule). `paket_pass` plus `pass_berakhir` give the member
a running pass of that pass package (by name) ending that day, without a
purchase. Both are written once per member: a second import reports
`saldo awal sudah dicatat` or `pass aktif sudah ada` and changes nothing.
Opening balances carry no money, so they never touch the journals; the
deferred revenue of packages sold before go-live is a separate step, see
[GYM_OPENING_BALANCE.md](GYM_OPENING_BALANCE.md).

## Demo data

A fresh database carries demo content from the migrations (the class types
HYROX Fundamentals, Engine Builder, Strength Circuit, Race Simulation,
Mobility & Recovery, Personal Training and Small Group PT; the coaches
Kevin Hartono, Maya Kusuma, Rizky Ramadhan and Tara Widjaja; the packages
Trial Class, Starter 5, 10 Visit Pack, 20 Visit Pack, Race Prep Block,
PT 1 Sesi, PT 10 Sesi and the four passes; two weeks of sessions and the
weekly templates behind them) and, when `site-demo.sql` ran, the branches
DEMO-SENOPATI and DEMO-CANGGU, the class types Station, Engine and Race
Sim, twelve "Demo Booker" customers with their bookings, and the demo
articles and events.

```
cd backend
go run ./cmd/demo-data -remove -dry-run   # list what would be removed and what stays, write nothing
go run ./cmd/demo-data -remove            # delete the untouched demo rows
go run ./cmd/demo-data -add               # load the demo set into a fresh database for walkthroughs
```

Target: `DATABASE_URL` (shell env, then `.env.local`, then `.env`). A
remote target needs `-allow-remote` or `ALLOW_REMOTE_DB=1`.

`-remove` only deletes a demo row when nothing outside the demo set still
references it, checked through every foreign key in the database. A demo
session with a real booking stays, and with it its class type, coach and
template; a package someone bought stays; a session a staff member
created with a demo class type keeps that class type. The dry run lists
every kept row with the reason (`masih dirujuk gym.bookings (3 baris)`).
Kept rows can be archived from the dashboard later. Reference data the
migrations seed for the gym (exercises, the default incentive scheme, the
race events, the global business rules) is configuration, not demo
content, and stays.

`-add` is idempotent and is meant for a database that only has the
migrations: it recreates the demo catalog, weekly templates for the oldest
active branch, and runs `database/seeders/site-demo.sql` for the public
branches, sessions and site content. Press `Generate sekarang` on Template
Jadwal afterwards.

## Akses demo

`cmd/demo-users` creates one account per seeded role for internal
walkthroughs and resets their passwords on every run:

```
cd backend
go run ./cmd/demo-users                             # generates a password per account
DEMO_USERS_PASSWORD=<one password> go run ./cmd/demo-users   # one shared password
```

Generated passwords are written to `backend/.demo-users.local`
(`email<TAB>password`, mode 0600, git-ignored); the command prints the
path and never the passwords. With `DEMO_USERS_PASSWORD` set nothing is
written. Re-running resets every password and ends the accounts' open
sessions. A remote target needs `-allow-remote` or `ALLOW_REMOTE_DB=1`.

| Account | Role | Sees |
|---|---|---|
| `demo-super_admin@nuhabit.test` | super_admin | Every menu. The role is created with every menu when the IAM admin seeder has not run. |
| `demo-admin@nuhabit.test` | admin | Every menu (needs `database/seeders/iam-admin-permissions.sql`; skipped until the role exists). |
| `demo-gym_manager@nuhabit.test` | gym_manager | Every Gym & Kelas menu with every action: schedule, templates, sessions, bookings, check-in, class types, coaches, packages, credits, rules, members, reports, PT, incentives, gate devices; plus the employee area (ESS). |
| `demo-gym_front_desk@nuhabit.test` | gym_front_desk | Check-in, bookings, sessions and schedule (read), credits (read and sell), plus ESS. |
| `demo-gym_coach@nuhabit.test` | gym_coach | Kelas Saya (own sessions, roster, attendance), check-in, plus ESS. Linked to the employee `DEMO-COACH` (with an active salary, so a paid coach incentive reaches payroll) and to the coach row `Demo Coach`, so Kelas Saya lists the sessions assigned to that coach. |
| `demo-marketing@nuhabit.test` | marketing | Promo: campaigns, promo codes, vouchers; plus ESS. |
| `demo-investor@nuhabit.test` | investor | Created only when an `investor` role exists in `iam.roles`; otherwise skipped. |
| `demo-member@nuhabit.test` | member app | Signs in to the member app with the WhatsApp number `081200000999` or the email and the password. |

The configuration.users `role` column of these accounts is a legacy label
(`pos`, `pos_supervisor`, `direksi`); their access comes from
`iam.user_roles`, like every account the dashboard creates.
