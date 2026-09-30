// An enterprise that only accepts people who scanned (or typed) its Connectum code: SANDESH_REQUIRE_CODE=1.
//
//   REDIS_DB=16 SANDESH_MODE=strict SANDESH_REQUIRE_CODE=1 SANDESH_DEV_OTP=1 ... erl ... -s chat_app start 5574 8094
//   node test/connectum_require_code_test.mjs http://localhost:8094
import { suite, bootstrap, sfx, api } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8094";
const t = suite("connectum_require_code", BASE);
const { ok } = t;

async function main() {
    console.log(`Registration requires the enterprise code, against ${BASE}\n`);
    const B = await bootstrap(BASE);
    const http = api(BASE);
    const orgCode = (await B.A.sd("admin.org.get")).data.org.code;
    const person = (n, extra = {}) => ({ name: "Reg " + n, email: `reg${n}${sfx}@t.co`, mobile: `+9198770${String(Date.now() + n).slice(-5)}`, password: "Str0ngPass99x",
        username: `reg${n}${sfx}`, category: "Patient", country: "India", city: "Pune", pin: "411001", ...extra });
    let r = await http.post("/api/sd/register", person(1));
    ok("no code -> code_required", r.error?.code === "code_required", r.json);
    r = await http.post("/api/sd/register", person(2, { code: "" }));
    ok("an empty code counts as no code", r.error?.code === "code_required", r.json);
    r = await http.post("/api/sd/register", person(3, { code: "ZZZZZZZZ" }));
    ok("a wrong code -> invalid_code", r.error?.code === "invalid_code", r.json);
    r = await http.post("/api/sd/register", person(4, { code: `${orgCode.slice(0, 4)}-${orgCode.slice(4)}`.toLowerCase() }));
    ok("the right code, typed the way people type it, registers", r.status === 200 && r.data?.registered === true, r.json);
    B.A.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
