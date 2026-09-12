// API ทั้งหมดอยู่ใน function เดียว (Vercel Hobby จำกัดจำนวน function)
import { query, one, ensureSchema, audit } from "../lib/db.js";
import { verifyGoogle, makeSession, readSession, cookie } from "../lib/auth.js";
import { FORMS, normalizeRow, validate, buildTxt, toCp874 } from "../public/rules.js";

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };
const adminEmails = () => (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

async function body(req) {
  if (req.body !== undefined && typeof req.body !== "string") return req.body || {};
  if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}
async function currentUser(req) {
  const s = readSession(req.headers.cookie);
  if (!s) return null;
  const u = await one("SELECT id, email, name, role, active FROM users WHERE id=$1", [s.uid]);
  return u && u.active ? u : null;
}
const need = (u, ...roles) => { if (!u) fail(401, "กรุณาเข้าสู่ระบบ"); if (roles.length && !roles.includes(u.role)) fail(403, "ไม่มีสิทธิ์ทำรายการนี้"); };
async function canCompany(u, companyId) {
  if (u.role === "admin") return true;
  return !!(await one("SELECT 1 AS ok FROM user_companies WHERE user_id=$1 AND company_id=$2", [u.id, companyId]));
}
async function getBatch(u, id) {
  const b = await one(`SELECT b.*, c.name AS company_name, c.tax_id AS company_tax_id, c.branch AS company_branch
                       FROM batches b JOIN companies c ON c.id=b.company_id WHERE b.id=$1`, [id]);
  if (!b) fail(404, "ไม่พบชุดข้อมูล");
  if (!(await canCompany(u, b.company_id))) fail(403, "ไม่มีสิทธิ์ในบริษัทนี้");
  return b;
}
const loadRecords = (bid) => query("SELECT id, row_no, data, version, updated_by, updated_at FROM records WHERE batch_id=$1 ORDER BY row_no, id", [bid]);
const touch = (bid) => query("UPDATE batches SET updated_at=now() WHERE id=$1", [bid]);
const checkPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p) || fail(400, "งวดต้องเป็นรูปแบบ YYYY-MM (ค.ศ.)");

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>\\d+)") + "$"), fn });

// ---------- auth ----------
on("GET", "/config", async () => ({ googleClientId: process.env.GOOGLE_CLIENT_ID || "", forms: Object.fromEntries(Object.entries(FORMS).map(([k, v]) => [k, { name: v.name, cols: v.cols, unverified: !!v.unverified }])) }));
on("POST", "/auth/google", async ({ req, res }) => {
  const { credential } = await body(req);
  if (!process.env.GOOGLE_CLIENT_ID) fail(500, "ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID");
  let g; try { g = await verifyGoogle(credential, process.env.GOOGLE_CLIENT_ID); } catch (e) { fail(401, "ยืนยันตัวตนไม่สำเร็จ: " + e.message); }
  let u = await one("SELECT * FROM users WHERE email=$1", [g.email]);
  if (!u && adminEmails().includes(g.email))
    u = await one("INSERT INTO users (email, name, role) VALUES ($1,$2,'admin') RETURNING *", [g.email, g.name]);
  if (!u || !u.active) { await audit(g.email, "login_denied", null); fail(403, `อีเมล ${g.email} ยังไม่ได้รับสิทธิ์ใช้งาน ติดต่อแอดมิน`); }
  await query("UPDATE users SET last_login=now(), name=COALESCE(NULLIF($2,''), name) WHERE id=$1", [u.id, g.name]);
  await audit(u.email, "login", null);
  res.setHeader("Set-Cookie", cookie(makeSession(u.id)));
  return { ok: true };
});
on("POST", "/auth/logout", async ({ res }) => { res.setHeader("Set-Cookie", cookie("", 0)); return { ok: true }; });
on("GET", "/me", async ({ u }) => { need(u); return u; });

// ---------- users (admin) ----------
on("GET", "/users", async ({ u }) => {
  need(u, "admin");
  return query(`SELECT u.id, u.email, u.name, u.role, u.active, u.last_login,
    COALESCE((SELECT json_agg(company_id) FROM user_companies WHERE user_id=u.id), '[]'::json) AS company_ids
    FROM users u ORDER BY u.email`);
});
on("POST", "/users", async ({ req, u }) => {
  need(u, "admin");
  const { email, role, company_ids = [] } = await body(req);
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail(400, "อีเมลไม่ถูกต้อง");
  if (!["admin", "keyer", "reviewer"].includes(role)) fail(400, "บทบาทไม่ถูกต้อง");
  if (await one("SELECT 1 AS x FROM users WHERE email=$1", [e])) fail(409, "มีผู้ใช้นี้แล้ว");
  const nu = await one("INSERT INTO users (email, role) VALUES ($1,$2) RETURNING id", [e, role]);
  await setCompanies(nu.id, company_ids);
  await audit(u.email, "user_add", null, { email: e, role, company_ids });
  return nu;
});
async function setCompanies(uid, ids) {
  await query("DELETE FROM user_companies WHERE user_id=$1", [uid]);
  const clean = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (clean.length) await query("INSERT INTO user_companies (user_id, company_id) SELECT $1, x FROM unnest($2::int[]) x ON CONFLICT DO NOTHING", [uid, clean]);
}
on("PATCH", "/users/:id", async ({ req, u, p }) => {
  need(u, "admin");
  const b = await body(req), id = +p.id;
  const t = await one("SELECT * FROM users WHERE id=$1", [id]); if (!t) fail(404, "ไม่พบผู้ใช้");
  if (id === u.id && (b.role && b.role !== "admin" || b.active === false)) fail(400, "ไม่สามารถลดสิทธิ์หรือปิดบัญชีตัวเองได้");
  if (b.role && !["admin", "keyer", "reviewer"].includes(b.role)) fail(400, "บทบาทไม่ถูกต้อง");
  await query("UPDATE users SET role=COALESCE($2,role), active=COALESCE($3,active) WHERE id=$1", [id, b.role ?? null, b.active ?? null]);
  if (Array.isArray(b.company_ids)) await setCompanies(id, b.company_ids);
  await audit(u.email, "user_edit", null, { email: t.email, ...b });
  return { ok: true };
});

// ---------- companies ----------
on("GET", "/companies", async ({ u }) => {
  need(u);
  return u.role === "admin" ? query("SELECT * FROM companies ORDER BY active DESC, name")
    : query("SELECT c.* FROM companies c JOIN user_companies uc ON uc.company_id=c.id WHERE uc.user_id=$1 AND c.active ORDER BY c.name", [u.id]);
});
on("POST", "/companies", async ({ req, u }) => {
  need(u, "admin");
  const { name, tax_id = "", branch = "0" } = await body(req);
  if (!String(name || "").trim()) fail(400, "กรุณาระบุชื่อบริษัท");
  const c = await one("INSERT INTO companies (name, tax_id, branch) VALUES ($1,$2,$3) RETURNING *", [name.trim(), String(tax_id).replace(/\D/g, ""), String(branch || "0").padStart(5, "0")]);
  await audit(u.email, "company_add", null, c);
  return c;
});
on("PATCH", "/companies/:id", async ({ req, u, p }) => {
  need(u, "admin");
  const b = await body(req);
  await query("UPDATE companies SET name=COALESCE($2,name), tax_id=COALESCE($3,tax_id), branch=COALESCE($4,branch), active=COALESCE($5,active) WHERE id=$1",
    [+p.id, b.name ?? null, b.tax_id != null ? String(b.tax_id).replace(/\D/g, "") : null, b.branch != null ? String(b.branch).padStart(5, "0") : null, b.active ?? null]);
  await audit(u.email, "company_edit", null, { id: +p.id, ...b });
  return { ok: true };
});

// ---------- batches ----------
on("GET", "/batches", async ({ u, url }) => {
  need(u);
  const cid = +url.searchParams.get("company_id");
  if (!cid || !(await canCompany(u, cid))) fail(403, "ไม่มีสิทธิ์ในบริษัทนี้");
  return query(`SELECT b.*, (SELECT count(*)::int FROM records r WHERE r.batch_id=b.id) AS n
                FROM batches b WHERE company_id=$1 ORDER BY period DESC, form, seq`, [cid]);
});
on("POST", "/batches", async ({ req, u }) => {
  need(u, "admin", "keyer");
  const { company_id, form, period, seq = 0 } = await body(req);
  if (!FORMS[form]) fail(400, "แบบไม่ถูกต้อง");
  checkPeriod(period);
  if (!(await canCompany(u, +company_id))) fail(403, "ไม่มีสิทธิ์ในบริษัทนี้");
  if (await one("SELECT 1 AS x FROM batches WHERE company_id=$1 AND form=$2 AND period=$3 AND seq=$4", [+company_id, form, period, +seq]))
    fail(409, "มีชุดข้อมูลของแบบ/งวด/ครั้งที่นี้อยู่แล้ว");
  const b = await one("INSERT INTO batches (company_id, form, period, seq, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *", [+company_id, form, period, +seq, u.email]);
  await audit(u.email, "batch_create", b.id, { form, period, seq });
  return b;
});
on("GET", "/batches/:id", async ({ u, p }) => {
  need(u);
  const b = await getBatch(u, +p.id), recs = await loadRecords(b.id);
  return { batch: b, records: recs, check: validate(b.form, recs, b.period) };
});
on("DELETE", "/batches/:id", async ({ u, p }) => {
  need(u, "admin");
  const b = await getBatch(u, +p.id);
  if (b.status === "approved") fail(400, "ชุดที่อนุมัติแล้วลบไม่ได้ ต้องเปิดแก้ไขก่อน");
  await query("DELETE FROM batches WHERE id=$1", [b.id]);
  await audit(u.email, "batch_delete", b.id, { form: b.form, period: b.period });
  return { ok: true };
});
const editable = (b) => b.status === "draft" || fail(409, "ชุดนี้ส่งตรวจ/อนุมัติแล้ว แก้ไขไม่ได้");
on("PUT", "/batches/:id/records", async ({ req, u, p }) => {
  need(u, "admin", "keyer");
  const b = await getBatch(u, +p.id); editable(b);
  const { records = [], mode = "append" } = await body(req);
  if (!Array.isArray(records) || records.length > 5000) fail(400, "ข้อมูลต้องเป็นรายการ ไม่เกิน 5000 แถวต่อครั้ง");
  const rows = records.map((r) => normalizeRow(b.form, r));
  const ins = `INSERT INTO records (batch_id, row_no, data, updated_by)
    SELECT $1, base + ord, value, $3 FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(value, ord)`;
  if (mode === "replace")
    await query(`WITH d AS (DELETE FROM records WHERE batch_id=$1), x AS (SELECT 0 AS base) ${ins.replace("FROM jsonb", "FROM x, jsonb")}`, [b.id, JSON.stringify(rows), u.email]);
  else
    await query(`WITH x AS (SELECT COALESCE(MAX(row_no),0) AS base FROM records WHERE batch_id=$1) ${ins.replace("FROM jsonb", "FROM x, jsonb")}`, [b.id, JSON.stringify(rows), u.email]);
  await touch(b.id);
  await audit(u.email, mode === "replace" ? "records_replace" : "records_append", b.id, { count: rows.length });
  return { ok: true, count: rows.length };
});
on("PATCH", "/records/:id", async ({ req, u, p }) => {
  need(u, "admin", "keyer");
  const r = await one("SELECT * FROM records WHERE id=$1", [+p.id]); if (!r) fail(404, "ไม่พบรายการ");
  const b = await getBatch(u, r.batch_id); editable(b);
  const { data, version } = await body(req);
  const nd = normalizeRow(b.form, { ...r.data, ...data });
  const upd = await one("UPDATE records SET data=$2, version=version+1, updated_by=$3, updated_at=now() WHERE id=$1 AND version=$4 RETURNING id, version",
    [r.id, JSON.stringify(nd), u.email, +version]);
  if (!upd) fail(409, "มีคนอื่นแก้รายการนี้ไปก่อน กรุณาโหลดหน้าใหม่");
  const changed = Object.fromEntries(Object.keys(nd).filter((k) => nd[k] !== r.data[k]).map((k) => [k, [r.data[k], nd[k]]]));
  await touch(b.id); await audit(u.email, "record_edit", b.id, { row_no: r.row_no, changed });
  return upd;
});
on("DELETE", "/records/:id", async ({ u, p }) => {
  need(u, "admin", "keyer");
  const r = await one("SELECT * FROM records WHERE id=$1", [+p.id]); if (!r) fail(404, "ไม่พบรายการ");
  const b = await getBatch(u, r.batch_id); editable(b);
  await query("DELETE FROM records WHERE id=$1", [r.id]);
  await touch(b.id); await audit(u.email, "record_delete", b.id, { row_no: r.row_no, data: r.data });
  return { ok: true };
});
// ---------- ขั้นตอนอนุมัติ ----------
for (const [action, roles, from, to] of [
  ["submit", ["admin", "keyer"], "draft", "submitted"],
  ["approve", ["admin", "reviewer"], "submitted", "approved"],
  ["reject", ["admin", "reviewer"], "submitted", "draft"],
  ["reopen", ["admin"], "approved", "draft"],
]) on("POST", `/batches/:id/${action}`, async ({ req, u, p }) => {
  need(u, ...roles);
  const b = await getBatch(u, +p.id);
  if (b.status !== from) fail(409, `สถานะปัจจุบันคือ ${b.status} ทำรายการนี้ไม่ได้`);
  const { note = "" } = await body(req);
  if (action === "submit" || action === "approve") {
    const recs = await loadRecords(b.id);
    if (!recs.length) fail(400, "ยังไม่มีรายการ");
    const c = validate(b.form, recs, b.period);
    if (c.errors) fail(400, `ยังมี ERROR ${c.errors} รายการ ต้องแก้ก่อน`);
  }
  if (action === "approve" && b.submitted_by === u.email && u.role !== "admin") fail(403, "ผู้ส่งตรวจอนุมัติงานตัวเองไม่ได้");
  if ((action === "reject" || action === "reopen") && !String(note).trim()) fail(400, "กรุณาระบุเหตุผล");
  await query(`UPDATE batches SET status=$2, note=$3, updated_at=now(),
      submitted_by = CASE WHEN $4='submit' THEN $5 ELSE submitted_by END,
      approved_by  = CASE WHEN $4='approve' THEN $5 WHEN $2='draft' THEN NULL ELSE approved_by END,
      approved_at  = CASE WHEN $4='approve' THEN now() WHEN $2='draft' THEN NULL ELSE approved_at END
    WHERE id=$1`, [b.id, to, String(note), action, u.email]);
  await audit(u.email, "batch_" + action, b.id, { note });
  return { ok: true, status: to };
});
on("GET", "/batches/:id/export", async ({ u, p, url, res }) => {
  need(u);
  const b = await getBatch(u, +p.id);
  if (b.status !== "approved") fail(409, "ต้องได้รับอนุมัติก่อนจึงดาวน์โหลดไฟล์ได้");
  const recs = await loadRecords(b.id), c = validate(b.form, recs, b.period);
  if (c.errors) fail(400, "มี ERROR ในข้อมูล");
  const txt = buildTxt(b.form, recs, { sep: url.searchParams.get("sep") === "comma" ? "," : "|" });
  const enc = url.searchParams.get("enc") === "cp874" ? "cp874" : "utf-8";
  const buf = enc === "cp874" ? Buffer.from(toCp874(txt)) : Buffer.from(txt, "utf8");
  await audit(u.email, "export", b.id, { enc, rows: recs.length, amount: c.totals.amount, tax: c.totals.tax });
  const fname = `${b.form}_${b.period}${b.seq ? "_" + b.seq : ""}_${b.company_id}.txt`;
  res.statusCode = 200;
  res.setHeader("Content-Type", `text/plain; charset=${enc === "cp874" ? "windows-874" : "utf-8"}`);
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.end(buf);
  return undefined;
});
on("GET", "/batches/:id/audit", async ({ u, p }) => {
  need(u);
  const b = await getBatch(u, +p.id);
  return query("SELECT at, user_email, action, detail FROM audit_log WHERE batch_id=$1 ORDER BY at DESC, id DESC LIMIT 300", [b.id]);
});

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  let path = url.searchParams.get("p");
  path = "/" + (path ?? url.pathname.replace(/^\/api\/?/, "").replace(/^index\/?/, "")).replace(/^\/+|\/+$/g, "");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (req.method !== "GET" && req.headers["x-requested-with"] !== "botrd") fail(403, "คำขอไม่ถูกต้อง"); // กัน CSRF
    await ensureSchema();
    let match;
    const r = routes.find((x) => x.method === req.method && (match = path.match(x.re)));
    if (!r) fail(404, "ไม่พบ API " + path);
    const u = path === "/config" || path === "/auth/google" ? null : await currentUser(req);
    const out = await r.fn({ req, res, u, p: match.groups || {}, url });
    if (out !== undefined) { res.statusCode = 200; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(out)); }
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(e);
    res.statusCode = code; res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: code === 500 ? "ระบบขัดข้อง: " + e.message : e.message }));
  }
}
