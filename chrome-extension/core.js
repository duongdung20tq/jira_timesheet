/* FIS Jira timesheet – logic. Chạy trong trang jira.fis.com.vn (same-origin, dùng phiên đăng nhập hiện tại). */
(function (global) {
  'use strict';

  const CF = { START: 'customfield_10103', EST: 'customfield_10306', ASD: 'customfield_10500', AED: 'customfield_10129' };
  const TYPES = ['Create', 'Correct', 'Study', 'Review', 'Test'];
  const DAILY_LIMIT = 8;
  const DAY = 86400000;
  const VN = 7 * 3600 * 1000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- HTTP ----------
  async function http(method, path, opts = {}) {
    let url = '/rest/' + path;
    if (opts.params) url += '?' + new URLSearchParams(opts.params).toString();
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        // charset=utf-8 bắt buộc: plugin FIS decode query string theo charset này
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    if (res.status === 401) throw new Error('Chưa đăng nhập Jira');
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = [...(j.errorMessages || []), ...Object.entries(j.errors || {}).map(([k, v]) => `${k}: ${v}`)].join('; ') || text;
      } catch (_) { msg = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }
      throw new Error(`HTTP ${res.status} ${method} ${path.split('?')[0]}: ${msg.slice(0, 300)}`);
    }
    try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
  }
  const api = (m, p, o) => http(m, 'api/2/' + p, o);

  // ---------- Ngày: chuỗi ISO 'YYYY-MM-DD' ----------
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const dOf = (iso) => new Date(iso + 'T00:00:00Z');
  const addDays = (iso, n) => isoOf(new Date(dOf(iso).getTime() + n * DAY));
  const weekday = (iso) => dOf(iso).getUTCDay(); // 0 = CN
  const isWorkday = (iso) => { const w = weekday(iso); return w >= 1 && w <= 5; };
  const todayIso = () => isoOf(new Date(Date.now() + VN));
  const viDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const viFull = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const wdName = (iso) => WD[weekday(iso)];
  const fromJiraDay = (s) => { const [d, m, y] = s.split('/'); return `${y}-${pad(MON.indexOf(m) + 1)}-${pad(+d)}`; };
  const toMs = (iso) => dOf(iso).getTime() - VN; // 00:00 giờ VN
  const fromMs = (ms) => isoOf(new Date(ms + VN));
  const fmtH = (h) => String(Number.isInteger(+h) ? +h : +(+h).toFixed(2));
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const norm = (s) => str(s).replace(/\s+/g, ' ').toLowerCase();

  function mkIso(y, m, d, src) {
    const r = new Date(Date.UTC(y, m - 1, d));
    if (r.getUTCFullYear() !== y || r.getUTCMonth() !== m - 1 || r.getUTCDate() !== d) throw new Error(`Ngày không tồn tại: "${src}"`);
    return isoOf(r);
  }

  /** Excel serial / Date / 'yyyy-mm-dd' / 'dd/mm/yyyy' / 'dd/mm' (năm = defYear) -> ISO */
  function parseDateAny(v, defYear) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return isoOf(new Date((Math.floor(v) - 25569) * DAY));
    if (v instanceof Date) return mkIso(v.getFullYear(), v.getMonth() + 1, v.getDate(), v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return mkIso(+m[1], +m[2], +m[3], s);
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (m && (m[3] || defYear)) return mkIso(+(m[3] || defYear), +m[2], +m[1], s);
    throw new Error(`Ngày không hợp lệ: "${s}" (dùng dd/mm/yyyy)`);
  }

  function parseSkipAny(v, defYear) {
    if (v === null || v === undefined || v === '') return [];
    const parts = typeof v === 'number' ? [v] : String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    return [...new Set(parts.map((p) => parseDateAny(p, defYear)))].sort();
  }

  function workDays(start, end, skip) {
    const out = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkday(d) && !skip.has(d)) out.push(d);
    return out;
  }

  function runs(days) { // gom ngày liên tiếp (theo lịch) để log 1 lần
    const r = [];
    for (const d of days) {
      const last = r[r.length - 1];
      if (last && addDays(last[1], 1) === d) last[1] = d;
      else r.push([d, d]);
    }
    return r;
  }

  const autoEstimate = (days, hours) => (hours === 8 ? `${days.length}d` : `${fmtH(hours * days.length)}h`);

  function resolveComponent(comps, q) {
    q = str(q);
    if (!q) throw new Error('Chọn component');
    let hits = comps.filter((c) => c.id === q || c.name === q);
    if (!hits.length) {
      const l = q.toLowerCase();
      hits = comps.filter((c) => c.name.toLowerCase().startsWith(l));
      if (!hits.length) hits = comps.filter((c) => c.name.toLowerCase().includes(l));
    }
    if (hits.length !== 1) throw new Error(`Component "${q}" khớp ${hits.length} giá trị — chọn lại`);
    return hits[0];
  }

  // ---------- Đọc file Excel/CSV -> dòng thô ----------
  function readWorkbook(buf, name) {
    if (typeof XLSX === 'undefined') throw new Error('Thiếu thư viện XLSX');
    const isCsv = /\.csv$/i.test(name);
    const wb = isCsv
      ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true })
      : XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets.Timesheet || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const hi = rows.slice(0, 20).findIndex((r) => r.map((c) => str(c).toLowerCase()).includes('summary'));
    if (hi < 0) throw new Error('Không thấy dòng tiêu đề có cột "summary"');
    const header = rows[hi].map((c) => str(c).toLowerCase());
    const out = [];
    rows.slice(hi + 1).forEach((r, i) => {
      const o = { _row: hi + 2 + i };
      header.forEach((h, j) => { if (h) o[h] = r[j] === undefined ? '' : r[j]; });
      if (str(o.summary) && !str(o.project).startsWith('#')) out.push(o);
    });
    return out;
  }

  /** Promise cache: lưu kết quả vào p._v; lỗi thì xóa khỏi cache để lần sau thử lại */
  function cached(store, key, p) {
    p.then((v) => { p._v = v; }, () => { if (store[key] === p) delete store[key]; });
    return p;
  }

  // ---------- Phiên làm việc: cache dữ liệu Jira + giá trị mặc định ----------
  class Session {
    constructor() {
      this.user = null;
      this.displayName = '';
      this.projects = [];
      this.recent = [];
      this.lastComp = {};
      this.defaults = { project: '', type: 'Create', phase: 'Coding' };
      this.metaC = {};
      this.phaseC = {};
      this.monthC = {};
      this.dupC = {};
      this.leave = new Set(); // ngày nghỉ người dùng tự đánh dấu (ISO)
    }

    async init() {
      const me = await api('GET', 'myself');
      this.user = me.name;
      this.displayName = me.displayName;
      const [projects, recent] = await Promise.all([
        api('GET', 'project'),
        api('GET', 'search', { params: { jql: 'reporter = currentUser() AND issuetype = Task ORDER BY created DESC', fields: 'summary,project,components', maxResults: 100 } }),
      ]);
      this.recent = recent.issues.map((i) => ({
        key: i.key, summary: i.fields.summary, project: i.fields.project.key, comp: (i.fields.components || [])[0] || null,
      }));
      const order = [];
      this.recent.forEach((r) => { if (!order.includes(r.project)) order.push(r.project); });
      const rank = (k) => (order.includes(k) ? order.indexOf(k) : 999);
      this.projects = projects.map((p) => ({ key: p.key, name: p.name, id: p.id })).sort((a, b) => rank(a.key) - rank(b.key));
      this.recent.forEach((r) => { if (r.comp && !this.lastComp[r.project]) this.lastComp[r.project] = r.comp; });
      this.defaults.project = order[0] || (this.projects[0] || {}).key || '';

      const t = todayIso();
      const y = +t.slice(0, 4), m = +t.slice(5, 7);
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      const logs = [...(await this.monthItems(y, m)), ...(await this.monthItems(py, pm))];
      const mode = (arr) => {
        const c = {};
        arr.filter(Boolean).forEach((x) => { c[x] = (c[x] || 0) + 1; });
        return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [])[0];
      };
      this.defaults.type = mode(logs.map((o) => o.type)) || 'Create';
      this.defaults.phase = mode(logs.map((o) => o.phase)) || 'Coding';
      return this;
    }

    async meta(project) {
      if (!this.metaC[project]) {
        this.metaC[project] = cached(this.metaC, project, (async () => {
          const d = await api('GET', 'issue/createmeta', {
            params: { projectKeys: project, issuetypeNames: 'Task', expand: 'projects.issuetypes.fields' },
          });
          const p = d.projects && d.projects[0];
          if (!p || !p.issuetypes.length) throw new Error(`Không có quyền tạo Task trong dự án ${project}`);
          return { id: p.id, comps: p.issuetypes[0].fields.components.allowedValues.map((c) => ({ id: c.id, name: c.name })) };
        })());
      }
      return this.metaC[project];
    }

    async phases(pid) {
      pid = String(pid);
      if (!this.phaseC[pid]) this.phaseC[pid] = cached(this.phaseC, pid, http('GET', `fis-project-detail/1.0/phaseWorklogByCate/${pid}`));
      return this.phaseC[pid];
    }

    /** Giá trị đã tải xong (đồng bộ, cho phần hiển thị) */
    metaNow(project) { return (this.metaC[project] || {})._v || null; }
    phasesNow(project) { const m = this.metaNow(project); return (m && (this.phaseC[String(m.id)] || {})._v) || []; }

    /** Worklog của mình trong tháng (mọi dự án), đã chuẩn hóa */
    async monthItems(y, m) {
      const k = `${y}-${m}`;
      if (!this.monthC[k]) {
        this.monthC[k] = (async () => {
          const d = await http('GET', `fis-worklog/1.0/gantt/userWorkLog/month/${encodeURIComponent(this.user)}/All/${m}/${y}/All/All/All/0/All/All/All/true/All`);
          const out = [];
          for (const x of d || []) for (const v of x.values || []) for (const o of v.dataObj || []) {
            out.push({
              id: o.id, key: o.issueKey, summary: str(x.desc), projectId: String(o.projectId), date: fromJiraDay(o.loggedDate),
              hours: parseFloat(o.hours), type: o.type, phase: o.phase, status: o.status, desc: o.desc, ot: !!o.ot, xjob: !!o.xjob,
            });
          }
          return out;
        })();
        this.monthC[k].catch(() => { delete this.monthC[k]; });
      }
      return this.monthC[k];
    }

    async hoursOn(iso) { // giờ đã khai trong ngày (trừ Rejected)
      const items = await this.monthItems(+iso.slice(0, 4), +iso.slice(5, 7));
      return items.filter((o) => o.date === iso && o.status !== 'Rejected').reduce((s, o) => s + o.hours, 0);
    }

    async dup(project, summary, start, fresh) {
      const k = `${project}|${start}`;
      if (fresh || !this.dupC[k]) {
        const jql = `project = "${project}" AND reporter = currentUser() AND issuetype = Task AND "Start Date" = "${start}"`;
        this.dupC[k] = api('GET', 'search', { params: { jql, fields: 'summary', maxResults: 200 } }).then((d) => d.issues);
        this.dupC[k].catch(() => { delete this.dupC[k]; });
      }
      const hit = (await this.dupC[k]).find((i) => norm(i.fields.summary) === norm(summary));
      return hit ? hit.key : null;
    }

    invalidate() { this.monthC = {}; this.dupC = {}; }

    /** Task cũ có cùng tiêu đề (để tự điền dự án + component) */
    suggestion(summary) {
      const n = norm(summary);
      return n ? this.recent.find((r) => norm(r.summary) === n) || null : null;
    }

    componentFor(project, summary) {
      const s = this.recent.find((r) => r.project === project && r.comp && norm(r.summary) === norm(summary));
      return (s && s.comp) || this.lastComp[project] || null;
    }
  }

  // ---------- Dòng nháp ----------
  let uidSeq = 0;
  function newRow(sess, init = {}) {
    const project = init.project || sess.defaults.project;
    const comp = sess.componentFor(project, init.summary || '');
    return Object.assign({
      uid: ++uidSeq, project, summary: '', componentId: comp ? comp.id : '', componentText: '', compAuto: true,
      start: '', end: '', skip: [], hours: 8, type: sess.defaults.type, phase: sess.defaults.phase,
      description: '', estimate: '', nDays: 0, status: 'new', errors: [], warnings: [], days: [],
    }, init);
  }

  /** Cửa sổ tự xếp ngày: tuần này nếu hôm nay là T6–CN, ngược lại tuần trước đến hôm nay */
  function allocWindow() {
    const t = todayIso();
    const w = weekday(t);
    const monday = addDays(t, -((w + 6) % 7));
    return { from: w >= 5 || w === 0 ? monday : addDays(monday, -7), to: t };
  }

  const rowDays = (r, leave) => (r.start
    ? workDays(r.start, r.end || r.start, new Set(r.skip)).filter((d) => !(leave && leave.has(d))) : []);

  /** Gán ngày cho các dòng chưa có ngày: lấy ngày còn trống (chưa đủ 8h, không phải ngày nghỉ) sớm nhất trong cửa sổ */
  async function allocateDates(sess, rows) {
    const { from, to } = allocWindow();
    const cap = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (isWorkday(d) && !sess.leave.has(d)) cap[d] = DAILY_LIMIT - (await sess.hoursOn(d));
    }
    rows.filter((r) => r.start && r.status !== 'done' && r.status !== 'skip')
      .forEach((r) => rowDays(r, sess.leave).forEach((d) => { if (d in cap) cap[d] -= r.hours; }));
    for (const r of rows) {
      if (r.start) continue;
      const need = Math.max(1, Math.round(r.nDays) || 1);
      const picked = Object.keys(cap).sort().filter((d) => cap[d] >= r.hours).slice(0, need);
      if (!picked.length) { r.autoError = `Không còn ngày trống từ ${viDate(from)} đến ${viDate(to)} — chọn ngày`; continue; }
      picked.forEach((d) => { cap[d] -= r.hours; });
      r.start = picked[0];
      r.end = picked[picked.length - 1];
      r.skip = workDays(r.start, r.end, new Set()).filter((d) => !picked.includes(d));
      r.autoDated = true;
      r.autoError = picked.length < need ? `Chỉ còn ${picked.length}/${need} ngày trống — chọn thêm ngày` : null;
    }
  }

  /** Dòng thô từ Excel -> dòng nháp (điền mặc định từ Jira cho ô trống) */
  async function rowsFromWorkbook(sess, buf, name, existing = []) {
    const raws = readWorkbook(buf, name);
    const rows = [];
    for (const x of raws) {
      const r = newRow(sess, { project: str(x.project) || sess.defaults.project, summary: str(x.summary), excelRow: x._row });
      const errs = [];
      const ctext = str(x.component);
      if (ctext) {
        try { r.componentId = resolveComponent((await sess.meta(r.project)).comps, ctext).id; r.compAuto = false; }
        catch (e) { r.componentId = ''; r.componentText = ctext; errs.push(e.message); }
      } else {
        const c = sess.componentFor(r.project, r.summary);
        r.componentId = c ? c.id : '';
      }
      try {
        r.start = parseDateAny(x.start);
        r.end = parseDateAny(x.end);
        r.skip = parseSkipAny(x.skip, (r.start || todayIso()).slice(0, 4));
      } catch (e) { errs.push(e.message); }
      if (str(x.hours)) r.hours = Number(x.hours);
      if (str(x.type)) { const t = str(x.type); r.type = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }
      if (str(x.phase)) r.phase = str(x.phase);
      r.description = str(x.description);
      r.estimate = str(x.estimate);
      r.nDays = Number(x.days) || 0;
      r.importError = errs.join('; ') || null;
      rows.push(r);
    }
    await allocateDates(sess, [...existing, ...rows]);
    return rows;
  }

  // ---------- Kiểm tra ----------
  async function validateRow(sess, r, planned, seen) {
    r.errors = []; r.warnings = []; r.duplicate = null; r.days = []; r.incomplete = false;
    if (r.importError) r.errors.push(r.importError);
    if (r.autoError) r.errors.push(r.autoError);
    if (r.autoDated) r.warnings.push('Ngày được tự xếp vào ngày còn trống — đổi lại nếu là ngày nghỉ');
    if (!str(r.summary)) { r.incomplete = true; return; }
    if (!r.project) throw new Error('Chọn dự án');
    const m = await sess.meta(r.project);
    r.pid = m.id;
    r.comp = m.comps.find((c) => c.id === r.componentId) || null;
    if (!r.comp) throw new Error(r.componentText ? `Component "${r.componentText}" không hợp lệ — chọn lại` : 'Chọn component');
    r.phaseObj = (await sess.phases(m.id)).find((p) => norm(p.phaseValue) === norm(r.phase)) || null;
    if (!r.phaseObj) throw new Error(`Phase "${r.phase}" không có trong dự án`);
    if (!TYPES.includes(r.type)) throw new Error('Type of Work không hợp lệ');
    if (!(r.hours > 0 && r.hours <= DAILY_LIMIT)) throw new Error(`Giờ/ngày phải trong khoảng 0.5–${DAILY_LIMIT}`);
    if (!r.start) { if (!r.autoError) r.errors.push('Chọn ngày bắt đầu'); return; }
    const end = r.end || r.start;
    if (end < r.start) throw new Error('Ngày kết thúc trước ngày bắt đầu');
    const all = workDays(r.start, end, new Set(r.skip));
    r.days = all.filter((d) => !sess.leave.has(d));
    if (r.days.length < all.length) {
      r.warnings.push(`Bỏ qua ngày nghỉ đã đánh dấu: ${all.filter((d) => sess.leave.has(d)).map(viDate).join(', ')}`);
    }
    if (!r.days.length) throw new Error('Không có ngày làm việc (T2–T6) nào trong khoảng');
    const t = todayIso();
    if (end > t) r.errors.push('Không khai được ngày trong tương lai');
    if (r.start.slice(0, 7) < t.slice(0, 7)) r.warnings.push('Khai cho tháng trước có thể bị Jira chặn');
    r.estimateCalc = str(r.estimate) || autoEstimate(r.days, r.hours);
    r.desc = (str(r.description) || str(r.summary)).slice(0, 250);
    const sig = `${r.project}|${norm(r.summary)}|${r.start}`;
    if (seen.has(sig)) throw new Error('Trùng với một dòng phía trên');
    seen.add(sig);
    r.duplicate = await sess.dup(r.project, r.summary, r.start);
    if (r.duplicate || r.errors.length) return;
    for (const d of r.days) {
      const used = await sess.hoursOn(d);
      const p = planned[d] || 0;
      if (used + p + r.hours > DAILY_LIMIT) r.errors.push(`${viDate(d)}: đã có ${fmtH(used + p)}h, thêm ${fmtH(r.hours)}h sẽ vượt ${DAILY_LIMIT}h`);
    }
  }

  async function validate(sess, rows) {
    const planned = {};
    const seen = new Set();
    for (const r of rows) {
      if (r.status === 'done') continue;
      try { await validateRow(sess, r, planned, seen); } catch (e) { r.errors.push(e.message); }
      r.status = r.incomplete ? 'draft' : r.duplicate ? 'skip' : r.errors.length ? 'error' : 'ok';
      if (r.status === 'ok') r.days.forEach((d) => { planned[d] = (planned[d] || 0) + r.hours; });
    }
    return rows;
  }

  // ---------- Khai 1 dòng ----------
  async function transition(key, target) {
    const ts = (await api('GET', `issue/${key}/transitions`, { params: { expand: 'transitions.fields' } })).transitions;
    const tl = target.toLowerCase();
    const t = ts.find((x) => x.name.toLowerCase() === tl || x.to.name.toLowerCase() === tl);
    if (!t) throw new Error(`${key}: không có transition "${target}" (có: ${ts.map((x) => x.name).join(', ')})`);
    await api('POST', `issue/${key}/transitions`, { body: { transition: { id: t.id } } });
  }

  async function execute(sess, r, closeTask, onStep) {
    const step = onStep || (() => {});
    const dup = await sess.dup(r.project, r.summary, r.start, true);
    if (dup) { r.status = 'skip'; r.duplicate = dup; return r; }
    const fields = {
      project: { key: r.project },
      issuetype: { name: 'Task' },
      summary: str(r.summary),
      description: r.desc,
      components: [{ id: r.comp.id }],
      assignee: { name: sess.user },
      [CF.START]: r.start,
      duedate: r.end || r.start,
      [CF.EST]: r.estimateCalc,
    };
    r.key = (await api('POST', 'issue', { body: { fields } })).key;
    sess.invalidate();
    step(`Tạo ${r.key}`);
    await transition(r.key, 'In Progress');
    step('In Progress');
    for (const [a, b] of runs(r.days)) {
      const ok = await http('GET', 'fis-worklog/1.0/createWorkLog', {
        params: {
          issueKey: r.key, issueName: str(r.summary), userKey: sess.user, userName: sess.user,
          period: 'true', startDate: toMs(a), endDate: toMs(b), workPerDay: fmtH(r.hours),
          typeOfWork: r.type, desc: r.desc, ot: 'false', xjob: 'false', type: 'ganttIssue', phaseWorklog: r.phaseObj.id,
        },
      });
      if (ok !== true) throw new Error(`Log work ${viDate(a)}–${viDate(b)} thất bại: ${JSON.stringify(ok)}`);
      step(`Log work ${viDate(a)}–${viDate(b)}`);
    }
    if (closeTask) {
      await transition(r.key, 'Completed');
      await transition(r.key, 'Closed');
    }
    const f = (await api('GET', `issue/${r.key}`, { params: { fields: `status,${CF.ASD},${CF.AED}` } })).fields;
    r.result = `${f.status.name} · Actual ${f[CF.ASD] ? viDate(f[CF.ASD]) : '?'} → ${f[CF.AED] ? viDate(f[CF.AED]) : '?'}`;
    r.status = 'done';
    sess.invalidate();
    return r;
  }

  // ---------- Sửa / xóa worklog đã khai ----------
  async function taskWorklogs(sess, key) {
    const list = await http('GET', `fis-worklog/1.0/issue/${encodeURIComponent(sess.user)}/${encodeURIComponent(key)}`);
    return (list || []).map((o) => ({
      id: o.id, key: o.issueKey, date: fromMs(o.startDate), hours: parseFloat(o.workPerDay), status: o.status,
    }));
  }

  const issueStatus = async (key) => (await api('GET', `issue/${key}`, { params: { fields: 'status' } })).fields.status.name;

  /** Plugin chỉ cho sửa/xóa khi task không ở Open/Closed/Cancelled: mở lại -> làm -> đóng lại */
  async function withEditable(key, fn, step = () => {}) {
    const st = await issueStatus(key);
    if (st === 'Cancelled') throw new Error(`${key} đã Cancelled`);
    if (st === 'Closed') { await transition(key, 'Re-open'); step(`Mở lại ${key}`); }
    if (st === 'Closed' || st === 'Open') await transition(key, 'In Progress');
    const reclose = async () => {
      if (st === 'Closed') { await transition(key, 'Completed'); await transition(key, 'Closed'); step(`Close lại ${key}`); }
    };
    let res;
    try {
      res = await fn();
    } catch (e) {
      try { await reclose(); } catch (_) { /* giữ lỗi gốc */ }
      throw e;
    }
    if (!(res && res.cancelled)) await reclose();
    return res;
  }

  /** Cập nhật Start/Due/Estimate theo các worklog còn lại của task */
  async function syncTask(sess, key) {
    const wl = (await taskWorklogs(sess, key)).filter((w) => w.status !== 'Rejected');
    if (!wl.length) return { empty: true };
    const dates = [...new Set(wl.map((w) => w.date))].sort();
    const est = wl.every((w) => w.hours === 8) ? `${dates.length}d` : `${fmtH(wl.reduce((s, w) => s + w.hours, 0))}h`;
    await api('PUT', `issue/${key}`, { body: { fields: { [CF.START]: dates[0], duedate: dates[dates.length - 1], [CF.EST]: est } } });
    return { start: dates[0], end: dates[dates.length - 1], estimate: est };
  }

  async function deleteWorklogs(sess, key, ids, step) {
    try {
      return await withEditable(key, async () => {
        for (const id of ids) {
          const ok = await http('DELETE', `fis-worklog/1.0/deleteWorkLog/${id}`);
          if (ok !== true) throw new Error(`Xóa worklog ${id} thất bại: ${JSON.stringify(ok)}`);
        }
        const s = await syncTask(sess, key);
        if (s.empty) { await transition(key, 'Cancel'); return { cancelled: true }; }
        return s;
      }, step);
    } finally {
      sess.invalidate();
    }
  }

  async function editWorklogHours(sess, w, hours, step) {
    if (!(hours > 0 && hours <= DAILY_LIMIT)) throw new Error(`Số giờ phải trong khoảng 0.5–${DAILY_LIMIT}`);
    const used = await sess.hoursOn(w.date);
    if (used - w.hours + hours > DAILY_LIMIT) throw new Error(`${viDate(w.date)}: tổng sẽ là ${fmtH(used - w.hours + hours)}h, vượt ${DAILY_LIMIT}h`);
    const ph = (await sess.phases(w.projectId)).find((p) => p.phaseValue === w.phase);
    if (!ph) throw new Error(`Không tìm thấy phase "${w.phase}"`);
    try {
      return await withEditable(w.key, async () => {
        await http('GET', 'fis-worklog/1.0/editWorkLog', {
          params: {
            idWorkLog: w.id, startDate: toMs(w.date), workPerDay: fmtH(hours), typeOfWork: w.type,
            ot: String(w.ot), xjob: String(w.xjob), desc: str(w.desc) || 'null', phaseWorklog: ph.id,
          },
        });
        const after = (await taskWorklogs(sess, w.key)).find((x) => x.id === w.id);
        if (!after || after.hours !== hours) throw new Error('Jira không nhận thay đổi số giờ');
        return syncTask(sess, w.key);
      }, step);
    } finally {
      sess.invalidate();
    }
  }

  global.FisTimesheet = {
    TYPES, DAILY_LIMIT, Session, newRow, rowsFromWorkbook, allocateDates, validate, execute,
    deleteWorklogs, editWorklogHours, resolveComponent,
    util: { parseDateAny, parseSkipAny, workDays, rowDays, addDays, weekday, isWorkday, todayIso, viDate, viFull, wdName, fmtH, str, norm },
  };
})(typeof window !== 'undefined' ? window : globalThis);
