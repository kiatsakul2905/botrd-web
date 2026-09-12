import { FORMS, allCols, mapHeaders, fmtDate, normDate } from "./rules.js";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLE = { admin: "แอดมิน", keyer: "ผู้คีย์", reviewer: "ผู้ตรวจ" };
const STATUS = { draft: "ร่าง", submitted: "รอตรวจ", approved: "อนุมัติแล้ว" };
let ME = null, CFG = null;

async function api(path, opt = {}) {
  const r = await fetch("/api/" + path, { method: opt.method || "GET", headers: { "Content-Type": "application/json", "X-Requested-With": "botrd" },
    body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "me") { ME = null; route(); }
  if (!r.ok) throw new Error(j.error || "เกิดข้อผิดพลาด " + r.status);
  return j;
}
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 3000); }
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const view = (html) => { $("#app").innerHTML = html; };
const thPeriod = (p) => { const [y, m] = p.split("-"); return `${m}/${+y + 543}`; };

// ---------- login ----------
function loginView() {
  $("#top").hidden = true;
  view(`<div class="center"><div class="card"><h1>BOTRD</h1><p class="muted">ระบบเตรียมไฟล์นำเข้า RD Prep</p><div id="gbtn"></div>
    <p class="muted" id="lmsg"></p></div></div>`);
  if (!CFG.googleClientId) { $("#lmsg").textContent = "ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID (ดู README)"; return; }
  const init = () => {
    if (!window.google?.accounts) return setTimeout(init, 200);
    google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: run(async (r) => { await api("auth/google", { method: "POST", body: { credential: r.credential } }); await boot(); }) });
    google.accounts.id.renderButton($("#gbtn"), { theme: "outline", size: "large", text: "signin_with", locale: "th" });
  };
  init();
}

// ---------- หน้าแรก: เลือกบริษัท + ชุดข้อมูล ----------
async function homeView() {
  const cos = (await api("companies")).filter((c) => c.active);
  if (!cos.length) return view(`<div class="card"><h1>ยังไม่มีบริษัท</h1><p class="muted">${ME.role === "admin" ? 'ไปที่ <a href="#/admin">จัดการผู้ใช้/บริษัท</a> เพื่อเพิ่มบริษัท' : "ติดต่อแอดมินเพื่อขอสิทธิ์เข้าถึงบริษัท"}</p></div>`);
  const saved = +localStorageGet("co") || cos[0].id, cid = cos.some((c) => c.id === saved) ? saved : cos[0].id;
  const now = new Date(), prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defP = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  view(`<div class="card"><div class="row"><h1 class="grow">ชุดข้อมูล</h1>
      <label>บริษัท <select id="co">${cos.map((c) => `<option value="${c.id}" ${c.id === cid ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
    ${ME.role !== "reviewer" ? `<div class="row" style="margin-top:8px"><b>สร้างชุดใหม่:</b>
      <select id="nf">${Object.entries(FORMS).map(([k, v]) => `<option value="${k}">${v.name}${v.unverified ? " (ทดลอง)" : ""}</option>`).join("")}</select>
      <label>งวด <input type="month" id="np" value="${defP}"></label>
      <label>ยื่นครั้งที่ <select id="ns"><option value="0">ปกติ</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">เพิ่มเติม ${n}</option>`).join("")}</select></label>
      <button id="nb">สร้าง</button></div>` : ""}</div>
    <div class="card"><div class="tbl" id="bl"></div></div>`);
  const load = run(async () => {
    const id = +$("#co").value; localStorageSet("co", id);
    const bs = await api("batches?company_id=" + id);
    $("#bl").innerHTML = bs.length ? `<table><tr><th>งวด</th><th>แบบ</th><th>ครั้งที่</th><th>รายการ</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr>
      ${bs.map((b) => `<tr><td>${thPeriod(b.period)}</td><td>${FORMS[b.form]?.name || b.form}</td><td>${b.seq ? "เพิ่มเติม " + b.seq : "ปกติ"}</td><td>${b.n}</td>
      <td><span class="pill st-${b.status}">${STATUS[b.status]}</span></td><td class="muted">${new Date(b.updated_at).toLocaleString("th-TH")}</td>
      <td><a class="btn ghost" href="#/b/${b.id}">เปิด</a></td></tr>`).join("")}</table>` : `<p class="muted" style="padding:12px">ยังไม่มีชุดข้อมูล</p>`;
  });
  $("#co").onchange = load; load();
  if ($("#nb")) $("#nb").onclick = run(async () => {
    const b = await api("batches", { method: "POST", body: { company_id: +$("#co").value, form: $("#nf").value, period: $("#np").value, seq: +$("#ns").value } });
    location.hash = "#/b/" + b.id;
  });
}
function localStorageGet(k) { try { return localStorage.getItem("botrd_" + k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem("botrd_" + k, v); } catch {} }

// ---------- หน้าชุดข้อมูล ----------
let TAB = "rows";
async function batchView(id) {
  const { batch: b, records, check } = await api("batches/" + id);
  const spec = FORMS[b.form], cols = allCols(b.form);
  const canEdit = b.status === "draft" && ME.role !== "reviewer";
  const byRow = {}; for (const i of check.issues) (byRow[i.row_no] ??= []).push(i);
  const acts = [];
  if (b.status === "draft" && ME.role !== "reviewer") acts.push(`<button data-act="submit">ส่งตรวจ</button>`);
  if (b.status === "submitted" && ME.role !== "keyer") acts.push(`<button data-act="approve">อนุมัติ</button><button class="ghost" data-act="reject">ตีกลับ</button>`);
  if (b.status === "approved") acts.push(`<button id="dl">ดาวน์โหลด .txt (UTF-8)</button><button class="ghost" id="dl874">.txt (TIS-620)</button>`);
  if (b.status === "approved" && ME.role === "admin") acts.push(`<button class="ghost" data-act="reopen">เปิดแก้ไข</button>`);
  if (ME.role === "admin" && b.status !== "approved") acts.push(`<button class="danger" id="del">ลบชุด</button>`);
  view(`<div class="card"><div class="row"><div class="grow"><h1>${spec.name} งวด ${thPeriod(b.period)} ${b.seq ? "(ยื่นเพิ่มเติม " + b.seq + ")" : ""}</h1>
      <div class="muted">${esc(b.company_name)} · <span class="pill st-${b.status}">${STATUS[b.status]}</span>
      ${b.note ? ` · หมายเหตุ: ${esc(b.note)}` : ""}${b.approved_by ? ` · อนุมัติโดย ${esc(b.approved_by)}` : ""}</div>
      ${spec.unverified ? `<p class="WARN">แบบนี้ยังไม่ได้ทดสอบนำเข้า RD Prep จริง ให้ทดลองนำเข้าก่อนใช้งาน</p>` : ""}</div>
      <div class="row">${acts.join("")}</div></div>
    <div class="stats" style="margin-top:12px"><div class="stat">รายการ<b>${check.totals.rows}</b></div><div class="stat">เงินได้รวม<b>${Number(check.totals.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b></div>
      <div class="stat">ภาษีรวม<b>${Number(check.totals.tax).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b></div>
      <div class="stat ERROR">ERROR<b>${check.errors}</b></div><div class="stat WARN">WARN<b>${check.warns}</b></div><div class="stat INFO">INFO<b>${check.infos}</b></div></div></div>
    ${canEdit ? `<div class="card row"><b>นำเข้า Excel:</b><input type="file" id="xf" accept=".xlsx,.xls,.csv">
      <select id="xm"><option value="append">เพิ่มต่อท้าย</option><option value="replace">แทนที่ทั้งหมด</option></select>
      <button id="xb">นำเข้า</button><span class="grow"></span><button class="ghost" id="tpl">ดาวน์โหลดแม่แบบ Excel</button><button class="ghost" id="add">+ เพิ่มแถว</button></div>` : ""}
    <div class="tabs"><button data-tab="rows">รายการ (${records.length})</button><button data-tab="issues">จุดต้องสงสัย (${check.issues.length})</button><button data-tab="log">ประวัติ</button></div>
    <div id="tab"></div>`);
  const showTab = run(async (t) => {
    TAB = t; document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === t));
    if (t === "rows") $("#tab").innerHTML = `<div class="tbl" style="max-height:70vh"><table><tr><th>#</th><th>ผลตรวจ</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}${canEdit ? "<th></th>" : ""}</tr>
      ${records.map((r) => { const is = byRow[r.row_no] || []; const cls = is.some((i) => i.level === "ERROR") ? "e" : is.some((i) => i.level === "WARN") ? "w" : "";
        return `<tr class="${cls}" data-id="${r.id}" data-v="${r.version}"><td>${r.row_no}</td><td title="${esc(is.map((i) => i.level + ": " + i.msg).join("\n"))}">${is.length ? is.map((i) => `<span class="${i.level}">${i.level[0]}</span>`).join("") : "✓"}</td>
        ${cols.map((c) => { let v = r.data[c] ?? ""; if (c === "วันเดือนปีที่จ่าย" && normDate(v)) v = fmtDate(normDate(v));
          return `<td>${canEdit ? `<input data-c="${esc(c)}" value="${esc(v)}">` : esc(v)}</td>`; }).join("")}
        ${canEdit ? `<td><button class="ghost" data-delr>ลบ</button></td>` : ""}</tr>`; }).join("")}</table></div>`;
    if (t === "issues") $("#tab").innerHTML = `<div class="tbl"><table><tr><th>ระดับ</th><th>แถว</th><th>วันที่</th><th>จำนวนเงิน</th><th>ผู้รับ</th><th>เลขที่เอกสาร</th><th>เหตุผลที่สงสัย</th></tr>
      ${check.issues.map((i) => { const r = records.find((x) => x.row_no === i.row_no)?.data || {}; const d = normDate(r["วันเดือนปีที่จ่าย"]);
        return `<tr><td class="${i.level}">${i.level}</td><td>${i.row_no}</td><td>${d ? fmtDate(d) : esc(r["วันเดือนปีที่จ่าย"])}</td><td>${esc(r["จำนวนเงินที่จ่าย"])}</td>
        <td>${esc(r["ชื่อ"] || r["ชื่อผู้รับเงิน"])} ${esc(r["ชื่อสกุล"] || "")}</td><td>${esc(r["เลขที่เอกสารอ้างอิง"])}</td><td>${esc(i.msg)}</td></tr>`; }).join("") || `<tr><td colspan="7">ไม่พบจุดต้องสงสัย</td></tr>`}</table></div>`;
    if (t === "log") { const log = await api(`batches/${id}/audit`);
      $("#tab").innerHTML = `<div class="tbl"><table><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr>${log.map((l) => `<tr><td>${new Date(l.at).toLocaleString("th-TH")}</td><td>${esc(l.user_email)}</td><td>${esc(l.action)}</td><td style="white-space:normal">${esc(JSON.stringify(l.detail))}</td></tr>`).join("")}</table></div>`; }
  });
  document.querySelectorAll("[data-tab]").forEach((x) => (x.onclick = () => showTab(x.dataset.tab)));
  showTab(TAB);
  // แก้ไขช่อง
  $("#tab").addEventListener("change", run(async (e) => {
    const inp = e.target.closest("input[data-c]"); if (!inp) return;
    const tr = inp.closest("tr"), r = await api("records/" + tr.dataset.id, { method: "PATCH", body: { data: { [inp.dataset.c]: inp.value }, version: +tr.dataset.v } });
    tr.dataset.v = r.version; toast("บันทึกแล้ว"); clearTimeout(batchView.t); batchView.t = setTimeout(() => batchView(id), 1500);
  }));
  $("#tab").addEventListener("click", run(async (e) => {
    if (!e.target.matches("[data-delr]")) return;
    if (!confirm("ลบแถวนี้?")) return;
    await api("records/" + e.target.closest("tr").dataset.id, { method: "DELETE" }); batchView(id);
  }));
  document.querySelectorAll("[data-act]").forEach((x) => (x.onclick = run(async () => {
    const act = x.dataset.act; let note = "";
    if (act === "reject" || act === "reopen") { note = prompt("ระบุเหตุผล"); if (!note) return; }
    if (act === "approve" && !confirm(`ยืนยันอนุมัติ ${check.totals.rows} รายการ ภาษีรวม ${check.totals.tax} บาท?`)) return;
    await api(`batches/${id}/${act}`, { method: "POST", body: { note } }); toast("เรียบร้อย"); batchView(id);
  })));
  const dl = (enc) => { location.href = `/api/batches/${id}/export${enc ? "?enc=" + enc : ""}`; };
  if ($("#dl")) { $("#dl").onclick = () => dl(); $("#dl874").onclick = () => dl("cp874"); }
  if ($("#del")) $("#del").onclick = run(async () => { if (!confirm("ลบชุดข้อมูลนี้ทั้งหมด?")) return; await api("batches/" + id, { method: "DELETE" }); location.hash = "#/"; });
  if (!canEdit) return;
  $("#tpl").onclick = () => { const ws = XLSX.utils.aoa_to_sheet([cols]); ws["!cols"] = cols.map((c) => ({ wch: Math.max(12, c.length + 4) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Data"); XLSX.writeFile(wb, `${b.form}_แม่แบบ.xlsx`); };
  $("#add").onclick = run(async () => { await api(`batches/${id}/records`, { method: "PUT", body: { mode: "append", records: [{}] } }); batchView(id); });
  $("#xb").onclick = run(async () => {
    const f = $("#xf").files[0]; if (!f) return toast("เลือกไฟล์ก่อน", true);
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: false, cellDates: false });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "", blankrows: true });
    const hi = rows.findIndex((r) => mapHeaders(b.form, r).missing.length < 4); if (hi < 0) throw new Error("ไม่พบแถวหัวคอลัมน์ที่ตรงกับแม่แบบ");
    const { map, missing, unknown } = mapHeaders(b.form, rows[hi]);
    const data = rows.slice(hi + 1).filter((r) => r.some((v) => String(v).trim())).map((r) => Object.fromEntries(Object.entries(map).map(([c, i]) => [c, r[i]])));
    // วันที่จาก Excel ที่เป็นชนิดวันที่: อ่านค่าดิบเป็นเลข serial ให้ถูกต้อง
    const ws = wb.Sheets[wb.SheetNames[0]], dc = map["วันเดือนปีที่จ่าย"], R0 = XLSX.utils.decode_range(ws["!ref"]).s;
    if (dc !== undefined) { let k = 0; for (let r = hi + 1; r < rows.length; r++) { if (!rows[r].some((v) => String(v).trim())) continue;
      const cell = ws[XLSX.utils.encode_cell({ r: R0.r + r, c: R0.c + dc })]; if (cell && cell.t === "n") data[k]["วันเดือนปีที่จ่าย"] = String(cell.v); k++; } }
    // ยอดเงิน: ใช้ค่าตัวเลขจริง ไม่ใช้ค่าที่ Excel จัดรูปแบบแล้ว (กันปัดเศษจากการแสดงผล)
    for (const c of ["จำนวนเงินที่จ่าย", "จำนวนเงินภาษีที่หัก", "อัตราภาษีร้อยละ"]) { const ci = map[c]; if (ci === undefined) continue; let k = 0;
      for (let r = hi + 1; r < rows.length; r++) { if (!rows[r].some((v) => String(v).trim())) continue;
        const cell = ws[XLSX.utils.encode_cell({ r: R0.r + r, c: R0.c + ci })]; if (cell && cell.t === "n") data[k][c] = String(cell.v); k++; } }
    const msg = `พบ ${data.length} แถว` + (missing.length ? `\nไม่พบคอลัมน์: ${missing.join(", ")}` : "") + (unknown.length ? `\nคอลัมน์ที่ไม่ใช้: ${unknown.join(", ")}` : "")
      + `\n\n${$("#xm").value === "replace" ? "แทนที่ข้อมูลเดิมทั้งหมด" : "เพิ่มต่อท้าย"} ยืนยัน?`;
    if (!confirm(msg)) return;
    await api(`batches/${id}/records`, { method: "PUT", body: { mode: $("#xm").value, records: data } });
    toast(`นำเข้า ${data.length} แถวแล้ว`); batchView(id);
  });
}

// ---------- แอดมิน ----------
async function adminView() {
  const [users, cos] = await Promise.all([api("users"), api("companies")]);
  view(`<div id="adm"><div class="card"><h1>บริษัท (ผู้จ่ายเงิน)</h1>
    <div class="row"><input id="cn" placeholder="ชื่อบริษัท" class="grow"><input id="ct" placeholder="เลขผู้เสียภาษี 13 หลัก"><input id="cb" placeholder="สาขา (0=สนญ.)" size="8"><button id="ca">เพิ่มบริษัท</button></div>
    <div class="tbl" style="margin-top:8px"><table><tr><th>ชื่อ</th><th>เลขผู้เสียภาษี</th><th>สาขา</th><th>ใช้งาน</th></tr>
    ${cos.map((c) => `<tr data-cid="${c.id}"><td><input data-f="name" value="${esc(c.name)}"></td><td><input data-f="tax_id" value="${esc(c.tax_id)}"></td><td><input data-f="branch" value="${esc(c.branch)}" size="6"></td>
      <td><input type="checkbox" data-f="active" ${c.active ? "checked" : ""}></td></tr>`).join("")}</table></div></div>
  <div class="card"><h1>ผู้ใช้</h1><p class="muted">ผู้ใช้ล็อกอินด้วยบัญชี Google ของอีเมลที่เพิ่มไว้ที่นี่เท่านั้น</p>
    <div class="row"><input id="ue" placeholder="อีเมล Google" class="grow"><select id="ur">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select><button id="ua">เพิ่มผู้ใช้</button></div>
    <div class="tbl" style="margin-top:8px"><table><tr><th>อีเมล</th><th>ชื่อ</th><th>บทบาท</th><th>ใช้งาน</th><th>บริษัทที่เข้าถึงได้ (แอดมินเห็นทุกบริษัท)</th><th>ล็อกอินล่าสุด</th></tr>
    ${users.map((x) => `<tr data-uid="${x.id}"><td>${esc(x.email)}</td><td>${esc(x.name)}</td>
      <td><select data-f="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${x.role === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><input type="checkbox" data-f="active" ${x.active ? "checked" : ""}></td>
      <td style="white-space:normal">${cos.map((c) => `<label style="margin-right:8px"><input type="checkbox" data-co="${c.id}" ${x.company_ids.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("")}</td>
      <td class="muted">${x.last_login ? new Date(x.last_login).toLocaleString("th-TH") : "-"}</td></tr>`).join("")}</table></div></div></div>`);
  $("#ca").onclick = run(async () => { await api("companies", { method: "POST", body: { name: $("#cn").value, tax_id: $("#ct").value, branch: $("#cb").value || "0" } }); adminView(); });
  $("#ua").onclick = run(async () => { await api("users", { method: "POST", body: { email: $("#ue").value, role: $("#ur").value } }); adminView(); });
  $("#adm").addEventListener("change", run(async (e) => {
    const t = e.target, cr = t.closest("[data-cid]"), ur = t.closest("[data-uid]");
    if (cr) await api("companies/" + cr.dataset.cid, { method: "PATCH", body: { [t.dataset.f]: t.type === "checkbox" ? t.checked : t.value } });
    if (!cr && !ur) return;
    if (ur) { const body = t.dataset.co ? { company_ids: [...ur.querySelectorAll("[data-co]:checked")].map((x) => +x.dataset.co) } : { [t.dataset.f]: t.type === "checkbox" ? t.checked : t.value };
      await api("users/" + ur.dataset.uid, { method: "PATCH", body }); }
    toast("บันทึกแล้ว");
  }));
}

function helpView() {
  view(`<div class="card help"><h1>วิธีใช้</h1><ol>
    <li><b>ผู้คีย์</b>: เลือกบริษัท → สร้างชุดใหม่ (แบบ + งวด) → ดาวน์โหลดแม่แบบ Excel → กรอก/วางข้อมูล → นำเข้า หรือแก้ไขในตารางได้ทันที</li>
    <li>ดูแท็บ <b>จุดต้องสงสัย</b> แก้ ERROR ให้หมด (WARN/INFO ให้พิจารณา) แล้วกด <b>ส่งตรวจ</b></li>
    <li><b>ผู้ตรวจ</b>: เปิดชุดที่ "รอตรวจ" ตรวจยอดรวมกับ Express → <b>อนุมัติ</b> หรือ <b>ตีกลับ</b> พร้อมเหตุผล</li>
    <li>เมื่ออนุมัติแล้ว กด <b>ดาวน์โหลด .txt</b> → เปิด RD Prep → โอนย้ายข้อมูล → เลือกไฟล์ → ตัวคั่น <b>|</b> → เปิด "บรรทัดแรกชื่อคอลัมน์" → จับคู่คอลัมน์ตามชื่อ → วันที่ พ.ศ. dd/mm/yyyy</li>
    <li>ถ้าภาษาไทยใน RD Prep เพี้ยน ให้ใช้ปุ่ม <b>.txt (TIS-620)</b> แทน</li>
    <li>เงื่อนไข: 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว · สาขา 0 = สำนักงานใหญ่</li>
    <li>ระบบไม่ปัดเศษและไม่แก้ยอดเงินให้เอง ทุกการแก้ไขถูกบันทึกในแท็บ <b>ประวัติ</b></li></ol></div>`);
}

async function route() {
  if (!ME) return loginView();
  $("#top").hidden = false; $("#who").textContent = `${ME.email} (${ROLE[ME.role]})`; $("#navAdmin").hidden = ME.role !== "admin";
  const h = location.hash, m = h.match(/^#\/b\/(\d+)/);
  try {
    if (m) await batchView(+m[1]); else if (h === "#/admin" && ME.role === "admin") await adminView(); else if (h === "#/help") helpView(); else await homeView();
  } catch (e) { view(`<div class="card ERROR">${esc(e.message)}</div>`); }
}
async function boot() {
  CFG = CFG || (await api("config"));
  ME = await api("me").catch(() => null);
  route();
}
window.addEventListener("hashchange", () => { TAB = "rows"; route(); });
$("#logout").onclick = run(async () => { await api("auth/logout", { method: "POST" }); google?.accounts?.id?.disableAutoSelect?.(); ME = null; route(); });
boot().catch((e) => view(`<div class="card ERROR">${esc(e.message)}</div>`));
