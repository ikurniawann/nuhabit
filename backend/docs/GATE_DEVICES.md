# Gym gate devices

A gate device is a turnstile, door reader or kiosk that reads the member QR
code and opens a relay. It talks to the API with its own key instead of a
staff session. The gate pipeline is the same one the front desk uses
(`gymscheduling/checkin.go`): membership, waiver, re-entry and anti-passback,
a class booking inside the check-in window or open gym, then credits.

## Registering a device

Staff manage devices in the dashboard under Gym & Kelas, Perangkat Gate
(menu `gym.gate-devices`):

| Action | Route | Menu action |
| --- | --- | --- |
| List devices | `GET /api/gym/gate-devices` | read |
| Register a device | `POST /api/gym/gate-devices` `{branch_id, name, relay_open_ms?}` | create |
| Rotate the key | `POST /api/gym/gate-devices/{id}/rotate` | update |
| Revoke the device | `POST /api/gym/gate-devices/{id}/revoke` | delete |

Registering and rotating return the key once, as `key`. The server keeps only
its SHA-256 hash and the first characters (`key_prefix`) so staff can tell
keys apart. Rotating replaces the key at once and reactivates a revoked
device. Revoking refuses the device from the next request. Each change writes
an audit row without the key.

A device belongs to one branch. Its scans use that branch's rules (check-in
window, open gym, waiver) and only admit bookings for sessions at that branch
or with no branch.

Keys look like `nhgd_` followed by 48 hex characters. Store the key in the
device's secure storage, never in logs.

## Protocol

Every request is HTTPS, JSON in and out, with the key in a header:

```
X-Gate-Device-Key: nhgd_…
Content-Type: application/json
```

Responses use the API envelope: `{"success": true, "data": …}` or
`{"success": false, "error": "<message>"}`.

### Scan

`POST /api/gym/gate/devices/scan`

```json
{ "token": "nhqr_…" }
```

The token is the text of the member's QR code (8 to 120 characters). It is
single use and short lived; the server consumes it on a decision.

Response:

```json
{
  "success": true,
  "data": {
    "allow": true,
    "decision": "allowed",
    "reason": null,
    "entryKind": "booking",
    "display": "Silakan masuk, Budi",
    "relayOpenMs": 3000,
    "memberName": "Budi Santoso"
  }
}
```

| Field | Meaning |
| --- | --- |
| `allow` | Open the relay when true. |
| `relayOpenMs` | How long to hold the relay open, in milliseconds. 0 when denied. Set per device (500 to 30000, default 3000). |
| `display` | Short Indonesian text for the device screen: a greeting, or `Ditolak: <reason>`. |
| `entryKind` | `booking` (class check-in), `re_entry` (back within the grace period) or `open_gym`. |
| `reason` | Denial code when `allow` is false, see below. |

Denial codes: `token_invalid`, `token_expired`, `token_consumed`,
`member_not_active`, `waiver_required`, `anti_passback`, `no_booking`,
`open_gym_closed`, `insufficient_credits`.

A denial is still HTTP 200: the scan was processed and logged. Every scan is
written to `gym.access_logs` with `source = 'device'` and the device id.

### Heartbeat

`POST /api/gym/gate/devices/heartbeat` with an empty body. Send it every one
to five minutes so the dashboard shows the device as online.

```json
{
  "success": true,
  "data": {
    "deviceId": "…",
    "name": "Turnstile Utama",
    "branchId": "…",
    "branchName": "NüHabit Kemang",
    "relayOpenMs": 3000,
    "serverTime": "2026-10-22T03:00:00.000Z"
  }
}
```

A device can read `relayOpenMs` from the heartbeat, so a change in the
dashboard reaches it without a restart. Scans also count as a sign of life.

### Errors

| Status | When | What the device should do |
| --- | --- | --- |
| 400 | The body is not valid (`Data tidak valid: token`). | Show a read error, keep the relay shut. |
| 401 | The key header is missing or unknown (`Kunci perangkat gate tidak valid`). | Stop scanning and show a setup error until a new key is installed. |
| 403 | The device was revoked (`Perangkat gate sudah dinonaktifkan`). | Same as 401. |
| 429 | Over the rate limit. The `Retry-After` header gives the seconds to wait. | Keep the relay shut, wait, then resume. |
| 5xx | Server or network failure. | Keep the relay shut. Do not retry the same token: it may have been consumed. Ask the member to refresh their QR. |

The relay must stay shut on anything but `allow: true`.

### Rate limits

Each device may send 60 scans and 12 heartbeats per minute. The windows are
fixed, counted per device and per endpoint, and shared by every API replica.

## Rules that affect devices

Gym rules (Aturan Gym), global or per branch:

| Rule | Default | Effect |
| --- | --- | --- |
| `requireWaiver` | true | Members without the current waiver are denied (`waiver_required`). |
| `checkinOpensMinBefore` | 45 | A class booking admits from this many minutes before the start. |
| `checkinClosesMinAfter` | 15 | …until this many minutes after the end. |
| `openGymEnabled` | false | Members without a booking may enter during the branch's open gym hours. |
| `openGymCreditCost` | 1 | Credits charged for the first open gym entry of the WIB day. 0 is free; pass holders never pay. |
| `reEntryGraceMin`, `antiPassbackMin` | 15, 60 | Re-entry and anti-passback, as at the front desk. |

Open gym hours are a weekly table per branch (`GET`/`PUT /api/gym/open-gym-hours`).
A branch with no hours set admits open gym all day.
