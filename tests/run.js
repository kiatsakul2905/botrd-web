// ทดสอบ: node tests/run.js  (ต้องมี psql + ตัวแปร TEST_PG เช่น "-h /tmp/pg -p 5433 -U postgres")
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import * as R from "../public/rules.js";

let pass = 0; const t = async (name, fn) => { await fn(); pass++; console.log("✓", name); };

// ---------- rules ----------
const tin = (p) => { let s = 0; for (let i = 0; i < 12; i++) s += +p[i] * (13 - i); return p + ((11 - (s % 11)) % 10); };
await t("check digit", () => { assert.ok(R.tinOk(tin("010555000001"))); assert.ok(!R.tinOk("0105550000019")); assert.ok(!R.tinOk("123")); });
await t("dates", () => {
  assert.equal(R.normDate("05/08/2569"), "2026-08-05"); assert.equal(R.normDate("5-8-2026"), "2026-08-05");
  assert.equal(R.normDate("2026-08-05"), "2026-08-05"); assert.equal(R.normDate("46239"), "2026-08-05");
  assert.equal(R.normDate("31/02/2569"), null); assert.equal(R.fmtDate("2026-08-05"), "05/08/2569");
});
await t("money", () => {
  assert.equal(R.toSatang("1,234.5"), 123450); assert.equal(R.toSatang("0.1"), 10); assert.ok(Number.isNaN(R.toSatang("1.005")));
  assert.equal(R.toSatang("abc"), undefined); assert.equal(R.toSatang(""), null); assert.equal(R.fmtMoney(123405), "1234.05");
});
const A = tin("010555000001"), P = tin("310010000001");
const row = (o, n) => ({ id: n, row_no: n, data: R.normalizeRow("PND53", { "เลขประจำตัวผู้เสียภาษีอากร": A, "ชื่อ": "เอ จำกัด", "วันเดือนปีที่จ่าย": "05/08/2569",
  "ประเภทเงินได้": "ค่าบริการ", "อัตราภาษีร้อยละ": "3", "จำนวนเงินที่จ่าย": "10,500", "จำนวนเงินภาษีที่หัก": "315", "เงื่อนไข": "1", ...o }) });
await t("validate clean", () => { const c = R.validate("PND53", [row({}, 1)], "2026-08"); assert.equal(c.errors, 0, JSON.stringify(c.issues)); assert.equal(c.totals.tax, "315.00"); });
await t("validate errors", () => {
  const c = R.validate("PND53", [row({ "จำนวนเงินภาษีที่หัก": "300" }, 1), row({ "วันเดือนปีที่จ่าย": "01/09/2569" }, 2),
    row({ "เลขประจำตัวผู้เสียภาษีอากร": "0105550000019" }, 3), row({ "เงื่อนไข": "9" }, 4), row({ "จำนวนเงินที่จ่าย": "1.234" }, 5)], "2026-08");
  const m = c.issues.filter((i) => i.level === "ERROR").map((i) => i.row_no);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(m.includes(n), "row " + n + " " + JSON.stringify(c.issues));
});
await t("validate warnings", () => {
  const c = R.validate("PND53", [row({}, 1), row({}, 2), row({}, 3), row({ "เลขประจำตัวผู้เสียภาษีอากร": P }, 4)], "2026-08");
  assert.ok(c.issues.some((i) => i.msg.includes("อาจซ้ำ"))); assert.ok(c.issues.some((i) => i.msg.includes("ซอยยอด"))); assert.ok(c.issues.some((i) => i.row_no === 4 && i.msg.includes("ภ.ง.ด.3")));
});
await t("txt + cp874", () => {
  const txt = R.buildTxt("PND53", [row({}, 1)]);
  const line = txt.split("\r\n")[1].split("|");
  assert.equal(line[0], "1"); assert.equal(line[1], A); assert.equal(line[2], "00000"); assert.ok(line.includes("05/08/2569")); assert.ok(line.includes("10500.00")); assert.ok(line.includes("315.00"));
  assert.deepEqual([...R.toCp874("กA")], [0xa1, 0x41]);
});
await t("header aliases", () => { const m = R.mapHeaders("PND3", ["เลขผู้เสียภาษี", "ชื่อ", "นามสกุล", "วันที่จ่าย", "จำนวนเงิน", "ภาษี", "เงื่อนไข", "อื่นๆ"]);
  assert.deepEqual(m.missing, []); assert.deepEqual(m.unknown, ["อื่นๆ"]); });

// ---------- API + DB (Postgres จริงผ่าน psql) ----------
const PG = (process.env.TEST_PG || "-h /tmp/pg -p 5433 -U postgres").split(" ");
const lit = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v)
  : Array.isArray(v) ? `ARRAY[${v.map(lit).join(",")}]` : "'" + String(v).replace(/'/g, "''") + "'";
const psql = (sql) => execFileSync("psql", [...PG, "-d", "botrd_test", "-AtqX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
execFileSync("psql", [...PG, "-qc", "DROP DATABASE IF EXISTS botrd_test"]); execFileSync("psql", [...PG, "-qc", "CREATE DATABASE botrd_test"]);
globalThis.__TEST_DB__ = async (text, params) => {
  const q = text.replace(/\$(\d+)/g, (_, i) => lit(params[i - 1]));
  if (/^\s*(CREATE|DROP|ALTER)/i.test(q) || (!/RETURNING/i.test(q) && !/^\s*SELECT/i.test(q))) { psql(q); return []; }
  const out = psql(`WITH t AS (${q}) SELECT COALESCE(json_agg(t), '[]') FROM t`);
  return JSON.parse(out.trim() || "[]");
};
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
globalThis.__TEST_JWKS__ = [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" }];
const gtoken = (email, extra = {}) => { const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "cid", email, email_verified: true, exp: Date.now() / 1000 + 600, ...extra })).toString("base64url");
  return `${h}.${p}.${crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`; };
Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", SESSION_SECRET: "x".repeat(40), ADMIN_EMAILS: "boss@x.com" });
const { default: handler } = await import("../api/index.js");
async function call(method, path, body, cookie, extraHeaders = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url: "/api/index?p=" + path.replace("?", "&"), headers: { cookie: cookie || "", "x-requested-with": "botrd", ...extraHeaders } });
  const res = { statusCode: 0, h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await handler(req, res);
  const txt = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.body;
  let json; try { json = JSON.parse(txt); } catch {}
  return { status: res.statusCode, json, txt, raw: res.body, cookie: (res.h["set-cookie"] || "").split(";")[0] };
}
const login = async (email) => { const r = await call("POST", "auth/google", { credential: gtoken(email) }); assert.equal(r.status, 200, r.txt); return r.cookie; };

let boss, keyer, rev, co, co2, bid;
await t("login: admin bootstrap + ปฏิเสธคนแปลกหน้า + token ปลอม", async () => {
  boss = await login("boss@x.com");
  assert.equal((await call("POST", "auth/google", { credential: gtoken("who@x.com") })).status, 403);
  assert.equal((await call("POST", "auth/google", { credential: gtoken("boss@x.com", { aud: "other" }) })).status, 401);
  const bad = gtoken("boss@x.com").slice(0, -4) + "AAAA"; assert.equal((await call("POST", "auth/google", { credential: bad })).status, 401);
  assert.equal((await call("GET", "me", null, "botrd=abc.def")).status, 401);
  assert.equal((await call("GET", "me", null, boss)).json.role, "admin");
});
await t("CSRF header required", async () => { assert.equal((await call("POST", "companies", { name: "x" }, boss, { "x-requested-with": "" })).status, 403); });
await t("admin: companies + users", async () => {
  co = (await call("POST", "companies", { name: "บริษัท ก", tax_id: A }, boss)).json; co2 = (await call("POST", "companies", { name: "บริษัท ข" }, boss)).json;
  assert.equal((await call("POST", "users", { email: "Key@x.com", role: "keyer", company_ids: [co.id] }, boss)).status, 200);
  assert.equal((await call("POST", "users", { email: "rev@x.com", role: "reviewer", company_ids: [co.id] }, boss)).status, 200);
  keyer = await login("key@x.com"); rev = await login("rev@x.com");
  assert.equal((await call("GET", "users", null, keyer)).status, 403);
  assert.deepEqual((await call("GET", "companies", null, keyer)).json.map((c) => c.name), ["บริษัท ก"]);
  assert.equal((await call("GET", "batches?company_id=" + co2.id, null, keyer)).status, 403);
});
await t("batch: create, import, edit, conflict", async () => {
  const r = await call("POST", "batches", { company_id: co.id, form: "PND53", period: "2026-08" }, keyer); assert.equal(r.status, 200, r.txt); bid = r.json.id;
  assert.equal((await call("POST", "batches", { company_id: co.id, form: "PND53", period: "2026-08" }, keyer)).status, 409);
  assert.equal((await call("POST", "batches", { company_id: co.id, form: "PND53", period: "2026-08" }, rev)).status, 403);
  const recs = [row({}, 1).data, row({ "จำนวนเงินที่จ่าย": "2345.67", "จำนวนเงินภาษีที่หัก": "23.46", "อัตราภาษีร้อยละ": "1", "ชื่อ": "O'Brien; DROP TABLE users" }, 2).data];
  assert.equal((await call("PUT", `batches/${bid}/records`, { mode: "append", records: recs }, keyer)).status, 200);
  let b = (await call("GET", "batches/" + bid, null, keyer)).json;
  assert.equal(b.records.length, 2); assert.equal(b.check.errors, 0, JSON.stringify(b.check.issues)); assert.equal(b.check.totals.amount, "12845.67");
  assert.equal(b.records[1].data["ชื่อ"], "O'Brien; DROP TABLE users");
  const r1 = b.records[0];
  assert.equal((await call("PATCH", "records/" + r1.id, { data: { "จำนวนเงินภาษีที่หัก": "300" }, version: r1.version }, keyer)).status, 200);
  assert.equal((await call("PATCH", "records/" + r1.id, { data: { "จำนวนเงินภาษีที่หัก": "315" }, version: r1.version }, keyer)).status, 409);
  assert.equal((await call("POST", `batches/${bid}/submit`, {}, keyer)).status, 400); // ยังมี ERROR
  b = (await call("GET", "batches/" + bid, null, keyer)).json;
  assert.equal((await call("PATCH", "records/" + r1.id, { data: { "จำนวนเงินภาษีที่หัก": "315" }, version: b.records[0].version }, keyer)).status, 200);
  await call("PUT", `batches/${bid}/records`, { mode: "append", records: [{}] }, keyer);
  b = (await call("GET", "batches/" + bid, null, keyer)).json; assert.equal(b.records.at(-1).row_no, 3);
  assert.equal((await call("DELETE", "records/" + b.records.at(-1).id, null, keyer)).status, 200);
});
await t("workflow + export", async () => {
  assert.equal((await call("GET", `batches/${bid}/export`, null, keyer)).status, 409);
  assert.equal((await call("POST", `batches/${bid}/submit`, {}, keyer)).status, 200);
  const b = (await call("GET", "batches/" + bid, null, keyer)).json;
  assert.equal((await call("PATCH", "records/" + b.records[0].id, { data: { "ชื่อ": "x" }, version: b.records[0].version }, keyer)).status, 409);
  assert.equal((await call("POST", `batches/${bid}/approve`, {}, keyer)).status, 403);
  assert.equal((await call("POST", `batches/${bid}/reject`, {}, rev)).status, 400);
  assert.equal((await call("POST", `batches/${bid}/approve`, {}, rev)).status, 200);
  const e = await call("GET", `batches/${bid}/export`, null, rev); assert.equal(e.status, 200);
  const lines = e.txt.trim().split("\r\n"); assert.equal(lines.length, 3); assert.ok(lines[2].includes("2345.67|23.46|1"), lines[2]);
  const e2 = await call("GET", `batches/${bid}/export?enc=cp874`, null, rev); assert.ok(e2.raw.includes(0xa1) || e2.raw.some((x) => x >= 0xa1));
  assert.equal((await call("POST", `batches/${bid}/reopen`, { note: "แก้ยอด" }, rev)).status, 403);
  assert.equal((await call("POST", `batches/${bid}/reopen`, { note: "แก้ยอด" }, boss)).status, 200);
  const log = (await call("GET", `batches/${bid}/audit`, null, boss)).json.map((l) => l.action);
  for (const a of ["batch_create", "records_append", "record_edit", "batch_submit", "batch_approve", "export", "batch_reopen"]) assert.ok(log.includes(a), a);
});
await t("admin guards", async () => {
  const me = (await call("GET", "me", null, boss)).json;
  assert.equal((await call("PATCH", "users/" + me.id, { role: "keyer" }, boss)).status, 400);
  const u = (await call("GET", "users", null, boss)).json.find((x) => x.email === "key@x.com");
  await call("PATCH", "users/" + u.id, { active: false }, boss);
  assert.equal((await call("GET", "me", null, keyer)).status, 401);
});
console.log(`\nผ่านทั้งหมด ${pass} ข้อ`);
