// Security regression: a WebSocket client must NOT be able to connect as somebody else.
//
// Before the fix, the default "open" mode accepted ANY username with ANY non-empty token, so anyone who could
// reach the socket could sign in as an existing user, read their private DM history and speak as them.
//
// Runs against a backend in open mode WITH the hardening switch on (SANDESH_REQUIRE_SESSION=1), which makes
// every connection present a real Sandesh session (test/run_all.mjs sets that up):
//   node test/sec_impersonation_test.mjs [http://localhost:PORT]
// Point it at a backend WITHOUT the switch and the attack checks below FAIL -- that is the vulnerability.

const BASE = process.argv[2] || "http://localhost:8082";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (d, c, x) => { if (c) { pass++; console.log(`  PASS: ${d}`); } else { fail++; console.log(`  FAIL: ${d}${x !== undefined ? " -- " + JSON.stringify(x) : ""}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Conn {
    constructor(name, token) { this.name = name; this.token = token; this.msgs = []; }
    async open() {
        this.ws = new WebSocket(WS_URL);
        this.ws.addEventListener("message", (ev) => { try { this.msgs.push(JSON.parse(ev.data)); } catch { this.msgs.push({ raw: String(ev.data) }); } });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token: this.token, armSessionId: "x" }));
        for (let i = 0; i < 30; i++) {           // up to 3s for welcome or refusal
            if (this.msgs.some(m => m.type === "welcome")) return "welcome";
            if (this.msgs.some(m => m.type === "error")) return "refused";
            await sleep(100);
        }
        return "silent";
    }
    send(t) { this.ws.send(t); }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
    has(text) { return JSON.stringify(this.msgs).includes(text); }
}
const post = async (p, b) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; };

async function main() {
    console.log(`Impersonation test against ${BASE}\n`);
    const victim = `victim${sfx}`, friend = `friend${sfx}`;
    const secret = `launch-codes-${sfx}`;

    console.log("=== A forged token is refused ===");
    let c = new Conn(victim, "totally-made-up-token");
    ok("connecting with an invented token is refused (no welcome)", (await c.open()) !== "welcome", c.msgs.slice(0, 2));
    c.close();
    c = new Conn(victim, "x");
    ok("a one-character token is refused too", (await c.open()) !== "welcome");
    c.close();

    console.log("=== Nothing leaks even if the attacker tries the commands anyway ===");
    // Whatever the server did with the refused socket, the victim's private history must not come back on it.
    const atk = new Conn(victim, "forged");
    await atk.open();
    atk.send(`/history dm ${friend}`);
    atk.send(`/msg ${friend} it is really me`);
    await sleep(700);
    ok("no DM history is returned to a forged connection", !atk.has(secret) && !atk.msgs.some(m => m.type === "history"), atk.msgs.slice(0, 3));
    atk.close();

    console.log("=== The API itself stays closed too ===");
    let r = await post("/api/sd/login", { identifier: victim, password: "whatever12" });
    ok("login for an unknown user is a plain 401", r.status === 401, r);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("TEST CRASHED:", e.message); process.exit(1); });
