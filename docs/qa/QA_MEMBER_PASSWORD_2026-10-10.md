# QA: Member password login, password management, staff reset

Date: 10 October 2026
Tester: Claude Code (browser pane, 375 px and desktop)
Environment: local, Go API on 8190 with `OTP_ENABLED=true`, Next on 3100 with `NEXT_PUBLIC_OTP_ENABLED=true`, database `nuhabit` on port 55432
Branch: `feat/member-password-login` (PR #4 into `main`)
Status: all three flows pass

## Setup

- A fresh database: migrations, then the seeders `business-hierarchy`, `business-stalls`, `hris-master-data`, `iam-menus`, `iam-admin-permissions`, `iam-role-permissions`, then `scripts/create-local-super-user.js`.
- `MEMBER_OTP_DEV_CODE` set in `frontend/.env.local` and passed to the Go API, so the OTP steps accept the dev code without a WhatsApp gateway.
- Test member: phone `081277700421`, registered during flow 1. Staff: the local super user.

## Flow 1: register, set a password, sign in

| Step | Action | Expected | Result |
|---|---|---|---|
| 1 | Open `/member/auth/login` | English form: WhatsApp number or email, password, "Forgot password?", "Sign in with a WhatsApp code" (flag on), "Create your membership" | Pass |
| 2 | `/member/auth/register`: email, phone, "Send verification code" | Step 2 shows "Local dev: no code needed" | Pass |
| 3 | Verify, fill personal data, emergency contact, accept the waiver, "Create my membership" | `POST /register/otp` and `POST /register` return 200; home opens | Pass |
| 4 | Home | "Secure your account" card with "Set a password" and "Not now" (member has no password yet) | Pass |
| 5 | Settings, Password section | "Set a password" form without a current-password field | Pass |
| 6 | Save a password that meets the rule (8 to 72 chars, a letter and a digit) | `PUT /api/member-portal/password` 200, "Password saved.", section switches to "Change password" | Pass |
| 7 | Sign out, sign in with the phone and a wrong password | 401, "Incorrect username or password" | Pass |
| 8 | Sign in with the right password | 200, home opens, no "Secure your account" card | Pass |

## Flow 2: forgot password

| Step | Action | Expected | Result |
|---|---|---|---|
| 1 | `/member/auth/forgot`, enter the phone, "Send reset code" | `POST /password/forgot` 200; "If that account exists, a code is on its way to WhatsApp 0812*****421." | Pass |
| 2 | Enter the dev code and a new password, "Reset password" | `POST /password/reset` 200; "Password updated. Sign in with your new password." | Pass (after fix) |
| 3 | Sign in with the old password | 401 | Pass |
| 4 | Sign in with the new password | 200, home opens | Pass |

Two defects found in step 2 and fixed on the branch: the code field stripped every non-digit, and the Go endpoint validated the code format before the dev bypass. Production codes are six digits, so only local testing was affected.

## Flow 3: staff reset

| Step | Action | Expected | Result |
|---|---|---|---|
| 1 | Sign in to `/login` as the super user, open the member in CRM (`/dashboard/crm/members/pos-<customer id>`) | Member detail with "Reset password portal" | Pass |
| 2 | Click it | Dialog explains the old password stops working and all sessions end | Pass |
| 3 | "Tampilkan password" | `POST /api/crm/members/{id}/password` 200; a 10-character password shown once with a copy button | Pass |
| 4 | Sign in as the member with the shown password | 200 | Pass |
| 5 | Sign in with the member's previous password | 401 | Pass |

Not exercised: "Kirim via WhatsApp" (no gateway locally; covered by the Go integration test with a fake port).

## Automated coverage

- Go: `internal/modules/memberportal` (login by `08`, `62` and email forms, same 401 bodies, 403 without a password, shared per-account limit, app token, password change with and without the current password, session revocation, forgot and reset with the flag on and off) and `internal/modules/crm/members` (one-time password, sessions, audit row, IAM denial, WhatsApp fake and failed send).
- Vitest: `use-member-login`, `forgot-steps`, `password-rules`, `join-steps`.

## Gaps

- No browser end-to-end test runs these flows automatically; a Playwright suite against the Go API would close that.
- The dashboard IAM gate on the "Reset password portal" button is the `crm.members` menu prefix; the server enforces the `update` action.
