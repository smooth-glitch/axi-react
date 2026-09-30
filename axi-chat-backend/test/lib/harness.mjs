// Shared helpers for the Connectum feature suites: create an organisation, sign users in (with real two-factor
// codes), connect them over the WebSocket, call /sd actions and collect live events.
//
// Every suite runs against a fresh backend (see test/run_all.mjs): strict mode + SANDESH_DEV_OTP=1.

import crypto from "node:crypto";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sfx = Date.now().toString(36).slice(-4);

export function suite(name, base) {
    const s = { name, pass: 0, fail: 0, failures: [] };
    s.ok = (desc, cond, detail) => {
        if (cond) { s.pass++; console.log("  PASS: " + desc); }
        else {
            s.fail++; s.failures.push(desc);
            console.log("  FAIL: " + desc + (detail !== undefined ? " -- " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
        }
    };
    s.section = (t) => console.log(`=== ${t} ===`);
    s.done = () => {
        console.log(`\n=== SUMMARY ===\n${s.pass} passed, ${s.fail} failed`);
        if (s.fail) { console.log(s.failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
        process.exit(0);
    };
    s.base = base;
    return s;
}

export function api(base) {
    const call = async (method, path, body, token) => {
        const headers = {};
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const t = await r.text();
        let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* not json */ }
        return { status: r.status, json, data: json?.data, error: json?.error };
    };
    return { get: (p, t) => call("GET", p, undefined, t), post: (p, b, t) => call("POST", p, b ?? {}, t) };
}

function b32(str) {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of str.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, "0");
    const o = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(o);
}
export function totp(secret) {
    const m = Buffer.alloc(8);
    m.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
    const h = crypto.createHmac("sha1", b32(secret)).update(m).digest();
    const off = h[h.length - 1] & 15;
    const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
    return String(n % 1000000).padStart(6, "0");
}

export class Client {
    constructor(base, name) { this.base = base; this.name = name; this.inbox = []; this.seq = 0; this.closed = false; }
    async connect(token) {
        this.ws = new WebSocket(this.base.replace(/^http/, "ws"));
        this.ws.addEventListener("message", (e) => { try { this.inbox.push(JSON.parse(e.data)); } catch { /* ignore */ } });
        this.ws.addEventListener("close", () => { this.closed = true; });
        await new Promise((res, rej) => { this.ws.addEventListener("open", res, { once: true }); this.ws.addEventListener("error", rej, { once: true }); });
        this.ws.send(JSON.stringify({ username: this.name, token }));
        await this.wait((m) => m.type === "welcome", 5000);
        return this;
    }
    async wait(pred, ms = 4000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            const i = this.inbox.findIndex(pred);
            if (i >= 0) return this.inbox.splice(i, 1)[0];
            await sleep(25);
        }
        return null;
    }
    send(line) { this.ws.send(line); }
    // one /sd call; resolves with the reply envelope {ok, data|error}
    async sd(action, args = {}, ms = 8000) {
        const reqId = `${this.name}-${++this.seq}`;
        this.ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        const m = await this.wait((x) => x.type === "sd" && x.reqId === reqId, ms);
        return m ?? { ok: false, error: { code: "test_timeout", message: `no reply to ${action}` } };
    }
    // send without waiting; returns the reqId to wait on later
    fire(action, args = {}) {
        const reqId = `${this.name}-${++this.seq}`;
        this.ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId })}`);
        return reqId;
    }
    waitReply(reqId, ms = 8000) { return this.wait((x) => x.type === "sd" && x.reqId === reqId, ms); }
    close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// Creates the organisation (first-run setup), signs the admin in and unlocks the admin console.
// Returns { A: admin client, adminName, pw, http, enroll, connectUser }.
export async function bootstrap(base, opts = {}) {
    const http = api(base);
    const pub = await http.get("/api/sd/public");
    if (pub.data?.setupDone) { console.log("This DB is already set up: flush the scratch DB, restart the backend, re-run."); process.exit(2); }
    const adminName = opts.adminName ?? `adm${sfx}`;
    const pw = "Str0ngPass99";
    let r = await http.post("/api/sd/setup/start", {
        org: opts.org ?? "Test Co", name: "Root Admin", username: adminName, email: `${adminName}@test.co`, mobile: "+919886012345",
        ...(opts.setupExtra ?? {}),
    });
    if (!r.data?.devOtp) return { failed: r };
    r = await http.post("/api/sd/setup/verify", { otp: r.data.devOtp });
    const secret = r.data.secret, defPw = r.data.defaultPassword;
    r = await http.post("/api/sd/login", { identifier: adminName, password: defPw, totp: totp(secret) });
    const t0 = r.data.token;
    await http.post("/api/sd/password/change", { oldPassword: defPw, newPassword: pw }, t0);
    r = await http.post("/api/sd/login", { identifier: adminName, password: pw });
    const A = await new Client(base, adminName).connect(r.data.token);
    let m = await A.sd("admin.unlock.start");
    m = await A.sd("admin.unlock", { password: pw, otp: m.data.devOtp });
    const enroll = async (identifier) => {
        let x = await http.post("/api/sd/login", { identifier });
        if (x.data?.token) return x.data.token;
        x = await http.post("/api/sd/login", { identifier, totp: totp(x.data.secret) });
        return x.data?.token;
    };
    const connectUser = async (name) => new Client(base, name).connect(await enroll(name));
    return { A, adminName, pw, http, enroll, connectUser, setupResult: r };
}

// Master data + invited employees. users: [[username, "Full Name", "Dept"]]
export async function seedOrg(A, users = [], extra = {}) {
    await A.sd("admin.cfg.save", { kind: "branches", item: { name: "HQ", country: "India", city: "Pune", pin: "411001" } });
    for (const d of extra.departments ?? ["Ops", "Sales"]) await A.sd("admin.cfg.save", { kind: "departments", item: { name: d } });
    await A.sd("admin.cfg.save", { kind: "designations", item: { name: "Analyst" } });
    const out = [];
    for (const [u, n, dept] of users) {
        const r = await A.sd("users.invite", { name: n, username: u, email: `${u}@test.co`, isEmployee: true, branch: "HQ", department: dept ?? "Ops", designation: "Analyst" });
        out.push(r);
    }
    return out;
}
