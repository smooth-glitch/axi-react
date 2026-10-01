# ⬡ Connectum · Live Status

> Auto-generated on every push to `main`. Do not edit by hand.
> Last updated: 01 Oct 2026, 06:52 UTC · commit [`0579a6b`](https://github.com/smooth-glitch/axi-react/commit/0579a6bf0a537dea7e4a1e4e1ad652706b18f9fb)

## New here? Start here

**Connectum** is the AXI chat platform: a React SPA frontend plus an Erlang/OTP real-time chat backend, in this one repo.

1. Read the [README](https://github.com/smooth-glitch/axi-react#readme), especially its *Start here, by role* table.
2. Skim the docs below, then clone the repo and follow the README's run instructions.
3. In the **Connectum dev group** on Teams, scroll up for the history of decisions. Ask whoever adds you to share chat history from the start.
4. Check [Recent changes](#recent-changes) to see what is moving right now, and [NEXT_STEPS](NEXT_STEPS.md) for what is planned.

### Who owns what

| Area | Owner |
|---|---|
| Erlang chat backend, DevOps | Arjun |
| Lite tstruct UI | Gunn |
| Rest of the UI and wiring it to the backend | Anish |

### Docs index

- [Redis backups on the VM](BACKUPS.md) · `docs/BACKUPS.md`
- [AXI Chat Backend — WebSocket Protocol](CHAT_PROTOCOL.md) · `docs/CHAT_PROTOCOL.md`
- [Connectum backend: frontend integration guide](CONNECTUM_FRONTEND_INTEGRATION.md) · `docs/CONNECTUM_FRONTEND_INTEGRATION.md`
- [Frontend hand-off: `#commands` changes](FRONTEND_HANDOFF_HASH_COMMANDS.md) · `docs/FRONTEND_HANDOFF_HASH_COMMANDS.md`
- [`#commands` — the chat prompt bar's action menu](HASH_COMMANDS.md) · `docs/HASH_COMMANDS.md`
- [Axpert Chat Plugin — Next Steps & Progress Tracker](NEXT_STEPS.md) · `docs/NEXT_STEPS.md`
- [Sandesh API — what the frontend builds against](SANDESH_API.md) · `docs/SANDESH_API.md`
- [AXI Chat Backend](../axi-chat-backend/README.md) · `axi-chat-backend/README.md`
- [Concurrency rules: nothing shared waits on Redis](../axi-chat-backend/docs/CONCURRENCY.md) · `axi-chat-backend/docs/CONCURRENCY.md`
- [Debugging & Handover Guide](../axi-chat-backend/docs/DEBUGGING.md) · `axi-chat-backend/docs/DEBUGGING.md`
- [Lite TStruct — how it works (backend owner's notes)](../axi-chat-backend/docs/LITE_TSTRUCT.md) · `axi-chat-backend/docs/LITE_TSTRUCT.md`
- [Login / Signup / Self-Register — integration steps (AxiChat backend)](../axi-chat-backend/docs/LOGIN_INTEGRATION.md) · `axi-chat-backend/docs/LOGIN_INTEGRATION.md`
- [Sandesh layer — backend notes](../axi-chat-backend/docs/SANDESH.md) · `axi-chat-backend/docs/SANDESH.md`

## Progress

`▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱` **0%** · 0 of 50 checklist items in [NEXT_STEPS](NEXT_STEPS.md) done

## Last 30 days

| Contributor | Commits |
|---|---|
| Arjun Sridhar | 64 |
| Arjun | 35 |
| Anish-S-Agile | 27 |
| Gunn | 26 |
| Gunn Kataria | 1 |
| Backend Owner | 1 |

| Area | Files touched |
|---|---|
| Frontend | 231 |
| Other | 113 |
| Backend | 93 |
| Docs | 22 |
| CI / DevOps | 12 |
| Tests | 11 |

## Recent changes

| When | Who | Change | Diff |
|---|---|---|---|
| 01 Oct | Arjun Sridhar | [`2dc93a1`](https://github.com/smooth-glitch/axi-react/commit/2dc93a143dfe3c2ccdce474841203277284ce5e7) ci: STATUS.md doubles as a new-developer onboarding page (start-here steps, owners, docs index) | +65 / −5 |
| 01 Oct | Arjun Sridhar | [`2c28026`](https://github.com/smooth-glitch/axi-react/commit/2c28026d7c014587b6e71f3b8150a18c52611b50) ci: Teams status card and self-updating STATUS.md, both on push to main | +310 / −0 |
| 01 Oct | Anish-S-Agile | [`62e8331`](https://github.com/smooth-glitch/axi-react/commit/62e8331e6c7b69738f068503094456492b8bd171) Docs Readable + Ui polish | +1923 / −473 |
| 30 Sep | Arjun Sridhar | [`1d284a8`](https://github.com/smooth-glitch/axi-react/commit/1d284a857f32cd6059d6517a3e50ab2c29b4be98) feat(backend): Connectum backend (codes/QR, wizards, data sources, payments, custom # commands, chat edit) (#86) | +5181 / −107 |
| 30 Sep | Arjun Sridhar | [`2a267e9`](https://github.com/smooth-glitch/axi-react/commit/2a267e9ed16af3da7d63c1e4fe95b7c4a19857bf) UI cleanup: remove the '#' hint, the green sync dot and the 'Live Sync' pill (#85) | +8 / −31 |
| 30 Sep | Gunn | [`cd67a90`](https://github.com/smooth-glitch/axi-react/commit/cd67a9040c87bae8e020e1461cddf6ec10248a1b) feat: Smart Prompts category list opens as an upward dropdown from the pill | +297 / −187 |
| 30 Sep | Gunn | [`7339f92`](https://github.com/smooth-glitch/axi-react/commit/7339f924f392fa202422b4124300d9b6c3c485b6) feat: Smart Prompts by category -- pills with counts + paged, searchable category popup | +217 / −14 |
| 30 Sep | Arjun Sridhar | [`4813eca`](https://github.com/smooth-glitch/axi-react/commit/4813eca7baef1b41fb9a3fd7a66a2b83484c6768) fix: shared chat servers never wait on Redis -- a Redis stall no longer crashes chat_room / chat_groups (#80) | +420 / −134 |
| 30 Sep | Arjun Sridhar | [`3bcf63d`](https://github.com/smooth-glitch/axi-react/commit/3bcf63d92498b280d94c5e58cd5ddeff116241e3) feat: Smart Prompts by category -- options.categories (pills + counts) and paged, searchable options.list (#81) | +398 / −6 |
| 30 Sep | Anish-S-Agile | [`38a5dd4`](https://github.com/smooth-glitch/axi-react/commit/38a5dd486d319afe4f20f13039c24627e16eceb0) Upload option UI Polish | +481 / −21 |
| 30 Sep | Arjun Sridhar | [`b102393`](https://github.com/smooth-glitch/axi-react/commit/b102393523dc2674775982af1eccd20afef7f5ed) chore: stop tracking dist/ (build output); CI builds it before every deploy (#79) | +5 / −48775 |
| 30 Sep | Arjun Sridhar | [`2c3db5a`](https://github.com/smooth-glitch/axi-react/commit/2c3db5a678b5fec933720a0d804d876e51538b18) fix: #notifications opens the notification panel; #remind confirms with a toast | +8 / −0 |
| 30 Sep | Arjun Sridhar | [`abc4f0f`](https://github.com/smooth-glitch/axi-react/commit/abc4f0f69093b2853a879dcbbc9c31a705f7ba9b) fix: associates list showed blank names (server sends {online, relation, user:{...}}); normalise once | +13 / −3 |
| 30 Sep | Arjun Sridhar | [`ca66964`](https://github.com/smooth-glitch/axi-react/commit/ca669648f1f71d94358cd1b525bb52c2af321176) fix: #connect toast said 'Connected with @user' for what is a pending invitation; composer ignores late suggestion replies after send | +11 / −1 |
| 30 Sep | Arjun Sridhar | [`a8413f5`](https://github.com/smooth-glitch/axi-react/commit/a8413f502d5d39ba5938d28cc85248edc2560021) fix: # commands were sent to the server twice (raw line + explicit call): duplicate errors, double history loads | +17 / −18 |
| 30 Sep | Arjun Sridhar | [`1ac1835`](https://github.com/smooth-glitch/axi-react/commit/1ac183594f1f94e79977b3813c87a7ecf494906f) fix: groups appear only when the server confirms (group_created); no optimistic 'created' toast | +9 / −40 |
| 30 Sep | Arjun Sridhar | [`adc738c`](https://github.com/smooth-glitch/axi-react/commit/adc738cd04fa157a3ad49a634491440f9270ec02) fix(composer): clear stale argument suggestions when the text changes (Enter chose a leftover item from a previous command) | +9 / −7 |
| 30 Sep | Arjun Sridhar | [`29151ab`](https://github.com/smooth-glitch/axi-react/commit/29151abd697b1029a2d24060f1ab1851a1cf78b8) fix: restore notifications, tstruct and tstruct-add in the # menu whitelist (dropped by a UI polish commit) | +2 / −1 |
| 30 Sep | Arjun Sridhar | [`77bc3b6`](https://github.com/smooth-glitch/axi-react/commit/77bc3b66cf9b6477110ef6e56aba8667fea55379) feat: show profile pictures in inbox, forward, new-group and My Workspace lists | +5 / −2 |
| 30 Sep | Arjun Sridhar | [`10f7bb4`](https://github.com/smooth-glitch/axi-react/commit/10f7bb4d1438ee0fd6c51db0ed1d3a5cd40ea9bc) fix: hooks after the logged-out early return crashed the screen right after login | +7 / −5 |
| 30 Sep | Arjun Sridhar | [`8e99fa9`](https://github.com/smooth-glitch/axi-react/commit/8e99fa9d4a501cc3df25e75221b15ff622062c9a) feat: #accept / #reject suggest the user's pending requests (with who/what) | +36 / −1 |
| 30 Sep | Arjun Sridhar | [`c0710a3`](https://github.com/smooth-glitch/axi-react/commit/c0710a3ef570e8383caf78a4941a90c26ec75b53) feat: group owner in group events; Members modal + #addmember gated to the group admin | +63 / −5 |
| 30 Sep | Anish-S-Agile | [`c50db29`](https://github.com/smooth-glitch/axi-react/commit/c50db29353d6d2f8b20e3810b1f2be46d7b5fce4) fix: resolve avatar upload, conversations route, multi-word autocomplete, and profile controls | +339 / −1655 |
| 30 Sep | Anish-S-Agile | [`68153af`](https://github.com/smooth-glitch/axi-react/commit/68153af205921778a4fe0b9f386be0e2e1c2fb66) Updated UI Polish | +4803 / −2104 |
| 30 Sep | Gunn | [`b47b415`](https://github.com/smooth-glitch/axi-react/commit/b47b415bc35a782431dc2a0db5d719292a351f3c) fix(tstruct): URL-encode struct names in web paths; drop leftover #tstruct-edit/-delete reply handlers | +16 / −27 |
