// เซิร์ฟเวอร์ทดสอบบนเครื่อง (ใช้ Postgres ในเครื่องผ่าน psql, ข้าม Google login ด้วย /dev-login?email=)
// ห้ามใช้ใน production — ไฟล์นี้ไม่ถูก deploy
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
const PG = (process.env.TEST_PG || "-h /tmp/pg -p 5433 -U postgres -d botrd_test").split(" ");
const lit = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v)
  : Array.isArray(v) ? `ARRAY[${v.map(lit).join(",")}]` : "'" + String(v).replace(/'/g, "''") + "'";
const psql = (sql) => execFileSync("psql", [...PG, "-AtqX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
globalThis.__TEST_DB__ = async (text, params) => {
  const q = text.replace(/\$(\d+)/g, (_, i) => lit(params[i - 1]));
  if (/^\s*(CREATE|DROP|ALTER)/i.test(q) || (!/RETURNING/i.test(q) && !/^\s*SELECT/i.test(q))) { psql(q); return []; }
  return JSON.parse(psql(`WITH t AS (${q}) SELECT COALESCE(json_agg(t), '[]') FROM t`).trim() || "[]");
};
process.env.SESSION_SECRET ||= "dev-secret-".repeat(4);
const { default: handler } = await import("../api/index.js");
const { makeSession, cookie } = await import("../lib/auth.js");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/dev-login") {
    const r = JSON.parse(psql(`SELECT COALESCE(json_agg(t),'[]') FROM (SELECT id FROM users WHERE email=${lit(u.searchParams.get("email"))}) t`));
    res.writeHead(302, { "Set-Cookie": cookie(makeSession(r[0]?.id ?? 0)), Location: "/" }); return res.end();
  }
  if (u.pathname.startsWith("/api/")) { req.url = "/api/index?p=" + u.pathname.slice(5) + (u.search ? "&" + u.search.slice(1) : ""); return handler(req, res); }
  const f = path.join("public", u.pathname === "/" ? "index.html" : path.normalize(u.pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": (types[path.extname(f)] || "text/plain") + "; charset=utf-8" }); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
