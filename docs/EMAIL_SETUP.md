# Email (invitations and one-time codes)

Connectum sends real email through any SMTP submission server (Office 365 on port 587 is what we use).
It covers the **invitation** a new person gets when an admin or host invites them, and the **one-time codes**
(admin unlock, sign-in verification, first-time setup).

## How it is switched on

The backend reads these from its environment. On the VM they live in `/etc/axi-chat-backend.env`
(root-only, **never committed**); `systemctl restart axi-chat-backend` applies a change.

| Variable | Meaning |
|---|---|
| `SANDESH_OTP_MODE=smtp` | send email (other modes: `log`, `fixed`, `webhook`; see `axi-chat-backend/src/sd_notify.erl`) |
| `SMTP_HOST` / `SMTP_PORT` | e.g. `smtp.office365.com` / `587` (STARTTLS, certificate verified against the system CA store) |
| `SMTP_USER` / `SMTP_PASS` | the mailbox login (also the default sender) |
| `SMTP_FROM` | optional sender address if different from `SMTP_USER` |
| `SMTP_FROM_NAME` | display name, default `Connectum` |
| `APP_URL` | link put in the email, e.g. `https://10.0.2.146` |
| `SMTP_RETRY_DELAYS_MS` | optional, default `0,5000,30000`: delays before each delivery attempt (first is immediate) |

**Delivery.** Each email is sent in the background. A temporary failure (connection problem, `4xx` "try later") is
retried up to twice more (see `SMTP_RETRY_DELAYS_MS`); a permanent refusal (`5xx`: bad address, wrong login) is logged
once and not retried. The person is created either way, so a lost invitation can be re-sent:
`users.resend_invite {username}` (administrators, or the person's own host; only for someone who has not signed in
yet; at most once a minute per person).

**What an invitation says.** The username, and how to sign in: enter the username (or email); the first time scan the
QR code with an authenticator app; after that sign in with the app's 6-digit code. Only administrators have a password,
so no password is mentioned.

A person with no email address, or a server with SMTP unset, simply gets nothing sent (a warning is logged);
it never blocks the request that triggered it. The password is never written to a log or returned by the API.

## Check that it works (sends nothing)

On the VM, as root:

```sh
set -a; . /etc/axi-chat-backend.env; set +a
cd /home/opc/actions-runner/_work/axi-react/axi-react/axi-chat-backend
/opt/erlang/27.3.4.18/bin/erl -noshell -pa _build/default/lib/axi_chat_backend/ebin \
  -eval 'io:format("~p~n", [sd_smtp:probe()]), halt().'
```

`ok` means the VM reached the mail server, upgraded to TLS and logged in. To send one real message, replace the
eval with `sd_smtp:send(<<"you@agile-labs.com">>, "Subject", "Body")`.

The service log shows each delivery: `journalctl -u axi-chat-backend | grep sd_notify`
(`email sent to ...` or `email to ... failed: ...`).

## If it fails

- `{error, ...}` mentioning the host: the VM cannot reach the mail server (check outbound port 587).
- `unexpected_reply "535"`: wrong user/password, or SMTP AUTH is disabled for that mailbox in Microsoft 365
  (admin centre: Mailboxes, Manage email apps, Authenticated SMTP).
- The mail arrives in Junk: ask IT to allow the sending mailbox, or send from a mailbox in the same domain.

## Security notes

- Invitations contain no password (only administrators have one). The first sign-in is the authenticator enrolment.
- `SANDESH_DEV_OTP=1` additionally returns each one-time code in the API response (for development). Turn it off
  on a shared deployment, otherwise the email adds nothing: anyone can read the code from the response.
