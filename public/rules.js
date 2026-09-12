// กฎของแต่ละแบบ + การตรวจสอบ + สร้างไฟล์ .txt สำหรับ RD Prep
// ใช้ได้ทั้งฝั่ง server (Node) และ browser
export const ADDR = ["ชื่ออาคาร", "ห้องเลขที่", "ชั้นที่", "หมู่บ้าน", "เลขที่", "หมู่ที่", "ตรอก/ซอย", "แยก",
  "ถนน", "ตำบล/แขวง", "อำเภอ/เขต", "จังหวัด", "รหัสไปรษณีย์"];
const PAY = ["วันเดือนปีที่จ่าย", "ประเภทเงินได้", "อัตราภาษีร้อยละ", "จำนวนเงินที่จ่าย", "จำนวนเงินภาษีที่หัก", "เงื่อนไข"];
const TIN = "เลขประจำตัวผู้เสียภาษีอากร";

export const FORMS = {
  PND1:  { name: "ภ.ง.ด.1",  id: "person",   cols: [TIN, "คำนำหน้าชื่อ", "ชื่อ", "ชื่อกลาง", "ชื่อสกุล", "วันเดือนปีที่จ่าย", "ประเภทเงินได้", "จำนวนเงินที่จ่าย", "จำนวนเงินภาษีที่หัก", "เงื่อนไข"] },
  PND2:  { name: "ภ.ง.ด.2",  id: "person",   cols: [TIN, "คำนำหน้าชื่อ", "ชื่อ", "ชื่อกลาง", "ชื่อสกุล", ...ADDR, ...PAY], rates: ["10", "15"], unverified: true },
  PND3:  { name: "ภ.ง.ด.3",  id: "person",   cols: [TIN, "สาขาที่", "คำนำหน้าชื่อ", "ชื่อ", "ชื่อกลาง", "ชื่อสกุล", ...ADDR, ...PAY], rates: ["1", "1.5", "2", "3", "5", "10", "15"] },
  PND53: { name: "ภ.ง.ด.53", id: "juristic", cols: [TIN, "สาขาที่", "คำนำหน้าชื่อ", "ชื่อ", ...ADDR, ...PAY], rates: ["1", "1.5", "2", "3", "5", "10", "15"] },
  PND54: { name: "ภ.ง.ด.54", id: "foreign",  cols: ["เลขประจำตัวผู้เสียภาษี(ต่างประเทศ)", "ชื่อผู้รับเงิน", "ที่อยู่", "ประเทศ", ...PAY], rates: ["5", "10", "15"], unverified: true },
};
export const EXTRA = ["เลขที่เอกสารอ้างอิง", "หมายเหตุ"];           // ใช้ตรวจสอบ ไม่ส่งออก
const REQUIRED = new Set([TIN, "เลขประจำตัวผู้เสียภาษี(ต่างประเทศ)", "ชื่อ", "ชื่อผู้รับเงิน",
  "วันเดือนปีที่จ่าย", "จำนวนเงินที่จ่าย", "จำนวนเงินภาษีที่หัก", "เงื่อนไข"]);
// ชื่อหัวคอลัมน์อื่นที่พบบ่อย (เช่น จาก Express) -> ชื่อมาตรฐาน
export const ALIASES = {
  "เลขประจำตัวผู้เสียภาษี": TIN, "เลขผู้เสียภาษี": TIN, "เลขประจำตัวประชาชน": TIN, "tax id": TIN, "taxid": TIN,
  "สาขา": "สาขาที่", "คำนำหน้า": "คำนำหน้าชื่อ", "นามสกุล": "ชื่อสกุล", "ชื่อผู้มีเงินได้": "ชื่อ",
  "วันที่จ่าย": "วันเดือนปีที่จ่าย", "วันที่": "วันเดือนปีที่จ่าย", "อัตรา": "อัตราภาษีร้อยละ", "อัตราภาษี": "อัตราภาษีร้อยละ",
  "จำนวนเงิน": "จำนวนเงินที่จ่าย", "เงินได้": "จำนวนเงินที่จ่าย", "ภาษีที่หัก": "จำนวนเงินภาษีที่หัก", "ภาษี": "จำนวนเงินภาษีที่หัก",
  "เลขที่เอกสาร": "เลขที่เอกสารอ้างอิง", "ตำบล": "ตำบล/แขวง", "อำเภอ": "อำเภอ/เขต", "ซอย": "ตรอก/ซอย", "อาคาร": "ชื่ออาคาร",
};
export const allCols = (form) => [...FORMS[form].cols, ...EXTRA];

export function tinOk(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0; for (let i = 0; i < 12; i++) sum += +s[i] * (13 - i);
  return (11 - (sum % 11)) % 10 === +s[12];
}

// รับ dd/mm/yyyy (พ.ศ./ค.ศ.), yyyy-mm-dd หรือเลข serial ของ Excel -> "YYYY-MM-DD" (ค.ศ.) หรือ null
export function normDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let y, m, d, r;
  if (/^\d{4,5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  } else if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { [y, m, d] = [+r[1], +r[2], +r[3]]; }
  else if ((r = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) { [d, m, y] = [+r[1], +r[2], +r[3]]; }
  else return null;
  if (y > 2400) y -= 543;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export const fmtDate = (iso, era = "BE") => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${era === "BE" ? +y + 543 : y}`; };

// เงินเป็น "สตางค์" (จำนวนเต็ม) เพื่อไม่ให้ทศนิยมเพี้ยน; คืน null ถ้าไม่ใช่ตัวเลข / NaN ถ้าเกิน 2 ตำแหน่ง
export function toSatang(v) {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (s === "") return null;
  const r = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!r) return undefined;
  const frac = (r[3] || "").replace(/0+$/, "");
  if (frac.length > 2) return NaN;
  return (r[1] ? -1 : 1) * (Number(r[2]) * 100 + Number(frac.padEnd(2, "0")));
}
const baht = (st) => (st < 0 ? "-" : "") + Math.floor(Math.abs(st) / 100) + "." + String(Math.abs(st) % 100).padStart(2, "0");
export const fmtMoney = baht;

// ทำความสะอาดข้อมูล 1 แถวก่อนบันทึก (ไม่แก้ยอดเงิน)
export function normalizeRow(form, raw) {
  const out = {};
  for (const c of allCols(form)) out[c] = String(raw[c] ?? "").trim();
  const idc = FORMS[form].cols[0];
  if (FORMS[form].id !== "foreign" && out[idc]) out[idc] = out[idc].replace(/[\s-]/g, "");
  const d = normDate(out["วันเดือนปีที่จ่าย"]);
  if (d) out["วันเดือนปีที่จ่าย"] = d;
  if ("สาขาที่" in out && /^\d{1,5}$/.test(out["สาขาที่"] || "0")) out["สาขาที่"] = (out["สาขาที่"] || "0").padStart(5, "0");
  for (const c of ["จำนวนเงินที่จ่าย", "จำนวนเงินภาษีที่หัก"]) out[c] = out[c].replace(/,/g, "");
  return out;
}

// จับคู่หัวคอลัมน์จาก Excel -> ชื่อมาตรฐาน
export function mapHeaders(form, headers) {
  const std = allCols(form), map = {}, unknown = [];
  headers.forEach((h, i) => {
    const k = String(h ?? "").trim();
    if (!k) return;
    const hit = std.includes(k) ? k : ALIASES[k] || ALIASES[k.toLowerCase()];
    if (hit && std.includes(hit) && !(hit in map)) map[hit] = i; else unknown.push(k);
  });
  return { map, missing: FORMS[form].cols.filter((c) => REQUIRED.has(c) && !(c in map)), unknown };
}

// ตรวจทั้งชุด: rows = [{id?, row_no, data}], period = "YYYY-MM"
export function validate(form, rows, period, opt = {}) {
  const spec = FORMS[form], idc = spec.cols[0], issues = [];
  const tol = opt.tolSatang ?? 1, outX = opt.outlierX ?? 5;
  const add = (level, r, msg) => issues.push({ level, row_no: r.row_no, record_id: r.id, msg });
  let totA = 0, totT = 0;
  const parsed = rows.map((r) => {
    const x = r.data, p = { ...r, amt: toSatang(x["จำนวนเงินที่จ่าย"]), tax: toSatang(x["จำนวนเงินภาษีที่หัก"]), date: normDate(x["วันเดือนปีที่จ่าย"]) };
    for (const c of spec.cols) if (REQUIRED.has(c) && !x[c]) add("ERROR", r, `ไม่มีข้อมูล "${c}"`);
    if (x[idc] && spec.id !== "foreign") {
      if (!tinOk(x[idc])) add("ERROR", r, `เลขผู้เสียภาษี ${x[idc]} ไม่ถูกต้อง (ไม่ครบ 13 หลักหรือ check digit ผิด)`);
      else if (spec.id === "juristic" && x[idc][0] !== "0") add("WARN", r, "ภ.ง.ด.53 แต่เลขไม่ขึ้นต้นด้วย 0 (อาจเป็นบุคคลธรรมดา ควรอยู่ ภ.ง.ด.3)");
      else if (spec.id === "person" && x[idc][0] === "0") add("WARN", r, `${spec.name} แต่เลขขึ้นต้นด้วย 0 (อาจเป็นนิติบุคคล ควรอยู่ ภ.ง.ด.53)`);
    }
    if ("สาขาที่" in x && !/^\d{5}$/.test(x["สาขาที่"] || "")) add("ERROR", r, `สาขาที่ "${x["สาขาที่"]}" ไม่ถูกต้อง (ตัวเลขไม่เกิน 5 หลัก)`);
    if (x["วันเดือนปีที่จ่าย"] && !p.date) add("ERROR", r, `อ่านวันที่ "${x["วันเดือนปีที่จ่าย"]}" ไม่ได้ (ใช้ dd/mm/yyyy)`);
    if (p.date && period && p.date.slice(0, 7) !== period) add("ERROR", r, `วันที่นอกงวด ${period}`);
    if (p.date) { const wd = new Date(p.date + "T00:00:00Z").getUTCDay(); if (wd === 0 || wd === 6) add("INFO", r, "จ่ายวันเสาร์/อาทิตย์"); }
    for (const [k, v, label] of [["amt", p.amt, "จำนวนเงินที่จ่าย"], ["tax", p.tax, "ภาษีที่หัก"]]) {
      if (v === undefined) add("ERROR", r, `${label} ไม่ใช่ตัวเลข`);
      else if (Number.isNaN(v)) add("ERROR", r, `${label} เกิน 2 ตำแหน่ง (ระบบไม่ปัดให้)`);
      if (typeof v !== "number" || Number.isNaN(v)) p[k] = null;
    }
    if (p.amt !== null && p.amt <= 0) add("ERROR", r, "จำนวนเงินที่จ่ายต้องมากกว่า 0");
    if (p.tax !== null && p.tax < 0) add("ERROR", r, "ภาษีติดลบ");
    if (x["เงื่อนไข"] && !["1", "2", "3"].includes(x["เงื่อนไข"])) add("ERROR", r, "เงื่อนไขต้องเป็น 1 (หัก ณ ที่จ่าย) 2 (ออกให้ตลอดไป) 3 (ออกให้ครั้งเดียว)");
    if (spec.rates) {
      const rs = String(x["อัตราภาษีร้อยละ"] ?? "").trim(), rate = Number(rs);
      if (!rs || !/^\d+(\.\d+)?$/.test(rs)) add("ERROR", r, "ไม่มีอัตราภาษี หรือไม่ใช่ตัวเลข");
      else {
        if (!spec.rates.includes(String(rate))) add("WARN", r, `อัตรา ${rs}% ไม่ใช่อัตราปกติของ ${spec.name}`);
        if (p.amt && p.tax !== null && x["เงื่อนไข"] === "1") {
          const exp = (p.amt * rate) / 100;
          if (Math.abs(exp - p.tax) > tol) add("ERROR", r, `ภาษี ${baht(p.tax)} ≠ เงินได้×อัตรา = ${(exp / 100).toFixed(4)}`);
        }
      }
    }
    if (p.amt && p.tax !== null && p.tax > p.amt) add("ERROR", r, "ภาษีมากกว่าเงินที่จ่าย");
    if (!x["ประเภทเงินได้"]) add("WARN", r, "ไม่มีประเภทเงินได้");
    if (p.amt >= 1000000 && p.amt % 100000 === 0) add("INFO", r, "ยอดเงินกลม");
    totA += p.amt || 0; totT += p.tax || 0;
    return p;
  });
  const group = (keyFn) => { const g = new Map(); for (const p of parsed) { const k = keyFn(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); } return [...g.values()]; };
  for (const g of group((p) => `${p.data[idc]}|${p.date}|${p.amt}`)) if (g.length > 1)
    for (const p of g) add("WARN", p, `อาจซ้ำ: ผู้รับ+วันที่+ยอดเดียวกัน ${g.length} รายการ (แถว ${g.map((q) => q.row_no).join(", ")})`);
  for (const g of group((p) => `${p.data[idc]}|${p.date}`)) if (g.length >= 3)
    for (const p of g) add("WARN", p, `จ่ายผู้รับเดียวกัน ${g.length} ครั้งในวันเดียว (ซอยยอด?)`);
  const amts = parsed.map((p) => p.amt).filter((a) => a > 0);
  if (amts.length >= 5) {
    const avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    for (const p of parsed) if (p.amt > avg * outX) add("WARN", p, `ยอดสูงผิดปกติ (> ${outX} เท่าของค่าเฉลี่ย ${baht(Math.round(avg))})`);
  }
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level] || a.row_no - b.row_no);
  const count = (l) => issues.filter((i) => i.level === l).length;
  return { issues, totals: { rows: rows.length, amount: baht(totA), tax: baht(totT) }, errors: count("ERROR"), warns: count("WARN"), infos: count("INFO") };
}

// สร้างข้อความ .txt (| คั่น, มีหัวคอลัมน์, วันที่ dd/mm/yyyy พ.ศ.)
export function buildTxt(form, rows, { sep = "|", header = true, era = "BE" } = {}) {
  const cols = FORMS[form].cols, lines = [];
  if (header) lines.push(["ลำดับที่", ...cols].join(sep));
  rows.forEach((r, i) => {
    lines.push([String(i + 1), ...cols.map((c) => {
      const v = r.data[c] ?? "";
      if (c === "วันเดือนปีที่จ่าย") return fmtDate(normDate(v), era);
      if (c === "จำนวนเงินที่จ่าย" || c === "จำนวนเงินภาษีที่หัก") return baht(toSatang(v));
      return String(v).replaceAll(sep, " ").replace(/[\r\n]+/g, " ");
    })].join(sep));
  });
  return lines.join("\r\n") + "\r\n";
}

// แปลงเป็น TIS-620 (cp874) สำหรับกรณี RD Prep อ่าน UTF-8 แล้วภาษาไทยเพี้ยน
export function toCp874(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c >= 0x0e01 && c <= 0x0e5b) out.push(c - 0x0e01 + 0xa1);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}
