// Connected applications, data sources (#datasources) and global variables (#globalvars).
//
// The test starts its own tiny "application" (an HTTP server) that the backend calls, so every path is real:
// bearer / basic credentials, SQL sent with bound parameters, several answer shapes, and the failures
// (refused credentials, HTTP 500, not JSON, too large, too slow, unreachable).
//
//   REDIS_DB=18 SANDESH_MODE=strict SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=100000 \
//   SANDESH_DS_TIMEOUT_MS=1500 erl ... -s chat_app start 5576 8096
//   node test/connectum_data_test.mjs http://localhost:8096
//
// Also run by `node test/run_all.mjs connectum_data`.

import http from "node:http";
import { suite, bootstrap, seedOrg, sleep, sfx } from "./lib/harness.mjs";

const BASE = process.argv[2] || "http://localhost:8096";
const t = suite("connectum_data", BASE);
const { ok } = t;

// ---- the fake application ---------------------------------------------------------------------------------
const seen = [];                       // every request the backend made: {method, url, headers, body}
const CUSTOMERS = [
    { id: 1, name: "Asha", city: "Pune" }, { id: 2, name: "Bala", city: "Pune" }, { id: 3, name: "Chen", city: "Mumbai" },
    { id: 4, name: "Dev", city: "Pune" }, { id: 5, name: "Esha", city: "Delhi" },
];
function startApp() {
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
            seen.push({ method: req.method, url: req.url, headers: req.headers, body });
            const auth = req.headers.authorization || "";
            const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
            const u = new URL(req.url, "http://x");
            if (u.pathname.startsWith("/basic")) {
                if (auth !== "Basic " + Buffer.from("svc:pw123").toString("base64")) return json(401, { error: "no" });
                return json(200, [{ ok: true }]);
            }
            if (u.pathname !== "/" && auth !== "Bearer secret123" && u.pathname !== "/open" && !u.pathname.startsWith("/open/")) return json(403, { error: "denied" });
            switch (u.pathname) {
                case "/": return json(200, { service: "fake app" });
                case "/query": {
                    const q = JSON.parse(body || "{}");
                    const city = q.params?.city;
                    const rows = CUSTOMERS.filter((c) => !city || c.city === city);
                    if (/region/i.test(q.sql)) return json(200, { columns: ["region", "tier"], rows: [["West", "gold"]] });
                    return json(200, { columns: ["id", "name", "city"], rows: rows.map((r) => [r.id, r.name, r.city]) });
                }
                case "/customers": return json(200, CUSTOMERS.filter((c) => !u.searchParams.get("city") || c.city === u.searchParams.get("city")));
                case "/products": return json(200, { data: [{ sku: "A1", price: 10 }, { sku: "B2", price: 20 }] });
                case "/orders": { const p = JSON.parse(body || "{}"); return json(200, { rows: [{ echoed: p.who ?? null, qty: p.qty ?? null }] }); }
                case "/slow": await sleep(4000); return json(200, []);
                case "/big": res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify([{ blob: "x".repeat(1_200_000) }]));
                case "/notjson": res.writeHead(200, { "content-type": "text/plain" }); return res.end("hello");
                case "/notrows": return json(200, { message: "no rows here" });
                case "/err500": return json(500, { error: "boom" });
                case "/commands": return json(200, [{ name: "stock", caption: "Stock check", description: "Look up stock" }, { name: "invoice", caption: "Invoices" }, { nope: 1 }]);
                case "/open": return json(200, [{ v: 1 }]);
                default: return json(404, { error: "not found" });
            }
        });
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}
const last = (pred) => [...seen].reverse().find(pred);

async function main() {
    console.log(`Applications, data sources and global variables against ${BASE}\n`);
    const app = await startApp();
    const appUrl = `http://127.0.0.1:${app.port}`;
    const B = await bootstrap(BASE);
    const { A, connectUser } = B;
    const [ann, bob, cal] = [`ann${sfx}`, `bob${sfx}`, `cal${sfx}`];
    await seedOrg(A, [[ann, "Ann Ops", "Ops"], [bob, "Bob Sales", "Sales"], [cal, "Cal Ops", "Ops"]]);
    await A.sd("admin.user.update", { username: ann, city: "Pune", country: "India", pin: "411001" });
    await A.sd("admin.user.update", { username: bob, city: "Mumbai", country: "India", pin: "400001" });
    const Ann = await connectUser(ann), Bob = await connectUser(bob), Cal = await connectUser(cal);

    t.section("Application connections: the spec's flags, and a safe way to call them");
    let m = await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", credentials: { token: "secret123" }, commandLine: true });
    ok("an administrator connects an application with a 'command line required' flag", m.ok && m.data.connection.commandLine === true && m.data.connection.hasCredentials === true, m);
    ok("credentials are never sent back", !JSON.stringify(m.data).includes("secret123") && !("credentials" in m.data.connection), m.data);
    ok("the new settings have safe defaults (queryPath /query, commandsPath /commands, no personal data sources)",
        m.data.connection.queryPath === "/query" && m.data.connection.commandsPath === "/commands" && m.data.connection.allowUserDatasources === false, m.data.connection);
    m = await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", queryPath: "/custom/query" });
    ok("changing settings keeps the stored credentials (none re-sent)", m.ok && m.data.connection.hasCredentials === true && m.data.connection.queryPath === "/custom/query" && m.data.connection.commandLine === true, m.data.connection);
    await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", queryPath: "/query" });
    for (const [what, bad] of [["a path with ..", { queryPath: "/a/../b" }], ["an absolute URL as a path", { queryPath: "http://evil.example/x" }], ["a path with a query string", { commandsPath: "/c?x=1" }], ["a double slash", { queryPath: "//evil" }], ["a path that doesn't start with /", { queryPath: "query" }]]) {
        m = await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", ...bad });
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    await A.sd("admin.appconn.save", { name: "crm", url: appUrl, authType: "basic", credentials: { username: "svc", password: "pw123" } });
    await A.sd("admin.appconn.save", { name: "open", url: appUrl, authType: "none" });
    await A.sd("admin.appconn.save", { name: "dead", url: "http://127.0.0.1:1", authType: "none" });
    m = await Ann.sd("applications.list");
    ok("anyone can list the connected applications", m.ok && m.data.applications.map((a) => a.name).sort().join() === "crm,dead,erp,open", m.data);
    ok("...but only names and the command-line flag (no addresses, no credentials)", m.data.applications.every((a) => Object.keys(a).sort().join() === "commandLine,name") && !JSON.stringify(m.data).includes(appUrl), m.data);
    m = await A.sd("admin.appconn.test", { name: "erp" });
    ok("an administrator can test a connection", m.ok && m.data.reachable === true, m);
    m = await A.sd("admin.appconn.test", { name: "dead" });
    ok("an unreachable application gives a clear error, not a hang", !m.ok && m.error.code === "upstream_unavailable", m.error);
    m = await A.sd("admin.appconn.test", { name: "nope" });
    ok("testing an unknown connection is not_found", !m.ok && m.error.code === "not_found", m.error);
    m = await Ann.sd("admin.appconn.test", { name: "erp" });
    ok("only administrators may test connections", !m.ok && m.error.code === "forbidden", m.error);
    m = await Ann.sd("applications.commands", { name: "erp" });
    ok("an application's own commands can be listed (name, caption, description)", m.ok && m.data.commands.length === 2 && m.data.commands[0].name === "stock" && m.data.commands[0].caption === "Stock check" && m.data.commands[1].caption === "Invoices", m);
    ok("the connection's credentials were used for that call", last((r) => r.url === "/commands")?.headers.authorization === "Bearer secret123");
    m = await Ann.sd("applications.commands", { name: "nope" });
    ok("commands of an unknown application -> not_found", !m.ok && m.error.code === "not_found", m.error);

    t.section("Defining data sources: what is allowed");
    const ds = (o) => A.sd("datasource.save", o);
    m = await ds({ name: "city_customers", type: "sql", connection: "erp", sql: "SELECT id, name, city FROM customers WHERE city = :city ORDER BY name",
        params: [{ name: "city", default: "Pune" }], description: "Customers of a city" });
    ok("an administrator defines a SQL data source with a parameter", m.ok && m.data.datasource.type === "sql" && m.data.datasource.params[0].name === "city" && m.data.datasource.hasSql === true, m);
    ok("the list does not repeat the SQL text (only says it has some)", !("sql" in m.data.datasource));
    m = await ds({ name: "all_customers", type: "api", connection: "erp", path: "/customers", method: "GET", params: [{ name: "city" }] });
    ok("...and an API data source (a path on the connection)", m.ok && m.data.datasource.type === "api", m);
    for (const [what, sql, re] of [
        ["INSERT", "INSERT INTO t VALUES (1)", /Only a SELECT/],
        ["DROP", "DROP TABLE customers", /Only a SELECT/],
        ["a second statement", "SELECT 1; DELETE FROM customers", /one statement/],
        ["a hidden UPDATE after a semicolon", "SELECT 1;UPDATE t SET a=1", /one statement/],
        ["a line comment", "SELECT 1 -- ; drop it", /Comments/],
        ["a block comment", "SELECT /* x */ 1", /Comments/],
        ["SELECT ... INTO", "SELECT * INTO newtable FROM customers", /may not use into/],
        ["a data-changing word inside a subquery", "SELECT * FROM (DELETE FROM t RETURNING *) x", /may not use delete/],
        ["EXEC", "EXEC sp_who", /Only a SELECT/],
        ["a statement that isn't a query", "SHOW TABLES", /Only a SELECT/],
        ["an empty statement", "   ", /required/],
    ]) {
        m = await ds({ name: "bad_sql", type: "sql", connection: "erp", sql });
        ok(`SQL with ${what} is refused`, !m.ok && re.test(m.error.message), m.error);
    }
    m = await ds({ name: "tricky_ok", type: "sql", connection: "erp", sql: "SELECT id FROM notes WHERE note = 'please update or delete me; -- ok' AND created::date = :d", params: [{ name: "d" }] });
    ok("keywords, ';' and '--' inside a quoted text are fine, and '::' is not a parameter", m.ok, m);
    m = await ds({ name: "with_ok", type: "sql", connection: "erp", sql: "WITH c AS (SELECT * FROM customers) SELECT * FROM c" });
    ok("WITH ... SELECT is allowed", m.ok, m);
    m = await ds({ name: "bad_ph", type: "sql", connection: "erp", sql: "SELECT * FROM t WHERE a = :nothing_by_that_name" });
    ok("a :placeholder with no parameter or variable behind it is refused", !m.ok && /:nothing_by_that_name/.test(m.error.message), m.error);
    m = await ds({ name: "global_ph", type: "sql", connection: "erp", sql: "SELECT * FROM customers WHERE city = :city AND dept = :department" });
    ok("a :placeholder may name a global variable directly", m.ok, m);
    m = await ds({ name: "long_sql", type: "sql", connection: "erp", sql: "SELECT " + "a,".repeat(2500) + "b FROM t" });
    ok("very long SQL is refused", !m.ok, m.error);
    for (const [what, o] of [
        ["a name that starts with a digit", { name: "1abc", type: "sql", connection: "erp", sql: "SELECT 1" }],
        ["an unknown type", { name: "x1", type: "shell", connection: "erp", sql: "SELECT 1" }],
        ["a connection that doesn't exist", { name: "x2", type: "sql", connection: "ghost", sql: "SELECT 1" }],
        ["a duplicate parameter name", { name: "x3", type: "sql", connection: "erp", sql: "SELECT :a", params: [{ name: "a" }, { name: "A" }] }],
        ["a parameter with a bad name", { name: "x4", type: "sql", connection: "erp", sql: "SELECT 1", params: [{ name: "1a" }] }],
        ["an object as a parameter default", { name: "x5", type: "sql", connection: "erp", sql: "SELECT :a", params: [{ name: "a", default: { x: 1 } }] }],
        ["more than 20 parameters", { name: "x6", type: "sql", connection: "erp", sql: "SELECT 1", params: Array.from({ length: 21 }, (_, i) => ({ name: `p${i}` })) }],
        ["an API path with ..", { name: "x7", type: "api", connection: "erp", path: "/a/../b" }],
        ["an API path that is a URL", { name: "x8", type: "api", connection: "erp", path: "http://evil.example/" }],
        ["an API method other than GET/POST", { name: "x9", type: "api", connection: "erp", path: "/customers", method: "DELETE" }],
        ["unknown 'applicable' rules", { name: "x10", type: "sql", connection: "erp", sql: "SELECT 1", applicable: { departments: ["Nowhere"] } }],
    ]) {
        m = await ds(o);
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }

    t.section("Personal data sources need the administrator's permission");
    m = await Ann.sd("datasource.save", { name: "ann_ds", type: "sql", connection: "erp", sql: "SELECT id FROM customers" });
    ok("by default people can't define data sources on a connection", !m.ok && m.error.code === "forbidden", m.error);
    await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", allowUserDatasources: true });
    m = await Ann.sd("datasource.save", { name: "ann_ds", type: "sql", connection: "erp", sql: "SELECT id, name FROM customers WHERE city = :city", params: [{ name: "city", default: "Delhi" }] });
    ok("once the administrator allows it, people can (SELECT only, same checks)", m.ok && m.data.datasource.owner === ann, m);
    m = await Ann.sd("datasource.save", { name: "ann_bad", type: "sql", connection: "erp", sql: "DROP TABLE x" });
    ok("...and the SQL checks still apply to them", !m.ok && m.error.code === "invalid", m.error);
    m = await Ann.sd("datasource.save", { name: "ann_open", type: "api", connection: "open", path: "/open" });
    ok("people can't use a connection the administrator hasn't opened up", !m.ok && m.error.code === "forbidden", m.error);
    m = await Cal.sd("datasource.list");
    ok("a personal data source is invisible to others", !m.data.datasources.some((d) => d.name === "ann_ds"), m.data.datasources.map((d) => d.name));
    m = await Cal.sd("datasource.run", { name: "ann_ds" });
    ok("...and can't be run by them", !m.ok && m.error.code === "not_found", m.error);
    m = await Cal.sd("datasource.save", { name: "ann_ds", type: "sql", connection: "erp", sql: "SELECT 1" });
    ok("...nor overwritten (someone else's name)", !m.ok && m.error.code === "forbidden", m.error);
    m = await Cal.sd("datasource.delete", { name: "ann_ds" });
    ok("...nor deleted", !m.ok, m.error);
    m = await Ann.sd("datasource.save", { name: "ann_ds", type: "sql", connection: "erp", sql: "SELECT id FROM customers WHERE city = :city", params: [{ name: "city" }], applicable: { departments: ["Sales"] } });
    ok("a person's own rules are ignored (only administrators set 'applicable')", m.ok && Object.keys(m.data.datasource.applicable).length === 0, m.data);
    m = await Ann.sd("datasource.delete", { name: "ann_ds" });
    ok("the owner can delete their own", m.ok, m);

    t.section("Running a data source (SQL): values are bound, never pasted");
    seen.length = 0;
    m = await Ann.sd("datasource.run", { name: "city_customers", values: { city: "Pune" } });
    ok("it returns columns and rows, from the application's array-style answer", m.ok && m.data.columns.join() === "id,name,city" && m.data.rows.length === 3 && m.data.rows[0].name === "Asha", m);
    const q = last((r) => r.url === "/query");
    const sent = JSON.parse(q.body);
    ok("the SQL text reached the application exactly as defined (placeholder intact)", sent.sql === "SELECT id, name, city FROM customers WHERE city = :city ORDER BY name", sent.sql);
    ok("the value travelled separately as a bound parameter", sent.params.city === "Pune", sent.params);
    ok("the connection's bearer credentials were sent", q.headers.authorization === "Bearer secret123" && q.method === "POST");
    m = await Ann.sd("datasource.run", { name: "city_customers", values: { city: "x'; DROP TABLE customers; --" } });
    const inj = JSON.parse(last((r) => r.url === "/query").body);
    ok("a hostile value stays inside `params`; the SQL is untouched", m.ok && inj.sql.includes(":city") && !inj.sql.includes("DROP") && inj.params.city === "x'; DROP TABLE customers; --", inj);
    m = await Ann.sd("datasource.run", { name: "city_customers" });
    ok("with no value given, the parameter's own default is used", JSON.parse(last((r) => r.url === "/query").body).params.city === "Pune" && m.ok);
    await A.sd("datasource.save", { name: "by_user_city", type: "sql", connection: "erp", sql: "SELECT id, name, city FROM customers WHERE city = :city", params: [] });
    m = await Ann.sd("datasource.run", { name: "by_user_city" });
    ok("a :placeholder named like a global variable is filled from the caller's own details (Ann lives in Pune)", m.ok && JSON.parse(last((r) => r.url === "/query").body).params.city === "Pune", m);
    m = await Bob.sd("datasource.run", { name: "by_user_city" });
    ok("...and differs per person (Bob lives in Mumbai)", m.ok && JSON.parse(last((r) => r.url === "/query").body).params.city === "Mumbai" && m.data.rows.length === 1, m);
    m = await Ann.sd("datasource.run", { name: "city_customers", values: { city: "Pune" }, limit: 2 });
    ok("limit caps the rows and says so (truncated)", m.ok && m.data.rows.length === 2 && m.data.total === 3 && m.data.truncated === true, m.data);
    m = await Ann.sd("datasource.run", { name: "city_customers", values: { city: "Nowhere" } });
    ok("no matching rows is an empty result, not an error", m.ok && m.data.rows.length === 0 && m.data.truncated === false, m);
    m = await Ann.sd("datasource.run", { name: "city_customers", values: { city: { a: 1 } } });
    ok("a non-scalar value is not sent as-is (becomes empty)", m.ok && JSON.parse(last((r) => r.url === "/query").body).params.city === "Pune" || JSON.parse(last((r) => r.url === "/query").body).params.city === null, m);
    m = await Ann.sd("datasource.run", { name: "nope" });
    ok("an unknown data source is not_found", !m.ok && m.error.code === "not_found", m.error);

    t.section("Running a data source (API): GET, POST and answer shapes");
    m = await Ann.sd("datasource.run", { name: "all_customers", values: { city: "Mumbai" } });
    ok("a GET data source passes the parameters in the query string", m.ok && m.data.rows.length === 1 && m.data.rows[0].name === "Chen" && last((r) => r.url.startsWith("/customers")).url === "/customers?city=Mumbai", m);
    m = await Ann.sd("datasource.run", { name: "all_customers", values: { city: "New Delhi & Co é" } });
    ok("values are URL-encoded properly (spaces, & and non-ASCII)", last((r) => r.url.startsWith("/customers")).url === "/customers?city=New%20Delhi%20%26%20Co%20%C3%A9" && m.ok, last((r) => r.url.startsWith("/customers")).url);
    await A.sd("datasource.save", { name: "products", type: "api", connection: "erp", path: "/products" });
    m = await Ann.sd("datasource.run", { name: "products" });
    ok("an answer wrapped in {data:[...]} is understood; columns come from the first row", m.ok && m.data.rows.length === 2 && m.data.columns.join() === "price,sku", m.data);
    await A.sd("datasource.save", { name: "place_order", type: "api", connection: "erp", path: "/orders", method: "POST", params: [{ name: "who" }, { name: "qty", default: 3 }] });
    m = await Ann.sd("datasource.run", { name: "place_order", values: { who: "ann" } });
    ok("a POST data source sends the parameters as a JSON body", m.ok && m.data.rows[0].echoed === "ann" && m.data.rows[0].qty === 3 && last((r) => r.url === "/orders").method === "POST", m.data);
    await A.sd("datasource.save", { name: "crm_ok", type: "api", connection: "crm", path: "/basic" });
    m = await Ann.sd("datasource.run", { name: "crm_ok" });
    ok("basic-auth credentials work too", m.ok && m.data.rows[0].ok === true, m);
    await A.sd("datasource.save", { name: "open_ok", type: "api", connection: "open", path: "/open" });
    ok("a connection with no credentials works", (await Ann.sd("datasource.run", { name: "open_ok" })).ok);

    t.section("When the application misbehaves");
    const failing = async (name, path, code, connection = "erp") => {
        await A.sd("datasource.save", { name, type: "api", connection, path });
        const r = await Ann.sd("datasource.run", { name });
        ok(`${path} -> ${code}`, !r.ok && r.error.code === code, r.error);
        return r;
    };
    await failing("f_500", "/err500", "upstream_error");
    await failing("f_json", "/notjson", "bad_response");
    await failing("f_rows", "/notrows", "bad_response");
    await failing("f_big", "/big", "too_large");
    await failing("f_404", "/missing", "upstream_error");
    await A.sd("admin.appconn.save", { name: "wrongkey", url: appUrl, authType: "bearer", credentials: { token: "WRONG" } });
    await failing("f_denied", "/customers", "upstream_denied", "wrongkey");
    await failing("f_dead", "/customers", "upstream_unavailable", "dead");
    const t0 = Date.now();
    const slow = await failing("f_slow", "/slow", "upstream_timeout");
    ok("a slow application is cut off at the time limit (1.5 s here)", Date.now() - t0 < 3500, Date.now() - t0);
    ok("no error message leaks the application's address or credentials", ![slow, (await Ann.sd("datasource.run", { name: "f_denied" }))].some((r) => JSON.stringify(r).includes(appUrl) || JSON.stringify(r).includes("secret123")));

    t.section("Slow calls never freeze the connection");
    const s0 = Date.now();
    const slowId = Ann.fire("datasource.run", { name: "f_slow" });
    await sleep(100);
    const me = await Ann.sd("me");
    ok("while a data source is being waited on, other requests answer immediately", me.ok && Date.now() - s0 < 800, Date.now() - s0);
    Ann.send("/list");
    ok("...and so does chat", !!(await Ann.wait((x) => x.type === "users", 1500)));
    const slowRes = await Ann.waitReply(slowId, 4000);
    ok("the slow call still delivers its own reply", !!slowRes && slowRes.error?.code === "upstream_timeout", slowRes);

    t.section("Who may use an administrator's data source");
    await A.sd("datasource.save", { name: "sales_only", type: "sql", connection: "erp", sql: "SELECT id FROM customers", applicable: { departments: ["Sales"] } });
    ok("a data source limited to a department is listed for that department", (await Bob.sd("datasource.list")).data.datasources.some((d) => d.name === "sales_only"));
    ok("...and not for others", !(await Ann.sd("datasource.list")).data.datasources.some((d) => d.name === "sales_only"));
    m = await Ann.sd("datasource.run", { name: "sales_only" });
    ok("...and they can't run it either", !m.ok && m.error.code === "not_found", m.error);
    ok("the one meant for Sales runs for Sales", (await Bob.sd("datasource.run", { name: "sales_only" })).ok);
    m = await Ann.sd("datasource.get", { name: "city_customers" });
    ok("datasource.get shows the definition", m.ok && m.data.datasource.name === "city_customers", m);
    m = await A.sd("admin.datasource.list");
    ok("an administrator can list every data source", m.ok && m.data.datasources.length >= 10, m.data.datasources.length);
    m = await Ann.sd("admin.datasource.list");
    ok("...and nobody else can", !m.ok && m.error.code === "forbidden", m.error);
    m = await A.sd("datasource.delete", { name: "sales_only" });
    ok("an administrator can delete data sources", m.ok, m);

    t.section("Rate limit");
    let limited = 0;
    for (let i = 0; i < 70; i++) { const r = await Cal.sd("datasource.run", { name: "open_ok" }); if (!r.ok && r.error.code === "rate_limited") limited++; }
    ok("a person can run at most 60 data source calls a minute", limited >= 8 && limited <= 12, limited);

    t.section("Global variables: built in");
    m = await Ann.sd("globals.list");
    ok("the spec's variables are all there", ["userName", "category", "affiliate", "branch", "department", "city", "country", "pin"].every((n) => m.data.builtins.includes(n)), m.data.builtins);
    ok("...with this person's values", m.data.values.userName === "Ann Ops" && m.data.values.department === "Ops" && m.data.values.city === "Pune" && m.data.values.category === "Employee" && m.data.values.branch === "HQ" && m.data.values.pin === "411001", m.data.values);
    m = await Bob.sd("globals.list");
    ok("...and different for someone else", m.data.values.city === "Mumbai" && m.data.values.department === "Sales", m.data.values);

    t.section("Global variables: custom");
    m = await A.sd("admin.globals.save", { name: "tier", default: "gold", description: "Loyalty tier" });
    ok("an administrator defines a variable with a default", m.ok && m.data.variable.default === "gold", m);
    m = await Ann.sd("globals.list");
    ok("it is listed, and part of everyone's values", m.data.custom.some((g) => g.name === "tier") && m.data.values.tier === "gold", m.data);
    await A.sd("admin.globals.save", { name: "max_qty", default: 10 });
    await A.sd("admin.globals.save", { name: "vip", default: true });
    ok("numbers and true/false defaults work", (await Ann.sd("globals.list")).data.values.max_qty === 10 && (await Ann.sd("globals.list")).data.values.vip === true);
    m = await A.sd("admin.globals.save", { name: "tier", default: "silver" });
    ok("saving again changes it", m.ok && (await Ann.sd("globals.list")).data.values.tier === "silver");
    for (const [what, o] of [
        ["redefining a built-in", { name: "city", default: "x" }],
        ["a built-in in another letter case", { name: "CITY", default: "x" }],
        ["a name with a space", { name: "my var", default: 1 }],
        ["a name starting with a digit", { name: "1x", default: 1 }],
        ["an object as the default", { name: "objdef", default: { a: 1 } }],
        ["a datasource without a column", { name: "ds1", datasource: "products" }],
        ["a column without a datasource", { name: "ds2", column: "sku" }],
        ["an unknown data source", { name: "ds3", datasource: "ghost", column: "x" }],
    ]) {
        m = await A.sd("admin.globals.save", o);
        ok(`${what} is refused`, !m.ok && m.error.code === "invalid", m.error);
    }
    m = await Ann.sd("admin.globals.save", { name: "sneaky", default: 1 });
    ok("only administrators define variables", !m.ok && m.error.code === "forbidden", m.error);
    await A.sd("datasource.save", { name: "region_of_user", type: "sql", connection: "erp", sql: "SELECT region, tier FROM regions WHERE city = :city" });
    m = await A.sd("admin.globals.save", { name: "region", default: "Unknown", datasource: "region_of_user", column: "region" });
    ok("a variable can read its value from a data source", m.ok && m.data.variable.datasource === "region_of_user" && m.data.variable.column === "region", m);
    m = await Ann.sd("globals.list");
    ok("globals.list stays instant: it shows the default, without calling the application", m.data.values.region === "Unknown", m.data.values.region);
    seen.length = 0;
    m = await Ann.sd("globals.resolve");
    ok("globals.resolve asks the data source and returns the real value", m.ok && m.data.values.region === "West", m.data.values);
    ok("...binding the person's own details as parameters", JSON.parse(last((r) => r.url === "/query").body).params.city === "Pune");
    await A.sd("admin.appconn.save", { name: "erp", url: "http://127.0.0.1:1", authType: "bearer", allowUserDatasources: true });
    m = await Ann.sd("globals.resolve");
    ok("if the application is down the default is used (nothing breaks)", m.ok && m.data.values.region === "Unknown" && m.data.values.city === "Pune", m.data.values);
    await A.sd("admin.appconn.save", { name: "erp", url: appUrl, authType: "bearer", allowUserDatasources: true });
    m = await A.sd("datasource.delete", { name: "region_of_user" });
    ok("a data source a variable reads from can't be deleted", !m.ok && m.error.code === "in_use", m.error);

    t.section("Variables in option conditions");
    await A.sd("admin.tstruct.save", { name: "f1", caption: "F1", fields: [{ name: "a", type: "text", caption: "A" }] });
    m = await A.sd("admin.option.save", { id: "gold_only", caption: "Gold members", type: "data_input", target: "f1", condition: { field: "tier", op: "eq", value: "gold" } });
    ok("an option can be conditional on a custom variable", m.ok, m);
    const ids = async (c) => (await c.sd("options.list")).data.options.map((o) => o.id);
    ok("(tier is silver now) so it is hidden", !(await ids(Ann)).includes("gold_only"));
    await A.sd("admin.globals.save", { name: "tier", default: "gold" });
    ok("changing the variable's default shows it at once", (await ids(Ann)).includes("gold_only"));
    m = await A.sd("admin.option.save", { id: "region_opt", caption: "West only", type: "data_input", target: "f1", condition: { field: "region", op: "eq", value: "Unknown" } });
    ok("...and the condition can name a data-source variable (uses its instant default)", m.ok && (await ids(Ann)).includes("region_opt"), m);
    m = await A.sd("admin.globals.delete", { name: "tier" });
    ok("a variable can be deleted", m.ok, m);
    m = await A.sd("admin.globals.delete", { name: "tier" });
    ok("deleting it again is not_found", !m.ok && m.error.code === "not_found", m.error);
    ok("an option that referred to a deleted variable no longer matches (it can't be evaluated)", !(await ids(Ann)).includes("gold_only"));

    for (const c of [Ann, Bob, Cal, A]) c.close();
    app.server.close();
    t.done();
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(1); });
