# Concurrency rules: nothing shared waits on Redis

**One rule:** a server that many users share (`chat_room`, `chat_groups`) must never call Redis (or anything slow) inside
its own `handle_call` / `handle_cast`. While it waits, it answers nobody; if the call times out (the driver gives up after
5 s) it crashes, and the live "who is online" state it holds in memory is gone -- every message afterwards fails until all
users reconnect. That is exactly what happened when Redis stalled (an AOF rewrite, a slow BGSAVE, a network blip).

## How it is done

| Kind of work | Where it runs | Ordering |
|---|---|---|
| Needs a reply (direct message, host message, group message) | a short-lived **worker** process; the server replies to the caller when it finishes (`offload_reply`) | parallel; one sender's messages stay in order because a connection waits for each reply |
| Must stay in order or must not overlap (global message, reactions, deletes, saving group membership, registering a user) | **`chat_writer`**, one process, one job at a time | strictly the order submitted; read-modify-write jobs (reactions) never race |
| Routing, presence, typing, `/list`, `/groups` | the server itself, memory only | -- |

A job that fails is logged and dropped (`chat_writer`) or answered with `{error, unavailable}` (workers). Callers turn that
into **"Temporarily unavailable -- please try again in a moment"**; the sender's connection waits at most 12 s.

Everything else was already isolated: `/sd` actions run in the user's own connection process and any crash becomes an
`internal` error reply; OTP webhooks, GIF search and link previews are fire-and-forget workers.

## What is still sequential on purpose

One user's own commands run one after another on their connection (so their messages keep their order). A slow store can
therefore delay *that user's* next command by up to ~5 s -- never anybody else's.

## Proving it

`node test/run_all.mjs redis_stall` freezes Redis (`CLIENT PAUSE`) for 6.5 s with three users online and checks that routing
keeps answering, senders are told, nothing is half-delivered, nobody is disconnected and messages flow again afterwards.
On the old code the same test fails 9 of 14 checks (both servers crash).

Measured locally (40 users, 1,200 simultaneous DMs): 2,300 -> ~18,000 messages/s, median ack 242 -> 29 ms.

## When adding code

* Need a message id / to persist something from `chat_room` or `chat_groups`? Use `chat_writer:run_async(fun() -> ... end)`, or
  a worker with `offload_reply` when the caller needs the answer.
* Never `gen_server:call` from inside one of those servers into something that can wait on Redis.

## Single-node assumptions (know these before running two backends)

* **Per-user lock.** Every read-modify-write of a person's record (`sd_users:locked/2`) uses `global:trans` on this node. It
  makes simultaneous admin/self edits safe on ONE backend node (what runs today). With several nodes against one Redis it
  would need a Redis-side lock (SET NX with an expiry) or a compare-and-set instead.
* **Mail queue.** `sd_mailq` leases jobs in Redis, so two nodes would not send the same email twice, but the retry timing
  assumes one scheduler per Redis.
* **Audit log.** Keeps the newest `SANDESH_AUDIT_MAX` entries (default 5000, minimum 100); older ones are dropped. Read it
  with `admin.audit.list` (paged); there is no export yet.
* **Host rule in open mode** only covers people signed in to Sandesh; plain chat clients (no session) are not scoped. Strict
  mode closes that (every connection needs a session and a DM needs an association).
