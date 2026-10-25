# Outbound email

Every email the API sends (payslips, member sign-in codes, gym
notifications, dataroom share links and codes, recruitment emails, the test
email) goes through one port, `internal/platform/mail`. The port picks a
provider from Settings → Integrasi → Email, logs each message in
`platform.mail_log` and retries transient failures from the
`integrations.mail-retry` job. Nothing is sent or logged while no provider is
configured; callers get `false` or `mail.ErrNotConfigured`.

Two providers exist:

| Provider | When to use | Transport |
|---|---|---|
| `resend` | A domain verified in Resend (the setup used until now). | HTTPS, `POST https://api.resend.com/emails` with the API key. |
| `microsoft` | The gym's own Microsoft mailbox (Microsoft 365 / Exchange Online, or a personal outlook.com / hotmail.com mailbox). | Microsoft Graph `sendMail` (primary) or SMTP AUTH on `smtp.office365.com:587` (fallback), chosen by the transport setting. |

The provider that will send is shown on the settings page as "Provider
aktif". With the provider set to "Otomatis", Microsoft wins when its
credentials are complete, else Resend when its key is set.

## Settings and env

The settings page writes `configuration.app_settings` (keys below). An
empty stored value falls back to the env variable, and the page lists which
fields currently come from env. Secrets are stored like the other integration
secrets of that table and only ever leave the server masked (first and last
four characters); the UI shows them masked and a masked or empty value on
save keeps the stored one, `null` deletes it.

| Setting key | Env fallback | Meaning |
|---|---|---|
| `mail_provider` | `MAIL_PROVIDER` | `resend`, `microsoft` or empty (automatic). |
| `mail_from_email` | `FROM_EMAIL` | Sender address. For Microsoft this must be the mailbox itself (or an address the mailbox may Send As). |
| `mail_from_name` | `MAIL_FROM_NAME` | Sender display name. |
| `mail_resend_api_key` | `RESEND_API_KEY` | Resend API key. |
| `mail_ms_transport` | `MAIL_MS_TRANSPORT` | `graph` (default) or `smtp`. |
| `mail_ms_tenant_id` | `MS_GRAPH_TENANT_ID` | Entra tenant id (GUID or `contoso.onmicrosoft.com`). |
| `mail_ms_client_id` | `MS_GRAPH_CLIENT_ID` | Application (client) id of the app registration. |
| `mail_ms_client_secret` | `MS_GRAPH_CLIENT_SECRET` | Client secret value (write-only in the UI). |
| `mail_ms_sender` | `MS_GRAPH_SENDER` | Mailbox (user principal name) Graph sends as; defaults to the From address. |
| `mail_smtp_host` | `SMTP_HOST` | `smtp.office365.com` for Microsoft. |
| `mail_smtp_port` | `SMTP_PORT` | `587`. |
| `mail_smtp_user` | `SMTP_USER` | The mailbox address. |
| `mail_smtp_password` | `SMTP_PASSWORD` | The mailbox password or app password (write-only in the UI). |

Per-module sender overrides stay: `PAYROLL_FROM_EMAIL`, `GYM_FROM_EMAIL`,
`DATAROOM_FROM_EMAIL` (each falling back to `FROM_EMAIL`) replace the From
of their emails on Resend. The Microsoft provider always sends from the
configured mailbox, because Exchange Online rejects any other From
(`5.7.60 Client does not have permissions to send as this sender`); the
display name of the override is kept.

The configuration is cached in memory for 30 seconds per process; a save on
the settings page reloads it at once in the API process that served the save.

## Microsoft Graph (primary)

The API sends as an application with the OAuth 2.0 client credentials
grant, then calls `POST /users/{mailbox}/sendMail`. No user signs in and no
password is stored, only the app registration's client secret.

Request shape, from the [user: sendMail reference](https://learn.microsoft.com/graph/api/user-sendmail):

```http
POST https://graph.microsoft.com/v1.0/users/{id | userPrincipalName}/sendMail
Authorization: Bearer {token}
Content-Type: application/json

{
  "message": {
    "subject": "...",
    "body": { "contentType": "HTML", "content": "..." },
    "toRecipients": [{ "emailAddress": { "address": "member@example.com" } }],
    "attachments": [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      "name": "slip.pdf", "contentType": "application/pdf", "contentBytes": "<base64>"
    }]
  },
  "saveToSentItems": true
}
```

A success is `202 Accepted` with an empty body; the reference notes that 202
means accepted, not delivered, and that delivery is subject to Exchange
Online limits. Graph returns no message id, so the log stores the
`client-request-id` the API generated for the call. Application permission
needed: `Mail.Send` (the least privileged permission listed for the
application type).

Token request, from the [client credentials flow](https://learn.microsoft.com/entra/identity-platform/v2-oauth2-client-creds-grant-flow):

```http
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={client id}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default
&client_secret={secret}&grant_type=client_credentials
```

The answer carries `token_type`, `expires_in` (seconds) and `access_token`.
The API keeps the token in memory and fetches a new one a minute before it
expires; a `401` from Graph drops the token and retries once. Token errors
come back to the UI as `token Microsoft 401: invalid_client AADSTS...`
(the trace ids are cut).

What the client sets up, once, in the [Microsoft Entra admin center](https://entra.microsoft.com):

1. **App registrations → New registration.** Any name (for example
   "NüHabit mailer"), single tenant, no redirect URI. Note the
   **Application (client) ID** and the **Directory (tenant) ID**.
2. **Certificates & secrets → New client secret.** Copy the secret
   **value** right away (it is shown once); paste it into the settings
   page. Note its expiry and plan the rotation.
3. **API permissions → Add a permission → Microsoft Graph → Application
   permissions → `Mail.Send`**, then **Grant admin consent** for the tenant.
   Without the admin consent the token is issued but `sendMail` answers
   `403 ErrorAccessDenied`.
4. Pick the mailbox the gym sends from (a licensed user mailbox or a shared
   mailbox, for example `noreply@gym.example`) and put its address in
   **Kirim sebagai (mailbox)** and **From**.
5. Recommended: limit the app to that mailbox with an Exchange Online
   application access policy, so `Mail.Send` cannot send as every user
   (`New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId
   <mail-enabled security group> -AccessRight RestrictAccess`).

`Mail.Send` as an application permission needs a work or school tenant
(Microsoft 365). A personal outlook.com or hotmail.com mailbox cannot grant
application permissions; use SMTP for it.

## SMTP AUTH (fallback)

Settings, from Microsoft's guide to [sending email from a device or application](https://learn.microsoft.com/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365)
("client SMTP submission"):

| Setting | Value |
|---|---|
| Server | `smtp.office365.com` (the name, never an IP) |
| Port | `587` (recommended) |
| TLS | STARTTLS, TLS 1.2 or 1.3 |
| Credentials | the mailbox's sign-in |

The API refuses to send over a connection without STARTTLS, authenticates
with `AUTH LOGIN` (what Exchange Online offers) or `PLAIN`, and records the
generated `Message-ID` header as the log reference. Limits in the same guide:
10,000 recipients per day and 30 messages per minute per mailbox; the From
must be the authenticated mailbox or one it has Send As on.

Caveats from the guide:

- Microsoft has scheduled the retirement of Basic authentication for client
  SMTP submission in Exchange Online ("Client SMTP submission using Basic
  authentication in Exchange Online is scheduled for deprecation") and
  recommends OAuth or other methods. Treat SMTP as the bridge for a mailbox
  that cannot use Graph, and move to Graph when the tenant allows.
- SMTP AUTH is off for organizations created after January 2020 and has to
  be enabled per mailbox (Exchange admin center → the mailbox → Manage
  email apps → Authenticated SMTP).
- Basic authentication is not compatible with Security defaults in Entra ID.
  A mailbox with multi-factor authentication needs an app password
  (outlook.com: account.live.com → Security → Advanced security options →
  App passwords; Microsoft 365: My account → Security info → App password,
  if the tenant allows app passwords).
- Port 465 is not supported.

For a personal outlook.com / hotmail.com mailbox: provider `microsoft`,
transport `smtp`, host `smtp.office365.com`, port `587`, user and From set to
the mailbox address, password set to an app password. Hotmail accounts
without an app password are rejected with `535 5.7.139 Authentication
unsuccessful, basic authentication is disabled`.

## Log, retries, resend

`platform.mail_log` keeps one row per message: recipient, sender, subject,
provider, status (`queued`, `sent`, `failed`), attempts, the provider's error
verbatim and its message reference. The body and attachments stay on the row
for retries and resends; the dashboard list never returns them.

- A transient failure (network error, timeout, HTTP 408/429/5xx, SMTP 4xx)
  leaves the row `queued`; the `integrations.mail-retry` job (every minute,
  50 rows per run) sends it again after 1 minute, then 5 minutes, three
  attempts in all, and marks it `failed` after the last one.
- A permanent failure (HTTP 4xx, SMTP 5xx, a configuration gap) is `failed`
  at once.
- Sign-in codes (`otp`) and payslips are sent once: a code is useless by the
  time a retry runs, and HR resends a payslip from the payroll page.
- The settings page lists the log with a "Kirim ulang" action that sends the
  stored message again on the same row. Sign-in codes cannot be resent.
- Bounces and complaints: Resend's webhooks keep working as before; Graph and
  SMTP offer no simple hook, so a bounce arrives as a non-delivery report in
  the sending mailbox.

## Reading a shared mailbox later

Inbound mail is out of scope today. When it is wanted, the same app
registration can read a shared mailbox with Graph: grant the
`Mail.Read` (or `Mail.ReadWrite`, to mark messages read) application
permission, scope it to that mailbox with an application access policy, and
poll `GET /users/{mailbox}/mailFolders/inbox/messages?$filter=isRead eq
false` from a job, or register a change notification subscription on the
inbox so Graph posts to a webhook. Messages come back as JSON with
`internetMessageId`, `from`, `subject` and `body`, so a CRM inbox adapter
could store them beside the WhatsApp conversations.
