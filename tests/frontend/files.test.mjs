// sandeshFiles: quick client-side limits, error text from the server, and download-name decoding.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { location: { port: "5173", hostname: "localhost" } };
const fetches = [];
let respond;
globalThis.fetch = async (url, init) => {
  fetches.push([String(url), init]);
  return respond(url, init);
};
const anchors = [];
globalThis.document = {
  createElement: () => { const a = { click() { this.clicked = true; }, remove() {} }; anchors.push(a); return a; },
  body: { appendChild() {} },
};
globalThis.URL.createObjectURL = () => "blob:x";
globalThis.URL.revokeObjectURL = () => {};

const { uploadFile, downloadFile, MAX_UPLOAD_MB } = await import("../../src/services/sandeshFiles.js");
const file = (name, size, type = "text/plain") => ({ name, size, type });

test("upload: rejects nothing / empty / oversized files without calling the server", async () => {
  await assert.rejects(uploadFile(null, "t"), /Choose a file/);
  await assert.rejects(uploadFile(file("a", 0), "t"), /empty/);
  await assert.rejects(uploadFile(file("a", MAX_UPLOAD_MB * 1024 * 1024 + 1), "t"), /too large \(max 10 MB\)/);
  assert.equal(fetches.length, 0);
});

test("upload: needs a session token (401) before any request", async () => {
  await assert.rejects(uploadFile(file("a", 5), ""), (e) => e.status === 401);
  assert.equal(fetches.length, 0);
});

test("upload: sends the name URL-encoded with a bearer token and returns the file record", async () => {
  respond = async () => ({ ok: true, json: async () => ({ data: { file: { id: "f1", name: "über file.txt" } } }) });
  const out = await uploadFile(file("über file.txt", 5), "tok");
  assert.equal(out.id, "f1");
  const [url, init] = fetches.at(-1);
  assert.match(url, /\/files\?name=%C3%BCber%20file\.txt$/);
  assert.equal(init.headers.Authorization, "Bearer tok");
  assert.equal(init.method, "POST");
});

test("upload: server error message surfaces with its status (413, non-JSON body)", async () => {
  respond = async () => ({ ok: false, status: 413, json: async () => ({ error: { message: "File too large" } }) });
  await assert.rejects(uploadFile(file("a", 5), "t"), (e) => e.status === 413 && e.message === "File too large");
  respond = async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } });
  await assert.rejects(uploadFile(file("a", 5), "t"), (e) => e.status === 502 && /Request failed \(502\)/.test(e.message));
});

test("network failure becomes a 503 'unable to reach' error", async () => {
  respond = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(uploadFile(file("a", 5), "t"), (e) => e.status === 503 && /reach/.test(e.message));
});

test("download: decodes the percent-encoded name and triggers a save", async () => {
  respond = async () => ({
    ok: true,
    blob: async () => ({ size: 3 }),
    headers: { get: (h) => (h === "x-file-name" ? "%C3%BCber%20file.txt" : null) },
  });
  const out = await downloadFile("f1", "t");
  assert.deepEqual(out, { name: "über file.txt", size: 3 });
  assert.equal(anchors.at(-1).download, "über file.txt");
  assert.equal(anchors.at(-1).clicked, true);
});

test("download: a malformed name header falls back to 'download'", async () => {
  respond = async () => ({ ok: true, blob: async () => ({ size: 1 }), headers: { get: () => "%E0%A4%A" } });
  assert.equal((await downloadFile("f1", "t")).name, "download");
});

test("download: 403 from the server is reported", async () => {
  respond = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "Not allowed" } }) });
  await assert.rejects(downloadFile("f1", "t"), (e) => e.status === 403 && e.message === "Not allowed");
});
