/* FIS Jira timesheet – giao diện (Shadow DOM, không ảnh hưởng CSS của Jira) */
(function () {
  'use strict';
  if (window.__fisTimesheetUI) return;
  window.__fisTimesheetUI = true;

  const T = window.FisTimesheet;
  const U = T.util;
  const isExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

  const host = document.createElement('div');
  host.id = 'fis-timesheet-host';
  // Chặn phím gõ trong bảng lọt ra phím tắt của Jira (vd "c" mở Create Issue)
  ['keydown', 'keypress', 'keyup'].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
  .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; background: #1f4e78; color: #fff;
         border: 0; border-radius: 22px; padding: 10px 16px; font-size: 13px; font-weight: bold; cursor: pointer;
         box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  .fab:hover { background: #2a6299; }
  .panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 2147483001;
           width: min(1280px, calc(100vw - 40px)); height: min(720px, calc(100vh - 40px)); display: flex; flex-direction: column;
           background: #fff; color: #172b4d; border: 1px solid #c1c7d0; border-radius: 6px;
           box-shadow: 0 8px 24px rgba(0,0,0,.25); font-size: 13px; }
  .panel.moved { transform: none; }
  .panel[hidden] { display: none; }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #1f4e78; color: #fff;
           border-radius: 6px 6px 0 0; cursor: move; user-select: none; touch-action: none; }
  header b { font-size: 14px; flex: 1; }
  header .user { font-size: 12px; opacity: .85; }
  header .x { background: none; border: 0; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
  nav { display: flex; align-items: flex-end; gap: 4px; padding: 8px 14px 0; border-bottom: 1px solid #dfe1e6; }
  .tab { border: 1px solid transparent; border-bottom: 0; background: none; padding: 7px 14px; font-size: 13px;
         color: #42526e; cursor: pointer; border-radius: 4px 4px 0 0; margin-bottom: -1px; }
  .tab.active { background: #fff; border-color: #dfe1e6; color: #0052cc; font-weight: bold; }
  .grow { flex: 1; }
  .loading { font-size: 12px; color: #5e6c84; padding-bottom: 6px; }
  .pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .pane[hidden] { display: none; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #ebecf0; }
  button.btn, label.btn { border: 1px solid #c1c7d0; background: #f4f5f7; color: #172b4d; border-radius: 3px;
           padding: 5px 10px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  button.btn:hover:not(:disabled), label.btn:hover { background: #ebecf0; }
  button.primary { background: #0052cc; border-color: #0052cc; color: #fff; }
  button.primary:hover:not(:disabled) { background: #0065ff; }
  button.tiny { padding: 1px 6px; font-size: 11px; }
  button:disabled { opacity: .5; cursor: default; }
  input[type=file] { display: none; }
  a { color: #0052cc; }
  .chk { white-space: nowrap; }
  .summary { padding: 6px 14px; min-height: 28px; }
  .ok { color: #006644; font-weight: bold; } .err { color: #bf2600; font-weight: bold; } .muted { color: #5e6c84; }
  .tbl { overflow: auto; flex: 1; min-height: 0; border-top: 1px solid #ebecf0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ebecf0; vertical-align: top; }
  th { position: sticky; top: 0; z-index: 1; background: #f4f5f7; font-size: 12px; color: #5e6c84; white-space: nowrap; }
  td.n { color: #5e6c84; white-space: pre-line; font-size: 11px; }
  tr.done td { background: #f3fcf7; } tr.error td { background: #fffaf9; }
  input.f, select.f { font-size: 12px; padding: 4px 5px; border: 1px solid #c1c7d0; border-radius: 3px; background: #fff;
          color: #172b4d; width: 100%; }
  input.f:focus, select.f:focus { outline: 2px solid #4c9aff; border-color: #4c9aff; }
  input.f:disabled, select.f:disabled { background: #f4f5f7; color: #5e6c84; }
  .stack { display: flex; flex-direction: column; gap: 3px; }
  .lbl { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #5e6c84; }
  .lbl span { width: 26px; flex: none; }
  td.st { min-width: 220px; max-width: 280px; font-size: 12px; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-right: 4px; }
  .t-ok { background: #e3fcef; color: #006644; } .t-error { background: #ffebe6; color: #bf2600; }
  .t-skip, .t-new, .t-draft { background: #f4f5f7; color: #5e6c84; } .t-running { background: #deebff; color: #0747a6; }
  .t-done { background: #00875a; color: #fff; }
  .msg { display: block; margin-top: 2px; } .warn { color: #974f0c; }
  .del { border: 0; background: none; color: #97a0af; font-size: 16px; cursor: pointer; padding: 0 4px; }
  .del:hover { color: #bf2600; }
  .empty { padding: 28px; text-align: center; color: #5e6c84; }
  /* Lịch */
  .calwrap { flex: 1; display: flex; gap: 16px; padding: 10px 14px; min-height: 0; overflow: hidden; }
  .calcol { width: 380px; flex: none; overflow: auto; }
  .calgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .wdh { text-align: center; font-size: 11px; color: #5e6c84; font-weight: bold; padding: 2px 0; }
  .day { border: 1px solid #dfe1e6; border-radius: 4px; min-height: 52px; padding: 3px 4px; font-size: 11px; position: relative;
         background: #fff; user-select: none; }
  .day .dn { font-weight: bold; font-size: 12px; }
  .day .hv { display: block; margin-top: 4px; font-weight: bold; }
  .day .pl { display: block; color: #0747a6; }
  .day.pick { cursor: pointer; } .day.pick:hover { border-color: #4c9aff; }
  .day.full { background: #e3fcef; } .day.full .hv { color: #006644; }
  .day.partial { background: #fffae6; } .day.partial .hv { color: #974f0c; }
  .day.empty { background: #ffebe6; } .day.empty .hv { color: #bf2600; }
  .day.weekend, .day.future { background: #f4f5f7; color: #a5adba; }
  .day.leave { background: repeating-linear-gradient(135deg, #f4f5f7 0 6px, #ebecf0 6px 12px); color: #6b778c; }
  .day.leave .hv { color: #6b778c; }
  .day.today { box-shadow: inset 0 0 0 2px #0052cc; }
  .day.sel { outline: 3px solid #0052cc; outline-offset: -1px; }
  .legend { font-size: 11px; color: #5e6c84; display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
  .calmsg { padding: 6px 14px; min-height: 26px; font-size: 12px; }
  .tasks { flex: 1; overflow: auto; }
  .task { border: 1px solid #dfe1e6; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; }
  .th { display: flex; gap: 8px; align-items: baseline; }
  .th .ts { flex: 1; } .th .tt { color: #5e6c84; white-space: nowrap; font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 12px; padding: 2px 4px 2px 9px; font-size: 12px;
          border: 1px solid; }
  .chip.Approved { background: #e3fcef; border-color: #abf5d1; color: #006644; }
  .chip.Pending { background: #deebff; border-color: #b3d4ff; color: #0747a6; }
  .chip.Rejected { background: #ffebe6; border-color: #ffbdad; color: #bf2600; }
  .chip button { border: 0; background: rgba(255,255,255,.7); border-radius: 50%; width: 18px; height: 18px; cursor: pointer;
                 font-size: 11px; line-height: 18px; padding: 0; color: #42526e; }
  .chip button:hover { background: #fff; color: #bf2600; }
</style>
<button class="fab" title="Khai timesheet">⏱ Timesheet</button>
<div class="panel" hidden>
  <header title="Kéo để di chuyển · Nhấp đúp để về giữa màn hình"><b>Khai timesheet</b><span class="user"></span><button class="x" title="Đóng">×</button></header>
  <nav>
    <button class="tab active" data-tab="draft">Khai mới <span class="cnt"></span></button>
    <button class="tab" data-tab="cal">Lịch &amp; đã khai</button>
    <span class="grow"></span>
    <span class="loading"></span>
    <button class="btn tiny refresh" title="Tải lại dữ liệu từ Jira">↻ Làm mới</button>
  </nav>
  <section class="pane draft">
    <div class="bar">
      <button class="btn add">+ Thêm dòng</button>
      <label class="btn">Nhập Excel…<input type="file" class="file" accept=".xlsx,.xlsm,.csv"></label>
      <a class="tpl" download="timesheet.xlsx" hidden>Tải file mẫu</a>
      <button class="btn clear-done" hidden>Ẩn dòng đã khai</button>
      <button class="btn clear-all">Xóa hết</button>
      <span class="grow"></span>
      <label class="chk"><input type="checkbox" class="close" checked> Close task sau khi log</label>
      <button class="btn primary run" disabled>Khai timesheet</button>
    </div>
    <div class="summary muted"></div>
    <div class="tbl">
      <table>
        <thead><tr><th>#</th><th>Dự án</th><th style="min-width:220px">Công việc</th><th style="min-width:190px">Component</th>
          <th>Ngày</th><th>Giờ/ngày</th><th>Type · Phase</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <datalist id="dl-sum"></datalist>
    <div class="dls"></div>
  </section>
  <section class="pane cal" hidden>
    <div class="bar">
      <button class="btn prev" title="Tháng trước">‹</button><b class="mlabel"></b><button class="btn next" title="Tháng sau">›</button>
      <span class="muted">Bấm vào ngày (T2–T6) để chọn</span>
      <span class="grow"></span>
      <button class="btn clear-sel" disabled>Bỏ chọn</button>
      <button class="btn mark-leave" disabled title="Ngày nghỉ sẽ không bị tự xếp và được bỏ qua khi khai">Đánh dấu nghỉ</button>
      <button class="btn primary add-sel" disabled>Thêm dòng khai cho ngày đã chọn</button>
    </div>
    <div class="calmsg muted"></div>
    <div class="calwrap">
      <div class="calcol">
        <div class="calgrid"></div>
        <div class="legend"><span><i style="background:#e3fcef"></i>Đủ 8h</span><span><i style="background:#fffae6"></i>Thiếu giờ</span>
          <span><i style="background:#ffebe6"></i>Chưa khai</span><span><i style="background:#dfe1e6"></i>Nghỉ</span><span style="color:#0747a6">+8 = đang nháp</span></div>
      </div>
      <div class="tasks"></div>
    </div>
  </section>
</div>`;
  (document.body || document.documentElement).appendChild(host);

  const $ = (s) => root.querySelector(s);
  const panel = $('.panel');
  const tbody = $('tbody');
  const H = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && k !== 'list') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => c !== null && c !== undefined && e.append(c));
    return e;
  };

  let sess = null;
  let initPromise = null;
  let rows = [];
  let busy = false;
  let validating = false;
  let revalidate = false;
  let vTimer = null;
  const today = U.todayIso();
  let calY = +today.slice(0, 4);
  let calM = +today.slice(5, 7);
  const sel = new Set();

  const loading = (t) => { $('.loading').textContent = t || ''; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Khởi tạo / nháp ----------
  const draftKey = () => `fis-timesheet-draft:${sess.user}`;
  const KEEP = ['project', 'summary', 'componentId', 'componentText', 'compAuto', 'start', 'end', 'skip', 'hours', 'type', 'phase',
    'description', 'estimate', 'autoDated'];
  function saveDraft() {
    if (!sess) return;
    try {
      const data = rows.filter((r) => r.status !== 'done').map((r) => Object.fromEntries(KEEP.map((k) => [k, r[k]])));
      localStorage.setItem(draftKey(), JSON.stringify(data));
    } catch (_) { /* bỏ qua: trình duyệt chặn storage */ }
  }
  const leaveKey = () => `fis-timesheet-leave:${sess.user}`;
  function saveLeave() {
    try { localStorage.setItem(leaveKey(), JSON.stringify([...sess.leave].sort())); } catch (_) { /* bỏ qua */ }
  }
  function loadLeave() {
    try { const a = JSON.parse(localStorage.getItem(leaveKey()) || '[]'); if (Array.isArray(a)) sess.leave = new Set(a); } catch (_) { /* bỏ qua */ }
  }
  function loadDraft() {
    try {
      const data = JSON.parse(localStorage.getItem(draftKey()) || '[]');
      return Array.isArray(data) ? data.map((d) => T.newRow(sess, d)) : [];
    } catch (_) { return []; }
  }

  function ensureInit() {
    if (!initPromise) {
      initPromise = (async () => {
        loading('Đang tải dữ liệu từ Jira…');
        sess = await new T.Session().init();
        $('.user').textContent = `${sess.displayName} (${sess.user})`;
        loadLeave();
        rows = loadDraft();
        fillSummaryList();
        await Promise.all([...new Set([sess.defaults.project, ...rows.map((r) => r.project)])].filter(Boolean).map(ensureProject));
        renderRows();
        loading('');
        if (rows.length) scheduleValidate(0);
        else setSummary('Bấm <b>+ Thêm dòng</b>, <b>Nhập Excel…</b> hoặc chọn ngày ở tab <b>Lịch</b>. Dự án, component, type, phase được tự điền theo task gần nhất của bạn.');
      })().catch((e) => {
        initPromise = null;
        loading('');
        $('.user').textContent = e.message;
        setSummary(`<span class="err">${esc(e.message)}</span>`);
        throw e;
      });
    }
    return initPromise;
  }

  async function ensureProject(project) {
    if (!project) return null;
    const m = await sess.meta(project);
    await sess.phases(m.id);
    const id = 'dl-c-' + project.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!root.getElementById(id)) {
      $('.dls').append(H('datalist', { id }, m.comps.map((c) => H('option', { value: c.name }))));
    }
    return m;
  }

  function fillSummaryList() {
    const dl = $('#dl-sum');
    dl.textContent = '';
    const seen = new Set();
    sess.recent.forEach((r) => {
      const n = U.norm(r.summary);
      if (!seen.has(n)) { seen.add(n); dl.append(H('option', { value: r.summary })); }
    });
  }

  // ---------- Bảng nháp ----------
  function setSummary(html) { $('.summary').innerHTML = html; }

  function compName(r) {
    const m = sess.metaNow(r.project);
    return m ? (m.comps.find((c) => c.id === r.componentId) || {}).name || '' : '';
  }

  function renderRows() {
    tbody.textContent = '';
    if (!rows.length) {
      tbody.append(H('tr', {}, H('td', { class: 'empty', colSpan: 9, text: 'Chưa có dòng nào' })));
    } else {
      rows.forEach((r, i) => tbody.append(rowEl(r, i)));
    }
    updateButtons();
  }

  function rowEl(r, i) {
    const locked = r.status === 'done' || r.status === 'running' || busy;
    const phases = sess.phasesNow(r.project);
    const listId = 'dl-c-' + r.project.replace(/[^A-Za-z0-9_-]/g, '_');
    const on = (f) => (e) => onEdit(r, f, e.target);
    const cName = compName(r) || r.componentText;
    const yr = (r.start || today).slice(0, 4);
    const tr = H('tr', { class: r.status, 'data-uid': r.uid },
      H('td', { class: 'n', text: String(i + 1) + (r.excelRow ? `\nExcel ${r.excelRow}` : '') }),
      H('td', {}, H('select', { class: 'f', disabled: locked, onchange: on('project'), style: 'width:175px' },
        sess.projects.map((p) => H('option', { value: p.key, text: p.key, title: p.name, selected: p.key === r.project })))),
      H('td', {}, H('input', { class: 'f', value: r.summary, placeholder: 'Nội dung công việc (gõ để gợi ý task cũ)', list: 'dl-sum',
        disabled: locked, onchange: on('summary') })),
      H('td', {}, H('input', { class: 'f', value: cName, title: cName, placeholder: 'Gõ mã, vd 30.3', list: listId,
        disabled: locked, onchange: on('component'), onfocus: (e) => e.target.select() })),
      H('td', {}, H('div', { class: 'stack' },
        H('label', { class: 'lbl' }, H('span', { text: 'Từ' }), H('input', { class: 'f', type: 'date', value: r.start, max: today, disabled: locked, onchange: on('start') })),
        H('label', { class: 'lbl' }, H('span', { text: 'Đến' }), H('input', { class: 'f', type: 'date', value: r.end, max: today, disabled: locked, onchange: on('end') })),
        H('label', { class: 'lbl', title: 'Ngày nghỉ trong khoảng, vd: 05/11, 06/11' }, H('span', { text: 'Bỏ' }),
          H('input', { class: 'f', value: r.skip.map(U.viDate).join(', '), placeholder: 'dd/mm, …', disabled: locked, onchange: on('skip'), 'data-year': yr })))),
      H('td', {}, H('input', { class: 'f', type: 'number', min: 0.5, max: 8, step: 0.5, value: r.hours, disabled: locked, onchange: on('hours'), style: 'width:60px' })),
      H('td', {}, H('div', { class: 'stack' },
        H('select', { class: 'f', disabled: locked, onchange: on('type'), style: 'width:110px' },
          T.TYPES.map((t) => H('option', { value: t, text: t, selected: t === r.type }))),
        H('select', { class: 'f', disabled: locked, onchange: on('phase'), style: 'width:110px' },
          (phases.length ? phases.map((p) => p.phaseValue) : [r.phase]).map((p) => H('option', { value: p, text: p, selected: U.norm(p) === U.norm(r.phase) }))))),
      H('td', { class: 'st' }),
      H('td', {}, H('button', { class: 'del', title: 'Xóa dòng', text: '×', disabled: r.status === 'running' || busy, onclick: () => removeRow(r) })),
    );
    fillStatus(tr.querySelector('td.st'), r);
    return tr;
  }

  function replaceRow(r) {
    const old = tbody.querySelector(`tr[data-uid="${r.uid}"]`);
    if (old) old.replaceWith(rowEl(r, rows.indexOf(r)));
  }

  function fillStatus(td, r) {
    td.textContent = '';
    const label = { new: 'Đang kiểm tra…', draft: 'Chưa đủ thông tin', ok: 'Hợp lệ', skip: 'Đã khai rồi', error: 'Lỗi', running: 'Đang khai…', done: 'Đã khai' }[r.status] || r.status;
    td.append(H('span', { class: 'tag t-' + r.status, text: label }));
    const link = r.key || r.duplicate;
    if (link) td.append(H('a', { href: '/browse/' + link, target: '_blank', text: link }));
    const msgs = [];
    if (r.status === 'draft') msgs.push('Nhập nội dung công việc');
    if (r.status === 'ok') msgs.push(`${r.days.length} ngày: ${r.days.map(U.viDate).join(', ')} · Est ${r.estimateCalc}`);
    if (r.status === 'error') msgs.push(...(r.errors || []));
    if (r.status === 'running' && r.stepMsg) msgs.push(r.stepMsg);
    if (r.status === 'done') msgs.push(r.result || '');
    msgs.filter(Boolean).forEach((m) => td.append(H('span', { class: 'msg', text: m })));
    if (r.status !== 'done') (r.warnings || []).forEach((m) => td.append(H('span', { class: 'msg warn', text: '⚠ ' + m })));
  }

  function refreshStatuses() {
    rows.forEach((r) => {
      const tr = tbody.querySelector(`tr[data-uid="${r.uid}"]`);
      if (tr) { tr.className = r.status; fillStatus(tr.querySelector('td.st'), r); }
    });
    const c = { ok: 0, skip: 0, error: 0, done: 0, draft: 0, hours: 0 };
    rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; if (r.status === 'ok') c.hours += r.hours * r.days.length; });
    if (rows.length) {
      setSummary(`<span class="ok">${c.ok} hợp lệ</span> (${U.fmtH(c.hours)} giờ) · <span class="muted">${c.skip} đã khai rồi</span> · ` +
        `<span class="err">${c.error} lỗi</span>${c.draft ? ` · <span class="muted">${c.draft} chưa đủ thông tin</span>` : ''}` +
        `${c.done ? ` · <span class="ok">${c.done} vừa khai xong</span>` : ''}`);
    }
    updateButtons();
  }

  function updateButtons() {
    const pending = rows.filter((r) => r.status !== 'done').length;
    $('.cnt').textContent = pending ? `(${pending})` : '';
    const ok = rows.filter((r) => r.status === 'ok');
    const run = $('.run');
    run.disabled = busy || validating || !ok.length || rows.some((r) => r.status === 'new');
    run.textContent = ok.length ? `Khai timesheet (${ok.length} dòng)` : 'Khai timesheet';
    $('.clear-done').hidden = !rows.some((r) => r.status === 'done');
    ['.add', '.clear-all', '.file', '.refresh', '.add-sel'].forEach((s) => { $(s).disabled = busy; });
    $('.add-sel').disabled = busy || ![...sel].some((d) => !(sess && sess.leave.has(d)));
    $('.clear-sel').disabled = !sel.size;
    const mk = $('.mark-leave');
    mk.disabled = !sel.size;
    mk.textContent = sel.size && sess && [...sel].every((d) => sess.leave.has(d)) ? 'Bỏ đánh dấu nghỉ' : 'Đánh dấu nghỉ';
  }

  function scheduleValidate(delay = 400) {
    clearTimeout(vTimer);
    vTimer = setTimeout(runValidate, delay);
  }

  async function runValidate() {
    if (!sess || busy) return;
    if (validating) { revalidate = true; return; }
    validating = true;
    updateButtons();
    try {
      await T.validate(sess, rows);
    } catch (e) {
      setSummary(`<span class="err">${esc(e.message)}</span>`);
    }
    validating = false;
    if (revalidate) { revalidate = false; return runValidate(); }
    refreshStatuses();
    saveDraft();
    if (!$('.cal').hidden) renderCal();
  }

  async function onEdit(r, f, el) {
    const v = el.value;
    r.importError = null;
    switch (f) {
      case 'project': {
        r.project = v;
        const m = await ensureProject(v);
        const c = sess.componentFor(v, r.summary);
        r.componentId = c && m.comps.some((x) => x.id === c.id) ? c.id : '';
        r.componentText = '';
        r.compAuto = true;
        replaceRow(r);
        break;
      }
      case 'summary': {
        r.summary = v.trim();
        const s = sess.suggestion(r.summary);
        if (s && r.compAuto) {
          if (s.project !== r.project) { r.project = s.project; await ensureProject(s.project); }
          if (s.comp) { r.componentId = s.comp.id; r.componentText = ''; }
          replaceRow(r);
        }
        break;
      }
      case 'component': {
        const m = await sess.meta(r.project);
        try {
          const c = T.resolveComponent(m.comps, v);
          r.componentId = c.id; r.componentText = '';
          el.value = c.name; el.title = c.name;
        } catch (_) { r.componentId = ''; r.componentText = v.trim(); }
        r.compAuto = false;
        break;
      }
      case 'start':
        r.start = v;
        if (!r.end || r.end < v) { r.end = v; replaceRow(r); }
        r.autoDated = false; r.autoError = null;
        break;
      case 'end':
        r.end = v; r.autoDated = false; r.autoError = null;
        break;
      case 'skip':
        try { r.skip = U.parseSkipAny(v, el.dataset.year); r.skipError = null; }
        catch (e) { r.importError = e.message; }
        break;
      case 'hours': r.hours = parseFloat(v); break;
      case 'type': r.type = v; break;
      case 'phase': r.phase = v; break;
      default: break;
    }
    r.status = 'new';
    refreshStatuses();
    scheduleValidate();
  }

  function removeRow(r) {
    rows = rows.filter((x) => x !== r);
    renderRows();
    scheduleValidate(0);
    if (!rows.length) saveDraft();
  }

  async function addRow(init = {}) {
    await ensureInit();
    const r = T.newRow(sess, init);
    if (!r.start) await T.allocateDates(sess, [...rows, r]);
    await ensureProject(r.project);
    rows.push(r);
    renderRows();
    scheduleValidate(0);
    const tr = tbody.querySelector(`tr[data-uid="${r.uid}"]`);
    if (tr) { tr.scrollIntoView({ block: 'nearest' }); tr.querySelectorAll('input.f')[0].focus(); }
    return r;
  }

  // ---------- Nhập Excel ----------
  $('.file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      await ensureInit();
      loading(`Đang đọc ${f.name}…`);
      const add = await T.rowsFromWorkbook(sess, await f.arrayBuffer(), f.name, rows);
      await Promise.all([...new Set(add.map((r) => r.project))].map((p) => ensureProject(p).catch(() => null)));
      rows.push(...add);
      renderRows();
      setSummary(`Đã nhập <b>${add.length}</b> dòng từ ${esc(f.name)}. Ô trống được tự điền theo task gần nhất — sửa trực tiếp trên bảng nếu cần.`);
      scheduleValidate(0);
    } catch (err) {
      setSummary(`<span class="err">Lỗi đọc file:</span> ${esc(err.message)}`);
    }
    loading('');
  });

  // ---------- Khai ----------
  $('.run').addEventListener('click', async () => {
    const todo = rows.filter((r) => r.status === 'ok');
    const hours = todo.reduce((s, r) => s + r.hours * r.days.length, 0);
    if (!window.confirm(`Tạo ${todo.length} task và log ${U.fmtH(hours)} giờ lên Jira?\n(Worklog ở trạng thái Pending chờ PM duyệt)`)) return;
    busy = true;
    renderRows();
    const closeTask = $('.close').checked;
    for (const r of todo) {
      r.status = 'running';
      r.stepMsg = '';
      replaceRow(r);
      try {
        await T.execute(sess, r, closeTask, (s) => { r.stepMsg = s; fillStatus(tbody.querySelector(`tr[data-uid="${r.uid}"] td.st`), r); });
      } catch (e) {
        r.status = 'error';
        r.errors = [e.message, r.key ? `Task ${r.key} đã tạo nhưng chưa hoàn tất — kiểm tra trên Jira` : ''].filter(Boolean);
      }
      replaceRow(r);
    }
    busy = false;
    renderRows();
    refreshStatuses();
    saveDraft();
    scheduleValidate(0);
  });

  $('.add').addEventListener('click', () => addRow());
  $('.clear-done').addEventListener('click', () => { rows = rows.filter((r) => r.status !== 'done'); renderRows(); refreshStatuses(); });
  $('.clear-all').addEventListener('click', () => {
    if (rows.length && !window.confirm('Xóa toàn bộ dòng nháp?')) return;
    rows = []; renderRows(); setSummary(''); saveDraft();
  });

  // ---------- Lịch & đã khai ----------
  function plannedByDay() {
    const p = {};
    rows.filter((r) => ['ok', 'new', 'error', 'draft'].includes(r.status)).forEach((r) => {
      U.rowDays(r, sess.leave).forEach((d) => { p[d] = (p[d] || 0) + (r.hours || 0); });
    });
    return p;
  }

  function calMsg(html) { $('.calmsg').innerHTML = html; }

  async function renderCal() {
    if (!sess) return;
    const y = calY, m = calM;
    $('.mlabel').textContent = `Tháng ${m}/${y}`;
    loading('Đang tải worklog…');
    let items;
    try { items = await sess.monthItems(y, m); } catch (e) { loading(''); calMsg(`<span class="err">${esc(e.message)}</span>`); return; }
    loading('');
    if (y !== calY || m !== calM) return;
    const byDay = {};
    items.filter((o) => o.status !== 'Rejected').forEach((o) => { byDay[o.date] = (byDay[o.date] || 0) + o.hours; });
    const planned = plannedByDay();

    const grid = $('.calgrid');
    grid.textContent = '';
    ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].forEach((w) => grid.append(H('div', { class: 'wdh', text: w })));
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    for (let k = 0; k < (U.weekday(first) + 6) % 7; k++) grid.append(H('div'));
    for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = U.addDays(d, 1)) {
      const h = byDay[d] || 0;
      const work = U.isWorkday(d);
      const future = d > today;
      const leave = sess.leave.has(d);
      const cls = ['day'];
      if (!work) cls.push('weekend');
      else if (future) cls.push('future');
      else if (leave && !h) cls.push('pick', 'leave');
      else { cls.push('pick', h >= 8 ? 'full' : h > 0 ? 'partial' : 'empty'); }
      if (d === today) cls.push('today');
      if (sel.has(d)) cls.push('sel');
      grid.append(H('div', {
        class: cls.join(' '), title: `${U.wdName(d)} ${U.viFull(d)}: đã khai ${U.fmtH(h)}h${planned[d] ? `, nháp +${U.fmtH(planned[d])}h` : ''}`,
        onclick: work && !future ? () => { sel.has(d) ? sel.delete(d) : sel.add(d); renderCal(); updateButtons(); } : null,
      },
      H('span', { class: 'dn', text: String(+d.slice(8, 10)) }),
      leave && !h ? H('span', { class: 'hv', text: 'Nghỉ' }) : (h || (work && !future)) ? H('span', { class: 'hv', text: `${U.fmtH(h)}h` }) : null,
      planned[d] ? H('span', { class: 'pl', text: `+${U.fmtH(planned[d])}` }) : null));
    }

    // Danh sách worklog theo task
    const box = $('.tasks');
    box.textContent = '';
    const byTask = {};
    items.forEach((o) => { (byTask[o.key] = byTask[o.key] || { key: o.key, summary: o.summary, items: [] }).items.push(o); });
    const tasks = Object.values(byTask).sort((a, b) => (a.items[0].date < b.items[0].date ? -1 : 1));
    if (!tasks.length) box.append(H('div', { class: 'empty', text: `Chưa khai worklog nào trong tháng ${m}/${y}` }));
    tasks.forEach((t) => {
      t.items.sort((a, b) => (a.date < b.date ? -1 : 1));
      const total = t.items.filter((o) => o.status !== 'Rejected').reduce((s, o) => s + o.hours, 0);
      const editable = t.items.filter((o) => o.status !== 'Approved');
      box.append(H('div', { class: 'task' },
        H('div', { class: 'th' },
          H('a', { href: '/browse/' + t.key, target: '_blank', text: t.key }),
          H('span', { class: 'ts', text: t.summary }),
          H('span', { class: 'tt', text: `Σ ${U.fmtH(total)}h` }),
          editable.length === t.items.length
            ? H('button', { class: 'btn tiny', text: 'Xóa cả task', title: 'Xóa mọi worklog trong tháng của task; task không còn giờ sẽ chuyển Cancelled', disabled: busy,
              onclick: () => doDelete(t.key, t.items, `toàn bộ ${t.items.length} ngày (${U.fmtH(total)}h)`) })
            : null),
        H('div', { class: 'chips' }, t.items.map((o) => H('span', { class: 'chip ' + o.status, title: `${o.status} · ${o.type} · ${o.phase}` },
          `${U.wdName(o.date)} ${U.viDate(o.date)} · ${U.fmtH(o.hours)}h`,
          o.status === 'Approved' ? ' ✓' : [
            H('button', { title: 'Sửa số giờ', text: '✎', disabled: busy, onclick: () => doEdit(o) }),
            H('button', { title: 'Xóa ngày này', text: '×', disabled: busy, onclick: () => doDelete(o.key, [o], `ngày ${U.viDate(o.date)} (${U.fmtH(o.hours)}h)`) }),
          ])))));
    });
  }

  async function calOp(fn, okMsg) {
    busy = true;
    renderRows();
    renderCal();
    try {
      const res = await fn((s) => calMsg(esc(s) + '…'));
      calMsg(`<span class="ok">✔</span> ${esc(okMsg(res))}`);
    } catch (e) {
      calMsg(`<span class="err">Lỗi:</span> ${esc(e.message)}`);
    }
    busy = false;
    renderRows();
    await renderCal();
    scheduleValidate(0);
  }

  function doDelete(key, items, what) {
    if (!sess || !items.length) return;
    if (!window.confirm(`Xóa ${what} của ${key}?\n\nStart/Due/Estimate của task sẽ được cập nhật lại.` +
      `\nNếu task không còn worklog nào, task sẽ chuyển Cancelled.` +
      `\n(Task đã Closed sẽ được mở lại rồi Close lại.)`)) return;
    calOp((step) => T.deleteWorklogs(sess, key, items.map((o) => o.id), step),
      (r) => (r && r.cancelled ? `Đã xóa ${what}; ${key} không còn worklog nên đã chuyển Cancelled`
        : `Đã xóa ${what}; ${key} giờ: ${U.viDate(r.start)} → ${U.viDate(r.end)}, Estimate ${r.estimate}`));
  }

  function doEdit(o) {
    const v = window.prompt(`Số giờ cho ${o.key} ngày ${U.viFull(o.date)} (hiện ${U.fmtH(o.hours)}h):`, U.fmtH(o.hours));
    if (v === null) return;
    const h = parseFloat(String(v).replace(',', '.'));
    if (!(h > 0 && h <= T.DAILY_LIMIT)) { calMsg('<span class="err">Số giờ phải trong khoảng 0.5–8</span>'); return; }
    if (h === o.hours) return;
    calOp((step) => T.editWorklogHours(sess, o, h, step),
      (r) => `Đã sửa ${o.key} ngày ${U.viDate(o.date)} thành ${U.fmtH(h)}h; Estimate ${r.estimate}`);
  }

  $('.prev').addEventListener('click', () => { calM -= 1; if (calM < 1) { calM = 12; calY -= 1; } renderCal(); });
  $('.next').addEventListener('click', () => { calM += 1; if (calM > 12) { calM = 1; calY += 1; } renderCal(); });
  $('.clear-sel').addEventListener('click', () => { sel.clear(); renderCal(); updateButtons(); });
  $('.mark-leave').addEventListener('click', () => {
    const unmark = [...sel].every((d) => sess.leave.has(d));
    sel.forEach((d) => (unmark ? sess.leave.delete(d) : sess.leave.add(d)));
    saveLeave();
    calMsg(`${unmark ? 'Đã bỏ đánh dấu nghỉ' : 'Đã đánh dấu nghỉ'}: ${[...sel].sort().map(U.viDate).join(', ')}`);
    sel.clear();
    rows.forEach((r) => { if (r.status !== 'done') r.status = 'new'; });
    refreshStatuses();
    renderCal();
    updateButtons();
    scheduleValidate(0);
  });
  $('.add-sel').addEventListener('click', async () => {
    const days = [...sel].filter((d) => !sess.leave.has(d)).sort();
    const start = days[0];
    const end = days[days.length - 1];
    const skip = U.workDays(start, end, new Set()).filter((d) => !sel.has(d));
    const planned = plannedByDay();
    let hours = 8;
    for (const d of days) hours = Math.min(hours, T.DAILY_LIMIT - (await sess.hoursOn(d)) - (planned[d] || 0));
    if (!(hours > 0)) hours = 8;
    sel.clear();
    switchTab('draft');
    await addRow({ start, end, skip, hours: Math.max(0.5, Math.floor(hours * 2) / 2) });
  });

  // ---------- Tab, mở/đóng, làm mới ----------
  function switchTab(name) {
    root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $('.draft').hidden = name !== 'draft';
    $('.cal').hidden = name !== 'cal';
    if (name === 'cal') ensureInit().then(renderCal).catch(() => {});
  }
  root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('.refresh').addEventListener('click', async () => {
    if (!sess) return ensureInit();
    sess.invalidate();
    rows.forEach((r) => { if (r.status !== 'done') r.status = 'new'; });
    refreshStatuses();
    scheduleValidate(0);
    if (!$('.cal').hidden) renderCal();
  });

  function toggle(force) {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    if (!panel.hidden) ensureInit().catch(() => {});
  }

  if (isExt) {
    const a = $('.tpl');
    a.href = chrome.runtime.getURL('template.xlsx');
    a.hidden = false;
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'toggle') toggle(); });
  }

  // ---------- Kéo thả bảng ----------
  const header = $('header');
  const MARGIN = 8;
  function placeAt(left, top) {
    const r = panel.getBoundingClientRect();
    const maxL = Math.max(MARGIN, window.innerWidth - r.width - MARGIN);
    const maxT = Math.max(MARGIN, window.innerHeight - header.offsetHeight - MARGIN);
    panel.style.left = Math.min(Math.max(MARGIN, left), maxL) + 'px';
    panel.style.top = Math.min(Math.max(MARGIN, top), maxT) + 'px';
    panel.classList.add('moved');
  }
  function center() { panel.classList.remove('moved'); panel.style.left = ''; panel.style.top = ''; }
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.x')) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    header.setPointerCapture(e.pointerId);
    const move = (ev) => placeAt(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      header.removeEventListener('pointercancel', up);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
    header.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  header.addEventListener('dblclick', (e) => { if (!e.target.closest('.x')) center(); });
  window.addEventListener('resize', () => {
    if (!panel.hidden && panel.classList.contains('moved')) { const r = panel.getBoundingClientRect(); placeAt(r.left, r.top); }
  });

  $('.fab').addEventListener('click', () => toggle());
  $('.x').addEventListener('click', () => toggle(false));
})();
