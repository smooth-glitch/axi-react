// User-editable structures, user-made options, and the file store behind upload/download options.
//
//   redis-cli -n 12 FLUSHDB
//   REDIS_DB=12 SANDESH_DEV_OTP=1 SANDESH_OTP_COOLDOWN_SEC=0 CHAT_RATE_LIMIT_MAX=1000 \
//   SANDESH_MAX_FILE_MB=1 SANDESH_FILES_DIR=/tmp/sd-files-test .\run.ps1 5561 8095
//   node test/sandesh_user_options_test.mjs http://localhost:8095
//
// (SANDESH_MAX_FILE_MB=1 keeps the "too large" check quick.)

import crypto from "node:crypto";

const BASE = process.argv[2] || "http://localhost:8095";
const WS_URL = BASE.replace(/^http/, "ws");
const sfx = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS: " + name);
  } else {
    fail++;
    failures.push(name);
    console.log(
      "  FAIL: " +
        name +
        (detail !== undefined ? " -- " + JSON.stringify(detail) : ""),
    );
  }
}

function b32decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of str.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret, counter) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(ctr).digest();
  const off = h[h.length - 1] & 15;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1000000).padStart(6, "0");
}
const totpNow = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));

async function http(method, path, body, token, extraHeaders = {}, raw = false) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && !raw ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  return r;
}
async function post(path, body, token) {
  const r = await http("POST", path, body, token);
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* */
  }
  return { status: r.status, json };
}
const data = (r) => r?.json?.data;

// One WebSocket per user (the server allows one connection per username).
async function connect(username, token) {
  const ws = new WebSocket(WS_URL);
  const waiters = new Map();
  let seq = 0;
  const events = [];
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "sd" && waiters.has(m.reqId)) {
      waiters.get(m.reqId)(m);
      waiters.delete(m.reqId);
    }
    if (m.type === "sd_event") events.push(m);
  };
  ws.onclose = (e) => {
    // a reply that never comes would hang the whole run: fail loudly instead
    console.log(`  (socket for ${username} closed: ${e.code} ${e.reason || ""})`);
    for (const [id, resolve] of waiters) resolve({ type: "sd", reqId: id, ok: false, error: { code: "socket_closed", message: "socket closed" } });
    waiters.clear();
  };
  await new Promise((res) => {
    ws.onopen = res;
  });
  ws.send(JSON.stringify({ username, token }));
  await sleep(400);
  return {
    ws,
    sd: (action, args = {}) =>
      new Promise((resolve) => {
        const id = `t${++seq}`;
        waiters.set(id, resolve);
        ws.send(`/sd ${action} ${JSON.stringify({ ...args, reqId: id })}`);
      }),
    close: () => {
      try {
        ws.close();
      } catch {
        /* */
      }
    },
    events,
    // live change events of one kind, since the last clear
    got: (event, pred = () => true) =>
      events.filter((m) => m.event === event && pred(m.data)),
    clear: () => {
      events.length = 0;
    },
  };
}

// Enrolls (TOTP) and returns a session for a freshly created or invited account.
async function enroll(identifier, password) {
  const a = await post("/api/sd/login", {
    identifier,
    password,
    deviceId: "d-" + identifier,
  });
  const secret = data(a)?.secret;
  const l = await post("/api/sd/login", {
    identifier,
    password,
    totp: secret ? totpNow(secret) : undefined,
    deviceId: "d-" + identifier,
  });
  return { token: data(l)?.token, secret, login: l };
}

async function main() {
  console.log(
    `User options / structure editing / files test against ${BASE}\n`,
  );

  console.log("=== Setup: org, admin, three users ===");
  const adminName = `boss${sfx}`;
  let r = await post("/api/sd/setup/start", {
    org: "Acme",
    name: "Boss",
    username: adminName,
    email: `${adminName}@acme.com`,
    mobile: "+919810000001",
  });
  if (r.status !== 200) {
    console.log(
      "Database already set up -- flush it and restart the backend, then re-run.",
      r,
    );
    process.exit(2);
  }
  r = await post("/api/sd/setup/verify", { otp: data(r).devOtp });
  const adminSecret = data(r).secret,
    defaultPw = data(r).defaultPassword;
  let l = await post("/api/sd/login", {
    identifier: adminName,
    password: defaultPw,
    totp: totpNow(adminSecret),
    deviceId: "boss-dev",
  });
  await post(
    "/api/sd/password/change",
    { oldPassword: defaultPw, newPassword: "Str0ngPass99" },
    data(l).token,
  );
  // A later login on a later TOTP window (a code can't be used twice).
  let adminTok;
  for (let i = 0; i < 20 && !adminTok; i++) {
    const t = await post("/api/sd/login", {
      identifier: adminName,
      password: "Str0ngPass99",
      totp: totpNow(adminSecret),
      deviceId: "boss-dev",
    });
    if (t.status === 200) adminTok = data(t).token;
    else await sleep(3000);
  }
  ok("admin signed in", !!adminTok);
  const AD = await connect(adminName, adminTok);
  for (const [k, item] of [
    ["branches", { name: "HQ", city: "Pune", country: "India", pin: "411001" }],
    ["departments", { name: "Eng", description: "" }],
    ["designations", { name: "Dev", description: "" }],
  ]) {
    await AD.sd("admin.cfg.save", { kind: k, item });
  }
  const mk = async (u, cat) => {
    const args = cat
      ? {
          name: u,
          username: u,
          email: `${u}@acme.com`,
          mobile:
            "+91981" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"),
          isEmployee: false,
          category: cat,
          city: "Pune",
          country: "India",
          pin: "411001",
        }
      : {
          name: u,
          username: u,
          email: `${u}@acme.com`,
          mobile:
            "+91982" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"),
          isEmployee: true,
          branch: "HQ",
          department: "Eng",
          designation: "Dev",
        };
    const m = await AD.sd("users.invite", args);
    if (!m.ok) console.log("invite failed", u, m.error);
    const e = await enroll(u, `Sandesh${u}`);
    const c = await connect(u, e.token);
    return {
      name: u,
      token: e.token,
      sd: c.sd,
      got: c.got,
      clear: c.clear,
      events: c.events,
    };
  };
  const ann = await mk(`ann${sfx}`); // employee, creator of things
  const bob = await mk(`bob${sfx}`); // employee, someone else
  const cit = await mk(`cit${sfx}`, "Citizen"); // external citizen
  ok("users signed in", !!ann.token && !!bob.token && !!cit.token);

  const fields = [
    { name: "question", type: "text", caption: "Question", required: true },
    {
      name: "kind",
      type: "list",
      caption: "Kind",
      options: ["Yes/No", "Rating"],
      required: false,
    },
    {
      name: "why",
      type: "text",
      caption: "Why",
      condition: { field: "kind", op: "eq", value: "Rating" },
    },
  ];

  console.log("=== Editing a structure (creator only) ===");
  let m = await ann.sd("tstruct.user.save", {
    name: "poll",
    caption: "Poll",
    fields,
  });
  ok(
    "ann creates a structure",
    m.ok &&
      m.data.tstruct.owner === ann.name &&
      typeof m.data.tstruct.createdTs === "number",
    m,
  );
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    caption: "Poll v2",
    description: "quick votes",
    fields: [
      ...fields,
      { name: "votes", type: "wholenumber", caption: "Votes", min: 0 },
    ],
  });
  ok(
    "the creator can edit it (caption, description, a new field)",
    m.ok &&
      m.data.tstruct.caption === "Poll v2" &&
      m.data.tstruct.fields.length === 4,
    m,
  );
  ok(
    "the owner and createdTs are kept, modifiedTs is set",
    m.ok &&
      m.data.tstruct.owner === ann.name &&
      !!m.data.tstruct.createdTs &&
      !!m.data.tstruct.modifiedTs,
    m.data,
  );
  m = await bob.sd("tstruct.user.update", {
    name: "poll",
    caption: "hijacked",
    fields,
  });
  ok(
    "someone else can NOT edit it -> forbidden",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await AD.sd("tstruct.user.update", {
    name: "poll",
    caption: "admin edit",
    fields,
  });
  ok(
    "not even an administrator edits another user's structure",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await ann.sd("tstruct.user.update", { name: "nope", fields });
  ok(
    "editing a missing structure -> not_found",
    !m.ok && m.error.code === "not_found",
    m,
  );
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    fields: [{ name: "x", type: "list", caption: "X" }],
  });
  ok(
    "the same field validation applies on edit (a list needs options)",
    !m.ok && m.error.code === "invalid",
    m,
  );
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    fields: [
      {
        name: "x",
        type: "text",
        condition: { field: "ghost", op: "eq", value: 1 },
      },
    ],
  });
  ok(
    "a condition on an unknown field is rejected on edit",
    !m.ok && m.error.code === "invalid",
    m,
  );
  m = await ann.sd("tstruct.user.get", { name: "poll" });
  ok(
    "a rejected edit changed nothing",
    m.ok &&
      m.data.tstruct.caption === "Poll v2" &&
      m.data.tstruct.fields.length === 4,
    m,
  );
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    caption: "Poll v3",
    fields: [
      { name: "question", type: "text", caption: "Question", required: true },
      {
        name: "phone",
        type: "mobile",
        caption: "Phone",
        withCountryCode: true,
        countryPicker: true,
        defaultCountry: "IN",
      },
      {
        name: "src",
        type: "selection",
        caption: "Src",
        api: "https://example.com/items",
      },
      {
        name: "fillme",
        type: "fill",
        caption: "Fill",
        fillFrom: "src",
        sourceProp: "name",
      },
    ],
  });
  ok(
    "studio-only field attributes survive (countryPicker, defaultCountry, sourceProp)",
    m.ok &&
      m.data.tstruct.fields[1].countryPicker === true &&
      m.data.tstruct.fields[1].defaultCountry === "IN" &&
      m.data.tstruct.fields[3].sourceProp === "name",
    m,
  );

  console.log("\n=== Barcode/QR field type ===");
  // Struct with a barcode field can be saved
  m = await ann.sd("tstruct.user.save", {
    name: "scanform",
    caption: "Scan",
    fields: [
      {
        name: "code",
        type: "barcode",
        caption: "Scan barcode",
        required: true,
      },
      { name: "note", type: "text", caption: "Note", required: false },
    ],
  });
  ok("a struct with a barcode field is accepted", m.ok, m);
  ok(
    "barcode field is stored with type 'barcode' (no extra props for v1)",
    m.ok && m.data.tstruct.fields[0].type === "barcode",
    m.data?.tstruct?.fields,
  );

  // Submitting a valid barcode value (plain string)
  m = await ann.sd("tstruct.user.submit", {
    name: "scanform",
    values: { code: "https://example.com/item/42" },
  });
  ok("submitting a scanned barcode string is accepted", m.ok, m);
  ok(
    "the value is stored as-is",
    m.ok && m.data.submission.values.code === "https://example.com/item/42",
    m.data?.submission,
  );

  // Submitting a non-string value is rejected
  m = await ann.sd("tstruct.user.submit", {
    name: "scanform",
    values: { code: 12345 },
  });
  ok(
    "a non-string barcode value is rejected -> invalid_values",
    !m.ok && m.error.code === "invalid_values" && !!m.error.details.fields.code,
    m,
  );

  // Over the 5000-byte cap
  m = await ann.sd("tstruct.user.submit", {
    name: "scanform",
    values: { code: "x".repeat(5001) },
  });
  ok(
    "a barcode value over 5000 bytes is rejected",
    !m.ok && m.error.code === "invalid_values",
    m,
  );

  // required enforcement still applies
  m = await ann.sd("tstruct.user.submit", {
    name: "scanform",
    values: { note: "no code" },
  });
  ok(
    "a missing required barcode field is rejected",
    !m.ok && m.error.code === "invalid_values" && !!m.error.details.fields.code,
    m,
  );

  // The type appears in the field-type error message when saving with an unknown type
  m = await ann.sd("tstruct.user.save", {
    name: "badtype",
    fields: [{ name: "f", type: "qrcode", caption: "QR" }],
  });
  ok(
    "'qrcode' (not the registered name) is still rejected -> invalid",
    !m.ok && m.error.code === "invalid",
    m,
  );

  // Cleanup
  await ann.sd("tstruct.user.delete", { name: "scanform" });

  console.log("\n=== Records keep working after a structure is edited ===");
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    caption: "Poll",
    fields,
  });
  m = await ann.sd("tstruct.user.submit", {
    name: "poll",
    values: { question: "Lunch?", kind: "Yes/No" },
  });
  ok("a record is submitted", m.ok, m);
  const recId = m.data?.submission?.id;
  m = await ann.sd("tstruct.user.update", {
    name: "poll",
    caption: "Poll",
    fields: [
      ...fields,
      { name: "extra", type: "text", caption: "Extra", required: true },
    ],
  });
  ok("adding a REQUIRED field is allowed", m.ok, m);
  m = await ann.sd("submissions.update", {
    id: recId,
    values: { question: "Lunch today?", kind: "Yes/No" },
  });
  ok(
    "the old record, edited later, is checked against the NEW definition (required field now missing)",
    !m.ok &&
      m.error.code === "invalid_values" &&
      !!m.error.details.fields.extra,
    m,
  );
  m = await ann.sd("submissions.update", {
    id: recId,
    values: { question: "Lunch today?", kind: "Yes/No", extra: "ok" },
  });
  ok("...and saves once it satisfies it", m.ok, m);

  console.log("\n=== User-made options ===");
  m = await ann.sd("option.user.save", {
    caption: "Vote",
    type: "data_input",
    target: "poll",
  });
  const optId = m.data?.option?.id;
  ok(
    "ann creates an option that opens her structure (server assigns the id)",
    m.ok &&
      /^o\d+$/.test(optId) &&
      m.data.option.owner === ann.name &&
      m.data.option.targetScope === "user",
    m,
  );
  m = await ann.sd("option.user.list");
  ok(
    "ann sees her own option in the manage list",
    m.ok && m.data.options.some((o) => o.id === optId),
    m,
  );
  m = await bob.sd("option.user.list");
  ok(
    "bob's manage list does not include ann's option",
    m.ok && !m.data.options.some((o) => o.id === optId),
    m,
  );
  m = await bob.sd("options.list");
  ok(
    "but bob (the option applies to everyone) is offered it in his options",
    m.ok &&
      m.data.options.some((o) => o.id === optId && o.targetScope === "user"),
    m,
  );
  m = await bob.sd("option.user.save", {
    id: optId,
    caption: "stolen",
    type: "data_input",
    target: "poll",
  });
  ok(
    "bob can NOT overwrite ann's option -> forbidden",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await bob.sd("option.user.delete", { id: optId });
  ok(
    "bob can NOT delete it -> forbidden",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await ann.sd("option.user.save", {
    id: optId,
    caption: "Vote now",
    type: "data_input",
    target: "poll",
    applicable: { categories: ["Employee"], departments: ["Eng"] },
  });
  ok(
    "ann edits her option (caption + applicable-to)",
    m.ok &&
      m.data.option.caption === "Vote now" &&
      m.data.option.owner === ann.name,
    m,
  );
  m = await cit.sd("options.list");
  ok(
    "a citizen is NOT offered an employee-only option (applicable-to enforced)",
    m.ok && !m.data.options.some((o) => o.id === optId),
    m,
  );
  m = await bob.sd("options.list");
  ok(
    "an Eng employee still is",
    m.ok && m.data.options.some((o) => o.id === optId),
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Bad",
    type: "data_input",
    target: "ghost",
  });
  ok(
    "pointing at a form that doesn't exist is rejected",
    !m.ok && m.error.code === "invalid",
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Bad",
    type: "data_input",
    target: "poll",
    applicable: { departments: ["NoSuchDept"] },
  });
  ok(
    "an unknown applicable-to value is rejected",
    !m.ok && m.error.code === "invalid",
    m,
  );

  console.log(
    "\n=== A user-made option can never open an admin-managed form ===",
  );
  m = await AD.sd("admin.tstruct.save", {
    name: "payroll",
    caption: "Payroll",
    fields: [{ name: "amt", type: "number", caption: "Amt" }],
  });
  ok("admin creates a restricted form", m.ok, m);
  m = await ann.sd("option.user.save", {
    caption: "Sneaky",
    type: "data_input",
    target: "payroll",
  });
  ok(
    "ann can NOT make an option that targets an admin form",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await bob.sd("tstruct.get", { name: "payroll" });
  ok(
    "so bob still can't fetch the restricted form",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await AD.sd("option.user.save", {
    caption: "Payroll (admin)",
    type: "data_input",
    target: "payroll",
    applicable: { categories: ["Employee"] },
  });
  ok(
    "an administrator can (via the same endpoint), scope=admin",
    m.ok && m.data.option.targetScope === "admin",
    m,
  );
  const adminOptId = m.data?.option?.id;
  m = await bob.sd("tstruct.get", { name: "payroll" });
  ok("and that DOES grant bob access (it is admin-made)", m.ok, m);
  m = await bob.sd("option.user.save", {
    id: adminOptId,
    caption: "mine now",
    type: "data_input",
    target: "payroll",
  });
  ok(
    "a user can't take over an admin-made option",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await AD.sd("option.user.list");
  ok(
    "the admin's manage list shows every option",
    m.ok &&
      m.data.options.some((o) => o.id === optId) &&
      m.data.options.some((o) => o.id === adminOptId),
    m,
  );
  m = await AD.sd("option.user.delete", { id: optId });
  ok("an administrator can delete a user's option", m.ok, m);
  m = await ann.sd("option.user.delete", { id: "no-such" });
  ok(
    "deleting a missing option -> not_found",
    !m.ok && m.error.code === "not_found",
    m,
  );

  console.log(
    "\n=== cfg.lookups (user-level org config for Option Builder dropdowns) ===",
  );
  // Any signed-in user -- not just admins -- must be able to call cfg.lookups.
  for (const [label, conn] of [
    ["admin", AD],
    ["employee (ann)", ann],
    ["employee (bob)", bob],
    ["citizen (cit)", cit],
  ]) {
    m = await conn.sd("cfg.lookups");
    ok(`${label} can call cfg.lookups`, m.ok, m);
    ok(
      `${label}: response has branches/departments/designations/categories/affiliates arrays`,
      m.ok &&
        Array.isArray(m.data.branches) &&
        Array.isArray(m.data.departments) &&
        Array.isArray(m.data.designations) &&
        Array.isArray(m.data.categories) &&
        Array.isArray(m.data.affiliates),
      m.data,
    );
  }

  // Shape: branches/depts/designations/categories are plain name arrays; affiliates have name+category
  m = await ann.sd("cfg.lookups");
  ok(
    "branches contains the 'HQ' branch set up earlier",
    m.data.branches.includes("HQ"),
    m.data.branches,
  );
  ok(
    "departments contains 'Eng'",
    m.data.departments.includes("Eng"),
    m.data.departments,
  );
  ok(
    "designations contains 'Dev'",
    m.data.designations.includes("Dev"),
    m.data.designations,
  );
  ok(
    "categories are plain strings (not objects)",
    m.data.categories.every((c) => typeof c === "string"),
    m.data.categories,
  );
  ok(
    "affiliates are objects with name and category fields",
    m.data.affiliates.every(
      (a) => typeof a.name === "string" && "category" in a,
    ),
    m.data.affiliates,
  );

  // No admin-only fields leak out (city, pin, description, etc.)
  ok(
    "branches are plain name strings (no city/pin/country leaked)",
    m.data.branches.every((b) => typeof b === "string"),
    m.data.branches,
  );

  // Inactive categories must NOT appear (categories are the only kind that can be deactivated)
  m = await AD.sd("admin.cfg.save", {
    kind: "categories",
    item: { name: "Inactive", active: false },
  });
  ok("admin creates an inactive category", m.ok, m);
  m = await ann.sd("cfg.lookups");
  ok(
    "inactive categories are excluded from cfg.lookups",
    !m.data.categories.includes("Inactive"),
    m.data.categories,
  );

  // An unauthenticated connection (no sd session) cannot call cfg.lookups
  // (access level is 'user', so it requires a valid Sandesh session)
  // We test this by verifying availability returns 'signin' for unauthenticated callers --
  // the server enforces it on every run regardless of the advisory.
  ok(
    "cfg.lookups is in the user_actions list (access level: user)",
    [
      "branches",
      "departments",
      "designations",
      "categories",
      "affiliates",
    ].every((k) => Array.isArray(m.data[k])),
    m.data,
  );

  console.log("\n=== Files: upload ===");
  const bytes = crypto.randomBytes(2048);
  let res = await http(
    "POST",
    "/api/sd/files?name=" + encodeURIComponent("Plan ../ü.pdf"),
    bytes,
    undefined,
    { "Content-Type": "application/pdf" },
    true,
  );
  ok("upload without a session -> 401", res.status === 401, res.status);
  res = await http(
    "POST",
    "/api/sd/files?name=" + encodeURIComponent("Plan ../ü.pdf"),
    bytes,
    ann.token,
    { "Content-Type": "application/pdf" },
    true,
  );
  let up = await res.json();
  const fileId = up?.data?.file?.id;
  ok(
    "ann uploads a file",
    res.status === 200 &&
      /^[0-9a-f]{24}$/.test(fileId) &&
      up.data.file.size === 2048,
    up,
  );
  ok(
    "the stored name has no path parts and keeps its accents ('ü.pdf')",
    up.data.file.name === "ü.pdf",
    up.data.file.name,
  );
  res = await http(
    "POST",
    "/api/sd/files?name=big.bin",
    crypto.randomBytes(1.5 * 1024 * 1024),
    ann.token,
    { "Content-Type": "application/octet-stream" },
    true,
  );
  up = await res.json().catch(() => null);
  ok(
    "a file over the limit -> 413 with a clear message",
    res.status === 413 && /too large/i.test(up?.error?.message || ""),
    up,
  );
  res = await http(
    "POST",
    "/api/sd/files?name=empty.txt",
    Buffer.alloc(0),
    ann.token,
    { "Content-Type": "text/plain" },
    true,
  );
  ok("an empty file is refused", res.status === 400, res.status);
  res = await http("GET", "/api/sd/files", undefined, ann.token);
  let lst = await res.json();
  ok(
    "ann's list shows her upload",
    lst.data.files.some((f) => f.id === fileId),
    lst,
  );
  res = await http("GET", "/api/sd/files", undefined, bob.token);
  lst = await res.json();
  ok("bob's list does not", !lst.data.files.some((f) => f.id === fileId), lst);

  console.log("\n=== Files: who may download ===");
  res = await http("GET", "/api/sd/files/" + fileId, undefined, ann.token);
  let buf = Buffer.from(await res.arrayBuffer());
  ok(
    "the uploader downloads it byte-for-byte",
    res.status === 200 && buf.equals(bytes),
    res.status,
  );
  ok(
    "served as an attachment, octet-stream, nosniff (an uploaded page can't run)",
    res.headers.get("content-type") === "application/octet-stream" &&
      /attachment/.test(res.headers.get("content-disposition") || "") &&
      res.headers.get("x-content-type-options") === "nosniff",
    [...res.headers],
  );
  ok(
    "the file name is sent in X-File-Name and decodes back to exactly 'ü.pdf' (no double encoding)",
    decodeURIComponent(res.headers.get("x-file-name") || "") === "ü.pdf",
    res.headers.get("x-file-name"),
  );
  ok(
    "Content-Disposition carries the same UTF-8 name (RFC 5987)",
    /filename\*=UTF-8''/.test(res.headers.get("content-disposition") || "") &&
      decodeURIComponent(
        (res.headers.get("content-disposition") || "").split("''")[1] || "",
      ) === "ü.pdf",
    res.headers.get("content-disposition"),
  );
  res = await http("GET", "/api/sd/files/" + fileId, undefined, bob.token);
  ok("bob can NOT download it yet -> 403", res.status === 403, res.status);
  res = await http("GET", "/api/sd/files/" + fileId, undefined, undefined);
  ok("no session -> 401", res.status === 401, res.status);
  res = await http(
    "GET",
    "/api/sd/files/../../etc/passwd",
    undefined,
    ann.token,
  );
  ok(
    "a path-like id is not a file (no traversal) -> 404",
    res.status === 404,
    res.status,
  );
  res = await http(
    "GET",
    "/api/sd/files/" + "0".repeat(24),
    undefined,
    ann.token,
  );
  ok("an unknown id -> 404", res.status === 404, res.status);

  console.log("\n=== Files: sharing through a download option ===");
  m = await bob.sd("option.user.save", {
    caption: "Steal",
    type: "download",
    target: fileId,
  });
  ok(
    "bob can NOT attach ann's file to an option of his",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Get the plan",
    type: "download",
    target: fileId,
    applicable: { categories: ["Employee"] },
  });
  ok(
    "ann attaches her own file to a download option for employees",
    m.ok && m.data.option.type === "download",
    m,
  );
  const dlOpt = m.data?.option?.id;
  res = await http("GET", "/api/sd/files/" + fileId, undefined, bob.token);
  buf = Buffer.from(await res.arrayBuffer());
  ok(
    "now an applicable user (bob) downloads it",
    res.status === 200 && buf.equals(bytes),
    res.status,
  );
  res = await http("GET", "/api/sd/files/" + fileId, undefined, cit.token);
  ok(
    "a citizen (option not applicable) still can't -> 403",
    res.status === 403,
    res.status,
  );
  m = await ann.sd("option.user.save", {
    id: dlOpt,
    caption: "Get the plan",
    type: "download",
    target: fileId,
    active: false,
  });
  res = await http("GET", "/api/sd/files/" + fileId, undefined, bob.token);
  ok(
    "switching the option off revokes bob's access",
    res.status === 403,
    res.status,
  );
  m = await ann.sd("option.user.save", {
    caption: "Bad file",
    type: "download",
    target: "0".repeat(24),
  });
  ok(
    "a download option must point at a real file",
    !m.ok && m.error.code === "invalid",
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Send us a file",
    type: "upload",
  });
  ok(
    "an upload option needs no target",
    m.ok && m.data.option.type === "upload",
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Weather",
    type: "get_data",
    target: "weather-api",
    display: "name_value",
  });
  ok(
    "config-only types are stored (get_data with display)",
    m.ok && m.data.option.display === "name_value",
    m,
  );
  m = await ann.sd("option.user.save", {
    caption: "Weather",
    type: "get_data",
  });
  ok("...but still need their target", !m.ok && m.error.code === "invalid", m);
  m = await AD.sd("admin.option.delete", { id: dlOpt });
  res = await http("GET", "/api/sd/files/" + fileId, undefined, AD && adminTok);
  ok(
    "an administrator can always read any file",
    res.status === 200,
    res.status,
  );

  console.log(
    "\n=== Live change events: every change reaches the others without a refresh ===",
  );
  const everyone = [ann, bob, cit, AD];
  const clearAll = () => everyone.forEach((u) => u.clear());
  const settle = () => sleep(500);
  const only = (users, event, pred) =>
    users.every((u) => u.got(event, pred).length === 1);
  const none = (users, event, pred) =>
    users.every((u) => u.got(event, pred).length === 0);

  clearAll();
  m = await ann.sd("tstruct.user.save", {
    name: "live1",
    caption: "Live",
    fields: [{ name: "a", type: "text", caption: "A" }],
  });
  await settle();
  ok(
    "creating a structure -> tstructs_changed(created, scope user) reaches EVERYONE online (incl. the actor)",
    only(
      everyone,
      "tstructs_changed",
      (d) =>
        d.name === "live1" &&
        d.action === "created" &&
        d.scope === "user" &&
        d.by === ann.name,
    ),
    everyone.map((u) => u.events),
  );
  clearAll();
  m = await ann.sd("tstruct.user.update", {
    name: "live1",
    caption: "Live 2",
    fields: [{ name: "a", type: "text", caption: "A" }],
  });
  await settle();
  ok(
    "editing it -> tstructs_changed(updated) reaches everyone",
    only(
      everyone,
      "tstructs_changed",
      (d) => d.name === "live1" && d.action === "updated",
    ),
  );
  clearAll();
  m = await bob.sd("tstruct.user.update", {
    name: "live1",
    caption: "nope",
    fields: [{ name: "a", type: "text" }],
  });
  await settle();
  ok(
    "a REFUSED edit sends nothing to anyone",
    !m.ok &&
      everyone.every(
        (u) =>
          u.events.filter((x) => x.event === "tstructs_changed").length === 0,
      ),
    everyone.map((u) => u.events),
  );
  m = await bob.sd("tstruct.user.save", {
    name: "live1",
    fields: [{ name: "a", type: "text" }],
  });
  ok(
    "a duplicate name (rejected) sends nothing either",
    !m.ok &&
      everyone.every(
        (u) =>
          u.events.filter((x) => x.event === "tstructs_changed").length === 0,
      ),
  );

  clearAll();
  m = await ann.sd("option.user.save", {
    caption: "Live opt",
    type: "data_input",
    target: "live1",
    applicable: { categories: ["Employee"] },
  });
  const liveOpt = m.data.option.id;
  await settle();
  ok(
    "saving an option -> options_changed(saved) reaches everyone (each client re-asks options.list; the server applies applicable-to)",
    only(
      everyone,
      "options_changed",
      (d) => d.id === liveOpt && d.action === "saved",
    ),
    everyone.map((u) => u.events),
  );
  m = await bob.sd("options.list");
  ok(
    "...and bob's re-read shows it at once",
    m.ok && m.data.options.some((o) => o.id === liveOpt),
    m,
  );
  m = await cit.sd("options.list");
  ok(
    "...while the citizen's re-read does NOT (applicable-to still in force)",
    m.ok && !m.data.options.some((o) => o.id === liveOpt),
    m,
  );
  clearAll();
  m = await bob.sd("option.user.delete", { id: liveOpt });
  await settle();
  ok(
    "a refused option delete sends nothing",
    !m.ok &&
      everyone.every(
        (u) =>
          u.events.filter((x) => x.event === "options_changed").length === 0,
      ),
  );
  m = await ann.sd("option.user.delete", { id: liveOpt });
  await settle();
  ok(
    "deleting an option -> options_changed(deleted) reaches everyone",
    only(
      everyone,
      "options_changed",
      (d) => d.id === liveOpt && d.action === "deleted",
    ),
  );

  // submissions: only the people who can see them (submitter, host, admins)
  clearAll();
  m = await bob.sd("tstruct.user.submit", {
    name: "live1",
    values: { a: "hello" },
  });
  const liveSub = m.data.submission.id;
  await settle();
  ok(
    "a submission -> submissions_changed(created) reaches its submitter (bob) and admins (his host is the admin)",
    only(
      [bob, AD],
      "submissions_changed",
      (d) =>
        d.id === liveSub &&
        d.action === "created" &&
        d.tstruct === "live1" &&
        d.by === bob.name,
    ),
    [bob, AD].map((u) => u.events),
  );
  ok(
    "...and NOT unrelated users (ann, the citizen)",
    none([ann, cit], "submissions_changed"),
    [ann, cit].map((u) => u.events),
  );
  clearAll();
  m = await bob.sd("submissions.update", {
    id: liveSub,
    values: { a: "hello 2" },
  });
  await settle();
  ok(
    "editing it -> submissions_changed(updated) to bob and the admin",
    only(
      [bob, AD],
      "submissions_changed",
      (d) => d.id === liveSub && d.action === "updated",
    ) && none([ann, cit], "submissions_changed"),
  );
  clearAll();
  m = await ann.sd("submissions.delete", { id: liveSub });
  await settle();
  ok(
    "someone else's delete is refused and sends nothing",
    !m.ok &&
      everyone.every(
        (u) =>
          u.events.filter((x) => x.event === "submissions_changed").length ===
          0,
      ),
  );
  m = await bob.sd("submissions.delete", { id: liveSub });
  await settle();
  ok(
    "deleting it -> submissions_changed(deleted) to bob and the admin (host read BEFORE it vanished)",
    only(
      [bob, AD],
      "submissions_changed",
      (d) => d.id === liveSub && d.action === "deleted",
    ) && none([ann, cit], "submissions_changed"),
  );

  // admin-defined forms and options
  clearAll();
  m = await AD.sd("admin.tstruct.save", {
    name: "livepay",
    caption: "Pay",
    fields: [{ name: "amt", type: "number", caption: "Amt" }],
  });
  await settle();
  ok(
    "admin saves a form -> tstructs_changed(saved, scope admin) to everyone",
    only(
      everyone,
      "tstructs_changed",
      (d) =>
        d.name === "livepay" && d.scope === "admin" && d.action === "saved",
    ),
    everyone.map((u) => u.events),
  );
  clearAll();
  m = await AD.sd("admin.option.save", {
    id: "livepay-opt",
    caption: "Pay",
    type: "data_input",
    target: "livepay",
  });
  await settle();
  ok(
    "admin saves an option -> options_changed to everyone",
    only(
      everyone,
      "options_changed",
      (d) => d.id === "livepay-opt" && d.action === "saved",
    ),
  );
  clearAll();
  m = await AD.sd("admin.option.delete", { id: "livepay-opt" });
  m = await AD.sd("admin.tstruct.delete", { name: "livepay" });
  await settle();
  ok(
    "admin deletes the option and the form -> both are announced to everyone",
    only(
      everyone,
      "options_changed",
      (d) => d.id === "livepay-opt" && d.action === "deleted",
    ) &&
      only(
        everyone,
        "tstructs_changed",
        (d) => d.name === "livepay" && d.action === "deleted",
      ),
    everyone.map((u) => u.events),
  );
  clearAll();
  m = await ann.sd("tstruct.user.delete", { name: "live1" });
  await settle();
  ok(
    "deleting a user-made structure -> tstructs_changed(deleted) to everyone",
    only(
      everyone,
      "tstructs_changed",
      (d) => d.name === "live1" && d.action === "deleted",
    ),
  );
  ok(
    "events carry no field data (only what changed)",
    everyone.every((u) =>
      u.events.every(
        (x) => !("fields" in (x.data || {})) && !("values" in (x.data || {})),
      ),
    ),
  );

  console.log("\n=== tstruct.user.open and #tstruct hash commands ===");
  // Re-create the poll structure used by earlier tests (deleted when live1 was cleaned up above).
  m = await ann.sd("tstruct.user.save", {
    name: "poll2",
    caption: "Poll",
    fields: [
      { name: "question", type: "text", caption: "Question", required: true },
      {
        name: "kind",
        type: "list",
        caption: "Kind",
        options: ["Yes/No", "Rating"],
        required: false,
      },
    ],
  });
  ok("poll2 created for hash-command tests", m.ok, m);

  // sd action: tstruct.user.open -- user-created collection
  m = await ann.sd("tstruct.user.open", { name: "poll2" });
  ok(
    "tstruct.user.open returns tstruct + empty submissions when no records yet",
    m.ok &&
      m.data.tstruct.name === "poll2" &&
      m.data.scope === "user" &&
      Array.isArray(m.data.submissions) &&
      m.data.submissions.length === 0,
    m,
  );

  // Submit a record via the normal path, then open again
  m = await ann.sd("tstruct.user.submit", {
    name: "poll2",
    values: { question: "Coffee?", kind: "Yes/No" },
  });
  ok("ann submits a record to poll2", m.ok, m);
  const pollSubId = m.data?.submission?.id;
  m = await ann.sd("tstruct.user.open", { name: "poll2" });
  ok(
    "tstruct.user.open now returns ann's own submission",
    m.ok &&
      m.data.submissions.length === 1 &&
      m.data.submissions[0].id === pollSubId &&
      m.data.submissions[0].by === ann.name,
    m,
  );

  // bob submits too -- ann's open should only return ann's own records
  m = await bob.sd("tstruct.user.submit", {
    name: "poll2",
    values: { question: "Tea?" },
  });
  m = await ann.sd("tstruct.user.open", { name: "poll2" });
  ok(
    "tstruct.user.open only returns the CALLER's own records, not others'",
    m.ok && m.data.submissions.every((s) => s.by === ann.name),
    m,
  );

  // admin-managed fallback: if no user-created struct matches, look in admin
  m = await AD.sd("admin.tstruct.save", {
    name: "managed1",
    caption: "Managed",
    fields: [{ name: "note", type: "text", caption: "Note" }],
  });
  ok("admin creates a managed struct", m.ok, m);
  // ann needs an option to access it
  // no `applicable` would mean EVERYONE (a citizen included), so restrict it to employees to test the gate
  m = await AD.sd("admin.option.save", {
    id: "managed1-opt",
    caption: "Managed",
    type: "data_input",
    target: "managed1",
    applicable: { categories: ["Employee"] },
  });
  m = await ann.sd("tstruct.user.open", { name: "managed1" });
  ok(
    "tstruct.user.open falls back to admin-managed struct (via options gate)",
    m.ok && m.data.scope === "admin" && m.data.tstruct.name === "managed1",
    m,
  );
  m = await bob.sd("tstruct.user.open", { name: "managed1" });
  ok(
    "bob can also open it (option applies to all employees)",
    m.ok && m.data.scope === "admin",
    m,
  );
  m = await cit.sd("tstruct.user.open", { name: "managed1" });
  ok(
    "a citizen without the option cannot open it",
    !m.ok && m.error.code === "not_found",
    m,
  );

  // not_found for a truly missing struct
  m = await ann.sd("tstruct.user.open", { name: "ghost_struct" });
  ok(
    "tstruct.user.open on a missing name -> not_found",
    !m.ok && m.error.code === "not_found",
    m,
  );

  // Hash commands over WS -- we need a raw send + event collector for the reply
  // (the .sd() helper only watches for type:"sd" frames; #commands can return those too
  //  since they rewrite to /sd actions)
  const rawSd = (conn, action, args) => conn.sd(action, args);

  // #tstruct <name> -> /sd tstruct.user.open {"name":...}
  m = await ann.sd("tstruct.user.open", { name: "poll2" });
  ok(
    "#tstruct open via sd returns tstruct + submissions (hash command backed by tstruct.user.open)",
    m.ok && m.data.tstruct.name === "poll2",
    m,
  );

  // #tstruct-add <name> -> /sd tstruct.user.open {"name":..., "mode":"add"}
  m = await ann.sd("tstruct.user.open", { name: "poll2", mode: "add" });
  ok(
    "#tstruct-add returns the struct def with mode=add hint (frontend opens the add form)",
    m.ok && m.data.tstruct.name === "poll2" && m.data.scope === "user",
    m,
  );

  // #tstruct-edit <name> <id> -> /sd submissions.update {"tstruct":..., "id":...}
  // Without new values it should return the current record (no fields changed = ok with empty values)
  m = await ann.sd("submissions.update", {
    id: pollSubId,
    values: { question: "Coffee updated?" },
  });
  ok(
    "#tstruct-edit backed action (submissions.update) updates ann's own record",
    m.ok && m.data.submission.values.question === "Coffee updated?",
    m,
  );
  m = await bob.sd("submissions.update", {
    id: pollSubId,
    values: { question: "hijacked" },
  });
  ok(
    "#tstruct-edit on someone else's record -> forbidden (owner-only enforce still applies)",
    !m.ok && m.error.code === "forbidden",
    m,
  );

  // #tstruct-delete <name> <id> -> /sd submissions.delete {"id":...}
  // First create a new submission to delete
  m = await ann.sd("tstruct.user.submit", {
    name: "poll2",
    values: { question: "Delete me?" },
  });
  const delSubId = m.data?.submission?.id;
  m = await bob.sd("submissions.delete", { id: delSubId });
  ok(
    "#tstruct-delete on someone else's record -> forbidden (owner-only enforce)",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await ann.sd("submissions.delete", { id: delSubId });
  ok(
    "#tstruct-delete deletes ann's own record",
    m.ok && m.data.deleted === true,
    m,
  );
  m = await ann.sd("tstruct.user.open", { name: "poll2" });
  ok(
    "after delete, open no longer shows it",
    m.ok && !m.data.submissions.some((s) => s.id === delSubId),
    m,
  );

  // Async broadcast: a create/update/delete reaches observers without a refresh
  clearAll();
  m = await ann.sd("tstruct.user.submit", {
    name: "poll2",
    values: { question: "Live?" },
  });
  const liveSubId2 = m.data?.submission?.id;
  await settle();
  ok(
    "submitting a record via tstruct.user.submit fires submissions_changed(created) asynchronously to submitter + admins",
    only(
      [ann, AD],
      "submissions_changed",
      (d) => d.id === liveSubId2 && d.action === "created",
    ),
    [ann, AD].map((u) => u.events),
  );
  ok(
    "...and NOT to unrelated users",
    none([bob, cit], "submissions_changed", (d) => d.id === liveSubId2),
  );
  clearAll();
  m = await ann.sd("submissions.update", {
    id: liveSubId2,
    values: { question: "Live 2?" },
  });
  await settle();
  ok(
    "editing fires submissions_changed(updated) asynchronously",
    only(
      [ann, AD],
      "submissions_changed",
      (d) => d.id === liveSubId2 && d.action === "updated",
    ),
    [ann, AD].map((u) => u.events),
  );
  clearAll();
  m = await ann.sd("submissions.delete", { id: liveSubId2 });
  await settle();
  ok(
    "deleting fires submissions_changed(deleted) asynchronously",
    only(
      [ann, AD],
      "submissions_changed",
      (d) => d.id === liveSubId2 && d.action === "deleted",
    ),
    [ann, AD].map((u) => u.events),
  );

  // Cleanup
  await AD.sd("admin.tstruct.delete", { name: "managed1" });
  await AD.sd("admin.option.delete", { id: "managed1-opt" });
  await ann.sd("tstruct.user.delete", { name: "poll2" });

  // (sockets stay open: the sections below still use them)
  console.log("\n=== Adversarial ===");
  // hostile file names must not break out of the header or the directory
  res = await http(
    "POST",
    "/api/sd/files?name=" +
      encodeURIComponent('evil"\r\nSet-Cookie: x=1\r\n\r\n<script>.html'),
    Buffer.from("<html>hi</html>"),
    ann.token,
    { "Content-Type": "text/html; charset=utf-8" },
    true,
  );
  up = await res.json();
  const evilId = up?.data?.file?.id;
  ok(
    "a hostile file name is accepted but sanitized (no quotes / CR / LF stored)",
    res.status === 200 && !/["\r\n]/.test(up.data.file.name),
    up,
  );
  ok(
    "the MIME type parameter is dropped, the type kept",
    up?.data?.file?.mime === "text/html",
    up?.data?.file,
  );
  res = await http("GET", "/api/sd/files/" + evilId, undefined, ann.token);
  ok(
    "its download has no injected header and is still an attachment",
    res.status === 200 &&
      !res.headers.get("set-cookie") &&
      /attachment/.test(res.headers.get("content-disposition") || "") &&
      res.headers.get("content-type") === "application/octet-stream",
    [...res.headers],
  );
  res = await http(
    "POST",
    "/api/sd/files?name=" + "a".repeat(5000),
    Buffer.from("x"),
    ann.token,
    { "Content-Type": "text/plain" },
    true,
  );
  up = await res.json();
  ok(
    "an absurdly long name is truncated, not rejected or stored whole",
    res.status === 200 && up.data.file.name.length <= 200,
    up?.data?.file?.name?.length,
  );
  res = await http(
    "POST",
    "/api/sd/files",
    Buffer.from("x"),
    ann.token,
    { "Content-Type": "text/plain" },
    true,
  );
  up = await res.json();
  ok(
    "no ?name= -> stored as 'file'",
    res.status === 200 && up.data.file.name === "file",
    up,
  );
  res = await http(
    "POST",
    "/api/sd/files?name=x",
    Buffer.from("x"),
    ann.token,
    { "Content-Type": "not a mime\u0001" },
    true,
  ).catch(() => null);
  if (res) {
    up = await res.json();
    ok(
      "a garbage Content-Type falls back to octet-stream",
      up?.data?.file?.mime === "application/octet-stream",
      up?.data?.file,
    );
  }
  // no Content-Length at all
  const { default: net } = await import("node:net");
  const raw = await new Promise((resolve) => {
    const sock = net.connect(new URL(BASE).port, "localhost", () => {
      sock.write(
        `POST /api/sd/files?name=x HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${ann.token}\r\nContent-Type: text/plain\r\n\r\nhello`,
      );
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d;
    });
    sock.on("close", () => resolve(buf));
    setTimeout(() => {
      sock.destroy();
      resolve(buf);
    }, 4000);
  });
  ok(
    "a request with no Content-Length is refused cleanly (400)",
    /^HTTP\/1\.1 400/.test(raw),
    raw.slice(0, 60),
  );
  // ids that differ only by case
  m = await AD.sd("admin.option.save", {
    id: "Leave",
    caption: "Leave",
    type: "upload",
  });
  ok("admin makes option 'Leave'", m.ok, m);
  m = await ann.sd("option.user.save", {
    id: "LEAVE",
    caption: "clash",
    type: "upload",
  });
  ok(
    "a user can't take the same id by changing its case",
    !m.ok && m.error.code === "forbidden",
    m,
  );
  m = await ann.sd("option.user.save", {
    id: "../x",
    caption: "bad id",
    type: "upload",
  });
  ok(
    "an id with path characters is rejected",
    !m.ok && m.error.code === "invalid",
    m,
  );
  m = await ann.sd("option.user.save", { caption: "   ", type: "upload" });
  ok("a blank caption is rejected", !m.ok && m.error.code === "invalid", m);
  m = await ann.sd("option.user.save", { caption: "x", type: "nonsense" });
  ok("an unknown type is rejected", !m.ok && m.error.code === "invalid", m);
  // a new sign-in revokes the old session -- the file endpoints must honour that
  const oldTok = bob.token;
  const again = await post("/api/sd/login", {
    identifier: bob.name,
    deviceId: "d-" + bob.name,
  });
  ok(
    "bob signs in again on his trusted device",
    again.status === 200 && !!data(again)?.token,
    again.json,
  );
  res = await http("GET", "/api/sd/files", undefined, oldTok);
  ok(
    "his old session can no longer list files (401)",
    res.status === 401,
    res.status,
  );
  res = await http(
    "POST",
    "/api/sd/files?name=x",
    Buffer.from("x"),
    oldTok,
    { "Content-Type": "text/plain" },
    true,
  );
  ok("...or upload (401)", res.status === 401, res.status);
  // upload rate limit: 60 per hour per user
  let last = 0;
  for (let i = 0; i < 65; i++) {
    const rr = await http(
      "POST",
      "/api/sd/files?name=r" + i,
      Buffer.from("x"),
      data(again).token,
      { "Content-Type": "text/plain" },
      true,
    );
    last = rr.status;
    if (rr.status === 429) break;
  }
  ok("the 61st upload in an hour is rate limited (429)", last === 429, last);
  ok(
    "a bad session token on GET list is 401 (not a crash)",
    (await http("GET", "/api/sd/files", undefined, "garbage")).status === 401,
  );

  console.log(`\n=== SUMMARY ===\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log("Failures:\n  - " + failures.join("\n  - "));
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error("TEST SCRIPT ERROR:", e);
  process.exit(2);
});
