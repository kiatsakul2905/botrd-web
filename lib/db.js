// เชื่อม Neon ผ่าน HTTP (ไม่ต้องเปิด connection ค้าง เหมาะกับ Vercel)
let _q = null;
export async function query(text, params = []) {
  if (globalThis.__TEST_DB__) return globalThis.__TEST_DB__(text, params);
  if (!_q) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("ยังไม่ได้ตั้งค่า DATABASE_URL");
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    _q = (t, p) => (sql.query ? sql.query(t, p) : sql(t, p));
  }
  return _q(text, params);
}
export const one = async (t, p) => (await query(t, p))[0] || null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '',
     role TEXT NOT NULL CHECK (role IN ('admin','keyer','reviewer')), active BOOLEAN NOT NULL DEFAULT TRUE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS companies (id SERIAL PRIMARY KEY, name TEXT NOT NULL, tax_id TEXT DEFAULT '',
     branch TEXT DEFAULT '00000', active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS user_companies (user_id INT REFERENCES users(id) ON DELETE CASCADE,
     company_id INT REFERENCES companies(id) ON DELETE CASCADE, PRIMARY KEY (user_id, company_id))`,
  `CREATE TABLE IF NOT EXISTS batches (id SERIAL PRIMARY KEY, company_id INT NOT NULL REFERENCES companies(id),
     form TEXT NOT NULL, period TEXT NOT NULL, seq INT NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
     note TEXT DEFAULT '', created_by TEXT, submitted_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (company_id, form, period, seq))`,
  `CREATE TABLE IF NOT EXISTS records (id SERIAL PRIMARY KEY, batch_id INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
     row_no INT NOT NULL, data JSONB NOT NULL, version INT NOT NULL DEFAULT 1, updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS records_batch ON records(batch_id, row_no)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
     user_email TEXT, action TEXT NOT NULL, batch_id INT, detail JSONB)`,
  `CREATE INDEX IF NOT EXISTS audit_batch ON audit_log(batch_id, at)`,
];
let _ready = null;
export const ensureSchema = () => (_ready ??= (async () => { for (const s of SCHEMA) await query(s); })().catch((e) => { _ready = null; throw e; }));
export const audit = (email, action, batchId, detail) =>
  query("INSERT INTO audit_log (user_email, action, batch_id, detail) VALUES ($1,$2,$3,$4)", [email, action, batchId, JSON.stringify(detail ?? {})]);
