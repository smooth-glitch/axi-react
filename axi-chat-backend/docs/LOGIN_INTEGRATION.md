# Login / Signup / Self-Register — integration steps (AxiChat backend)

This is merged into `main` now — just `git pull`, everything's there (backend
code + `docs/SANDESH.md` in `axi-chat-backend`).

**Updated:** the login rules changed since the last version of this doc.
Three things are new — read this before touching the login screen again:

1. **A password is only needed for admin accounts.** Every other account
   signs in with just its identifier, plus a second-factor code when one is
   due. Don't send `password` for a non-admin login at all (or send anything
   — it's never checked).
2. **The "every 2 weeks" re-verification is now per DEVICE, not per
   account.** A phone that verified an hour ago and a laptop that's never
   signed in are two different things — the laptop still gets asked. This
   means you now need to generate and persist a `deviceId` (see Flow 3) for
   this to actually save your users a code entry every time.
3. **A second factor can be an emailed code instead of an authenticator
   app.** Citizen users who don't want to install one can enroll with
   `mfaMethod:"email"` instead of scanning a QR.

Base URL prefix: `http://10.0.2.146/api/sd/` — every endpoint below is this
prefix + a path (e.g. `http://10.0.2.146/api/sd/public`). The bare prefix by
itself isn't a real endpoint, it'll 404 — that's expected, not a bug.

Every response: `{"ok": true, "data": {...}}` or `{"ok": false, "error":
{"code", "message"}}`. Branch on `error.code`, display `error.message`.

Auth'd calls: `Authorization: Bearer <token>` header.

---

## FLOW 1 — First-run org setup (one-time only, whoever does this becomes admin)

**Step 1:** `GET /api/sd/public` → `{ setupDone: bool, ... }`

On app boot, if `setupDone` is `false`, show the "set up your organisation"
screen instead of login.

**Step 2:** `POST /api/sd/setup/start { org, name, username?, email, mobile }`

→ `{ sent: true, expiresInSec: 300 }`

Sends a bootstrap OTP. `DEV_OTP` is currently ON on the VM, so it'll also
come back as `devOtp` in the response for now — don't build UI around that
field, it's temporary.

**Step 3:** `POST /api/sd/setup/verify { otp }`

→ `{ totpSetupRequired: true, mfaMethod: "totp", secret, otpauthUri, issuer,
digits, periodSec, recommendedApps, defaultPassword, org, user }`

No token here — this is intentional, go straight into Flow 3 (enrollment)
using the identifier/`defaultPassword` you just got back. The first admin is
always enrolled with `mfaMethod:"totp"` (not email) — there's no UI step to
choose otherwise for this one account.

---

## FLOW 2 — Self-registration (pending admin/host approval)

`POST /api/sd/register { name, username?, email, mobile, password, ...profile fields (isEmployee, branch, department, designation, or category/country/city/pin, or affiliate fields) }`

→ `{ registered: true, status: "pending", requestId, awaitingApprovalFrom }`

Notes:

- `password` is still required here — the user still picks one up front
  (server enforces it regardless: 8+ chars, letters + a digit,
  `weak_password` error if not met). **It will never actually be checked at
  login**, though, unless this person is later made an admin — so don't
  build any "forgot password" UI around a self-registered non-admin account;
  there's nothing to reset that matters.
- User can't log in yet — any login attempt returns `pending_approval` (403)
  until a host/admin approves the request.
- Once approved, they go through Flow 3 (enrollment) on their first
  successful login — same as everyone else.

---

## FLOW 3 — Every login, always: `POST /api/sd/login`

```
{ identifier, password?, totp?, emailOtp?, recoveryCode?, deviceId?, mfaMethod? }
```

`identifier` = username, email, or mobile.

`password` — **send this only if you know (or don't know but might be) an
admin account.** The simplest correct approach: always send whatever
password the user typed, if your login form still asks for one; the backend
ignores it for a non-admin and checks it for an admin. If your login form no
longer asks non-admins for a password at all, that's fine too — just omit
the field.

`deviceId` — **new, and you should start sending this now.** Generate a
random opaque string once per install/browser (e.g. `crypto.randomUUID()`),
store it in `localStorage`, and send it on every login call from here on. It
lets the backend recognise "this is the same device that verified 2 weeks
ago" so returning users on their own phone/laptop don't get asked for a code
every time. If you don't send it, the backend falls back to a coarse
fingerprint derived from the browser's `User-Agent` header — good enough to
keep testing working, but two people on the same browser/OS combination
would look like the same "device", and it's less stable long-term than a
real `deviceId`. **Don't skip this for the real app build.**

`mfaMethod` — only meaningful on the very first login (or right after 2FA
was disabled): `"totp"` (default, authenticator app) or `"email"`. Ignored
on every later call.

### Case A — Unenrolled account (first-ever login, or setup/register just happened, or 2FA was reset)

Send `{ identifier, password? }` — no `totp`/`emailOtp` yet.

- **`mfaMethod` omitted or `"totp"`:** →
  `{ totpSetupRequired: true, mfaMethod: "totp", secret, otpauthUri, issuer,
  digits, periodSec, recommendedApps }`, no token.
  - Render `otpauthUri` as a QR code (`qrcode` npm package works well). Also
    show `secret` as plain text for manual entry.
  - `recommendedApps = [{name, ios, android}]` — Google Authenticator +
    Microsoft Authenticator store links, for a "don't have one?" prompt.
  - Re-calling this before finishing gives back the SAME QR — safe to re-hit
    if the user navigates away.
- **`mfaMethod: "email"`** (offer this as an alternative button — "email me
  a code instead" — especially for citizen/external users): →
  `{ totpSetupRequired: true, mfaMethod: "email", sent: true,
  expiresInSec: 300 }`, no token, **no secret/QR** — a code was just emailed
  instead. Show a "check your email" screen with a code input. Re-calling
  this resends (subject to a 30s cooldown: `{ sent: false, retryAfter }`).

### Case B — Finishing enrollment

User types the 6-digit code (from their app, or from the email they just
got). Send `{ identifier, password?, totp: "123456" }` or
`{ identifier, password?, emailOtp: "123456" }` — whichever Case A used.

→ `{ token, user, expiresTs, mustChangePassword, recoveryCodes: [...10 strings], totpJustEnabled: true }`

Show the recovery codes exactly once, right here (e.g. "save these somewhere
safe") — the API never returns them again. Wrong code → `otp_invalid`, let
them retry, no need to restart the flow.

### Case C — Already enrolled, known device, within ~14 days of last verification on it

`{ identifier, password?, deviceId }` alone succeeds → normal session
response, no `totpSetupRequired`, no `recoveryCodes`. This is the common
case for a returning user on their own device.

### Case D — Already enrolled, but this DEVICE hasn't verified recently (or ever)

This fires for a genuinely new device, OR any device if you're not sending
`deviceId` consistently (see the fallback caveat above) and 14 days have
passed on that fallback fingerprint.

- **totp-method account:** `{ identifier, password? }` (or with a stale
  `deviceId`) → `totp_required` (401). Prompt for their code, resend with
  `{ identifier, password?, totp, deviceId }`. Lost the device →
  `{ identifier, password?, recoveryCode: "ABCDE-FGHJK", deviceId }` instead
  (each code works once, for either method).
- **email-method account:** the *same call*, still with no `emailOtp` yet,
  comes back **`ok: true`** (not an error!) with
  `{ emailOtpRequired: true, mfaMethod: "email", sent: true/false,
  expiresInSec, retryAfter? }` — the login call itself just triggered
  sending a code, since there's nothing for the user to generate locally.
  Show the "check your email" screen, then retry with
  `{ identifier, password?, emailOtp: "123456", deviceId }`.

A successful code check trusts that device for the next 14 days — the user
won't be asked again on it until then, regardless of what happens on their
other devices.

---

After login succeeds, check `mustChangePassword` on the response — **this
only ever matters for an admin account**; a non-admin's password is never
checked, so there's no reason to force a change screen for one even if this
flag happens to be `true`. For an admin: force a "set a new password"
screen before anything else (backend blocks other actions until it's
cleared). `POST /api/sd/password/change { oldPassword?, newPassword }` →
`{ changed: true }`. `oldPassword` only required if one's already set.

---

## Managing 2FA once signed in (Bearer)

- `GET /api/sd/2fa/totp` → `{ enabled, method }` — `method` is `"totp"` or
  `"email"`. Use this to show "your two-factor method: Authenticator app /
  Email" in account settings.
- `POST /api/sd/2fa/email/request` → `{ sent, expiresInSec, devOtp? }` —
  **email-method accounts only** (400 `invalid` otherwise). Call this right
  before showing the code field in the two endpoints below, for an
  email-method account.
- `POST /api/sd/2fa/totp/disable { password, code }` → `{ disabled: true }`
  — `code` is the current app/email code (fetch one via the endpoint above
  first, for email), or a recovery code. This doesn't turn 2FA off — the
  next login just re-enrolls (Case A again), letting the user switch device
  or method.
- `POST /api/sd/2fa/totp/recovery/regenerate { password, code }` →
  `{ recoveryCodes: [...10 fresh strings] }` — invalidates every previous
  code. Same `code` rule as above.

---

## One active session per account

Signing in (any successful `POST /api/sd/login` that returns a token) ends the
account's previous session. Any other tab, browser or device still holding the
old token is signed out:

- **Live WebSocket:** it receives
  `{"type":"sd_event","event":"session_replaced","reason":"signed_in_elsewhere"}`
  and the server closes the connection. Show the sign-in screen (with a message)
  and do **not** auto-reconnect with the old token.
- **REST / offline client:** its next call with the old token returns
  `401 unauthenticated`. `GET /api/sd/session` is a cheap way to check.
- The strict-mode admin-console unlock belongs to a session, so the new session
  has to unlock again.

Device trust (the 14-day 2FA window) is per device and unaffected.

## Error codes to handle explicitly

- `invalid_credentials` (401) — wrong password (admin accounts), or unknown
  identifier (same error either way, no enumeration)
- `totp_required` (401) — this device needs a code now (totp-method
  accounts; an email-method account instead gets an `ok:true` response with
  `emailOtpRequired` — see Case D)
- `otp_invalid` (401) — wrong/expired/reused code
- `locked` (429) — 5 failed attempts, wait ~15 min
- `rate_limited` (429) — too many requests, back off
- `pending_approval` (403) — self-registered, waiting on approval
- `account_inactive` (403) — deactivated
- `password_change_required` (403) — an **admin** must change their password
  first (this never fires for a non-admin any more)
- `weak_password` (400) — policy violation on register/change

---

## Testing right now

VM is up, org setup hasn't been claimed yet, so `setup/start` + `setup/verify`
is a real, one-shot flow — don't call `setup/verify` casually, it permanently
creates the org.

For the TOTP code itself (Case B/D, `mfaMethod:"totp"`), feed the `secret`
into any TOTP JS lib (`otplib`, `speakeasy`) to compute the same 6-digit code
an authenticator app would, instead of scanning a real QR every time. For the
email method, `devOtp` in the response (dev-mode only, see Step 2 above) is
the code — no real inbox needed while testing.

To exercise the "new device" path (Case D) without waiting 14 days, just send
a different `deviceId` on your test calls — each distinct `deviceId` is
treated as its own device from the moment you first use it.
