import crypto from "node:crypto";
// ---------- ตรวจ Google ID token (RS256) ----------
let jwksCache = { at: 0, keys: [] };
async function googleKeys() {
  if (globalThis.__TEST_JWKS__) return globalThis.__TEST_JWKS__;
  if (Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  return jwksCache.keys;
}
const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export async function verifyGoogle(idToken, clientId) {
  const [h, p, s] = String(idToken).split(".");
  if (!s) throw new Error("token ไม่ถูกรูปแบบ");
  const head = JSON.parse(b64u(h)), body = JSON.parse(b64u(p));
  if (head.alg !== "RS256") throw new Error("alg ไม่รองรับ");
  const jwk = (await googleKeys()).find((k) => k.kid === head.kid);
  if (!jwk) throw new Error("ไม่พบ key");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), b64u(s));
  if (!ok) throw new Error("ลายเซ็นไม่ถูกต้อง");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(body.iss)) throw new Error("iss ไม่ถูกต้อง");
  if (body.aud !== clientId) throw new Error("aud ไม่ตรง GOOGLE_CLIENT_ID");
  if (body.exp * 1000 < Date.now()) throw new Error("token หมดอายุ");
  if (!body.email_verified) throw new Error("อีเมลยังไม่ยืนยันกับ Google");
  return { email: body.email.toLowerCase(), name: body.name || "" };
}
// ---------- session cookie (HMAC) ----------
const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ต้องตั้งค่า SESSION_SECRET อย่างน้อย 32 ตัวอักษร");
  return s;
};
const TTL = 12 * 3600;
export function makeSession(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
export function readSession(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)botrd=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  const exp = crypto.createHmac("sha256", SECRET()).update(payload || "").digest("base64url");
  if (!sig || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const d = JSON.parse(Buffer.from(payload, "base64url"));
  return d.exp > Date.now() / 1000 ? d : null;
}
export const cookie = (val, maxAge = TTL) =>
  `botrd=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
