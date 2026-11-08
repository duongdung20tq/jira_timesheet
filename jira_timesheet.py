#!/usr/bin/env python3
"""Khai timesheet trên Jira FIS (Jira Server 6.4 + plugin com.fpt.jira.tempo-plugin).

Quy trình (giống thao tác tay trên UI):
  1. Tạo Task (assignee = mình): Summary, Component, Start Date, Due Date, Original Estimate
  2. Transition -> In Progress   (plugin không cho log work khi Open/Closed/Cancelled)
  3. Log work qua /rest/fis-worklog/1.0/createWorkLog (8h/ngày, Create, Coding...)
     -> plugin tự cập nhật Actual Start Date theo ngày worklog
  4. Transition -> Completed -> Closed  (Actual End Date được gán khi Close)
  Worklog ở trạng thái Pending, chờ PM duyệt.

Ví dụ:
  python jira_timesheet.py components BTC_CSDL2_S7_2025
  python jira_timesheet.py log -p BTC_CSDL2_S7_2025 -c 37.3.1 -s "Fix lỗi..." --start 2026-11-05 --end 2026-11-06 --dry-run
  python jira_timesheet.py batch timesheet.csv --dry-run
  python jira_timesheet.py worklogs 2026-11
"""
from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# --- Cấu hình Jira FIS ---------------------------------------------------------
CF_START_DATE = "customfield_10103"         # Start Date (bắt buộc khi tạo)
CF_ORIGINAL_ESTIMATE = "customfield_10306"  # Original Estimate (text: "2d", "16h")
CF_ACTUAL_START = "customfield_10500"       # Actual Start Date (plugin tự gán)
CF_ACTUAL_END = "customfield_10129"         # Actual End Date (gán khi Close)

TZ_VN = dt.timezone(dt.timedelta(hours=7))
DAILY_LIMIT = 8.0
TYPES_OF_WORK = ("Create", "Correct", "Study", "Review", "Test")


# --- Config / HTTP ------------------------------------------------------------
def load_env(path: Path = Path(__file__).with_name(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


class Jira:
    def __init__(self, url: str, user: str, password: str):
        self.url = url.rstrip("/")
        self.user = user
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        # charset=utf-8 bắt buộc: server decode query string theo charset của Content-Type
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        }

    def call(self, method: str, path: str, body: dict | None = None, params: dict | None = None):
        url = f"{self.url}/rest/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(r, timeout=90) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:1000]
            raise SystemExit(f"[HTTP {e.code}] {method} {path}\n{msg}") from None

    def api(self, method: str, path: str, body: dict | None = None, params: dict | None = None):
        return self.call(method, f"api/2/{path}", body, params)

    def create_meta(self, project: str) -> dict:
        d = self.api("GET", "issue/createmeta", params={
            "projectKeys": project, "issuetypeNames": "Task",
            "expand": "projects.issuetypes.fields"})
        if not d.get("projects") or not d["projects"][0]["issuetypes"]:
            raise SystemExit(f"Không có quyền tạo Task trong dự án {project}")
        p = d["projects"][0]
        return {"project_id": p["id"], "fields": p["issuetypes"][0]["fields"]}

    def search(self, jql: str, fields: str = "summary", limit: int = 50) -> list[dict]:
        return self.api("GET", "search", params={"jql": jql, "fields": fields, "maxResults": limit})["issues"]

    # --- plugin FIS worklog ---
    def phases(self, project_id: str) -> list[dict]:
        return self.call("GET", f"fis-project-detail/1.0/phaseWorklogByCate/{project_id}")

    def month_worklogs(self, year: int, month: int, project_id: str = "All") -> list[dict]:
        d = self.call("GET", f"fis-worklog/1.0/gantt/userWorkLog/month/{self.user}/{project_id}/"
                             f"{month}/{year}/All/All/All/0/All/All/All/true/All")
        return [o for x in d for v in x.get("values", []) for o in v.get("dataObj", [])]


# --- Logic --------------------------------------------------------------------
def parse_date(s: str) -> dt.date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    raise SystemExit(f"Ngày không hợp lệ: {s} (dùng YYYY-MM-DD hoặc DD/MM/YYYY)")


def to_ms(d: dt.date) -> int:
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=TZ_VN).timestamp() * 1000)


def work_days(start: dt.date, end: dt.date, skip: set[dt.date]) -> list[dt.date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5 and d not in skip:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def contiguous_runs(days: list[dt.date]) -> list[tuple[dt.date, dt.date]]:
    """Gom ngày liên tiếp (bỏ qua cuối tuần) thành các đoạn để log bằng period."""
    runs: list[list[dt.date]] = []
    for d in days:
        if runs and (d - runs[-1][-1]).days == 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    return [(r[0], r[-1]) for r in runs]


def fmt_hours(h: float) -> str:
    return str(int(h)) if float(h).is_integer() else str(h)


def resolve_component(fields: dict, query: str) -> dict:
    comps = fields["components"]["allowedValues"]
    if query.isdigit() and len(query) > 4:
        hits = [c for c in comps if c["id"] == query]
    else:
        q = query.lower()
        hits = [c for c in comps if c["name"].lower().startswith(q)] or \
               [c for c in comps if q in c["name"].lower()]
    if len(hits) != 1:
        names = "\n  ".join(f"{c['id']} | {c['name'][:100]}" for c in (hits or comps))
        raise SystemExit(f"Component '{query}' khớp {len(hits)} giá trị:\n  {names}")
    return hits[0]


def resolve_phase(phases: list[dict], query: str) -> dict:
    hit = next((p for p in phases if p["phaseValue"].lower() == query.lower() or str(p["id"]) == query), None)
    if not hit:
        raise SystemExit(f"Phase '{query}' không có. Có: {[p['phaseValue'] for p in phases]}")
    return hit


def find_duplicate(jira: Jira, project: str, summary: str, start: dt.date) -> str | None:
    # Không dùng summary ~ "..." (ký tự [ ] ( ) làm JQL text search lỗi) -> so sánh phía client
    jql = (f'project = "{project}" AND reporter = currentUser() AND issuetype = Task '
           f'AND "Start Date" = "{start.isoformat()}"')
    norm = lambda s: " ".join(s.split()).lower()
    for i in jira.search(jql, limit=200):
        if norm(i["fields"]["summary"]) == norm(summary):
            return i["key"]
    return None


def transition(jira: Jira, key: str, target: str) -> None:
    ts = jira.api("GET", f"issue/{key}/transitions", params={"expand": "transitions.fields"})["transitions"]
    t = next((t for t in ts if target.lower() in (t["name"].lower(), t["to"]["name"].lower())), None)
    if not t:
        avail = ", ".join(f"{x['name']}->{x['to']['name']}" for x in ts)
        raise SystemExit(f"{key}: không thấy transition '{target}'. Có: {avail}")
    missing = [f"{fid} ({f.get('name')})" for fid, f in t.get("fields", {}).items()
               if f.get("required") and not f.get("hasDefaultValue")]
    if missing:
        raise SystemExit(f"{key}: transition '{target}' cần thêm field: {missing}")
    jira.api("POST", f"issue/{key}/transitions", {"transition": {"id": t["id"]}})
    print(f"  {key}: -> {t['to']['name']}")


def check_daily_limit(jira: Jira, days: list[dt.date], hours: float, planned: dict[str, float]) -> list[str]:
    """planned: giờ của các dòng phía trên trong cùng file (chưa có trên Jira khi dry-run)."""
    used: dict[str, float] = defaultdict(float)
    for y, m in sorted({(d.year, d.month) for d in days}):
        for o in jira.month_worklogs(y, m):
            if o.get("status") != "Rejected":
                used[o["loggedDate"]] += float(o["hours"])
    errs = []
    for d in days:
        k = d.strftime("%d/%b/%Y")
        have = used[k] + planned.get(k, 0)
        if have + hours > DAILY_LIMIT:
            errs.append(f"{d}: đã có {fmt_hours(have)}h + {fmt_hours(hours)}h > {fmt_hours(DAILY_LIMIT)}h")
    return errs


def create_worklogs(jira: Jira, key: str, summary: str, days: list[dt.date], hours: float,
                    type_of_work: str, phase_id: int, desc: str) -> None:
    for a, b in contiguous_runs(days):
        ok = jira.call("GET", "fis-worklog/1.0/createWorkLog", params={
            "issueKey": key, "issueName": summary, "userKey": jira.user, "userName": jira.user,
            "period": "true", "startDate": to_ms(a), "endDate": to_ms(b),
            "workPerDay": fmt_hours(hours), "typeOfWork": type_of_work, "desc": desc[:250],
            "ot": "false", "xjob": "false", "type": "ganttIssue", "phaseWorklog": phase_id})
        if ok is not True:
            raise SystemExit(f"{key}: createWorkLog {a}->{b} trả về {ok!r}")
        print(f"  {key}: log work {a} -> {b}, {fmt_hours(hours)}h/ngày")


def log_one(jira: Jira, row: dict, opts: argparse.Namespace, cache: dict) -> None:
    project = row["project"]
    meta = cache.get(project) or cache.setdefault(project, jira.create_meta(project))
    phases = cache.get(("phases", project)) or cache.setdefault(("phases", project), jira.phases(meta["project_id"]))

    summary = row["summary"].strip()
    start, end = parse_date(row["start"]), parse_date(row.get("end") or row["start"])
    skip = {parse_date(x) for x in (row.get("skip") or "").replace(";", ",").split(",") if x.strip()}
    hours = float(row.get("hours") or 8)
    type_of_work = (row.get("type") or "Create").capitalize()
    phase = resolve_phase(phases, row.get("phase") or "Coding")
    desc = (row.get("description") or summary).strip()
    comp = resolve_component(meta["fields"], row["component"])
    days = work_days(start, end, skip)
    estimate = row.get("estimate") or (f"{len(days)}d" if hours == 8 else f"{fmt_hours(hours * len(days))}h")

    print(f"\n[{project}] {summary}")
    print(f"  Component : {comp['name'][:100]}")
    print(f"  Ngày      : {start} -> {end} | ngày làm việc: {', '.join(d.strftime('%d/%m') for d in days)}")
    print(f"  Worklog   : {fmt_hours(hours)}h/ngày | {type_of_work} | {phase['phaseValue']} | Estimate {estimate}")

    dup = find_duplicate(jira, project, summary, start)
    if dup:
        print(f"  BỎ QUA: đã có {dup} cùng tiêu đề và Start Date -> {jira.url}/browse/{dup}")
        return

    today = dt.datetime.now(TZ_VN).date()
    problems = []
    if end < start:
        problems.append("Ngày kết thúc < ngày bắt đầu")
    if not days:
        problems.append("Không có ngày làm việc nào trong khoảng")
    if end > today:
        problems.append("Không log được ngày trong tương lai")
    if type_of_work not in TYPES_OF_WORK:
        problems.append(f"Type of Work phải thuộc {TYPES_OF_WORK}")
    if days and (start.year, start.month) < (today.year, today.month):
        print("  CẢNH BÁO: log tháng trước có thể bị chặn (back-date restrict)")
    planned = cache.setdefault("planned", {})
    problems += check_daily_limit(jira, days, hours, planned) if days and not opts.force else []
    if problems:
        print("  LỖI:\n   - " + "\n   - ".join(problems))
        return
    for d in days:
        k = d.strftime("%d/%b/%Y")
        planned[k] = planned.get(k, 0) + hours
    if opts.dry_run:
        print("  (dry-run) không tạo gì")
        return

    fields = {
        "project": {"key": project}, "issuetype": {"name": "Task"},
        "summary": summary, "description": desc,
        "components": [{"id": comp["id"]}], "assignee": {"name": jira.user},
        CF_START_DATE: start.isoformat(), "duedate": end.isoformat(), CF_ORIGINAL_ESTIMATE: estimate,
    }
    key = jira.api("POST", "issue", {"fields": fields})["key"]
    print(f"  Tạo: {key} -> {jira.url}/browse/{key}")
    transition(jira, key, "In Progress")
    create_worklogs(jira, key, summary, days, hours, type_of_work, phase["id"], desc)
    if not opts.no_close:
        transition(jira, key, "Completed")
        transition(jira, key, "Closed")
    f = jira.api("GET", f"issue/{key}", params={"fields": f"status,{CF_ACTUAL_START},{CF_ACTUAL_END}"})["fields"]
    print(f"  Kết quả: {f['status']['name']} | Actual {f[CF_ACTUAL_START]} -> {f[CF_ACTUAL_END]}")


COLUMNS = [  # (key, độ rộng, bắt buộc, ghi chú)
    ("project", 22, False, "Mã dự án (sheet 'Danh mục'). Extension: bỏ trống = dự án của task gần nhất"),
    ("summary", 60, True, "Tiêu đề task = nội dung công việc"),
    ("component", 14, False, "Mã component (vd 37.3.1) hoặc ID. Extension: bỏ trống = component của task gần nhất"),
    ("start", 13, False, "Ngày bắt đầu (dd/mm/yyyy). Extension: bỏ trống = tự xếp vào ngày còn trống trong tuần"),
    ("end", 13, False, "Ngày kết thúc (dd/mm/yyyy). Bỏ trống = bằng ngày bắt đầu"),
    ("hours", 8, False, "Số giờ mỗi ngày. Mặc định 8"),
    ("type", 10, False, "Type of Work: Create/Correct/Study/Review/Test. Mặc định Create"),
    ("phase", 18, False, "Phase. Mặc định Coding"),
    ("skip", 24, False, "Ngày nghỉ trong khoảng (lễ, phép), cách nhau dấu phẩy: 03/11/2026, 04/11/2026"),
    ("estimate", 10, False, "Original Estimate (vd 2d, 16h). Bỏ trống = tự tính theo số ngày"),
    ("description", 40, False, "Mô tả worklog (tối đa 250 ký tự). Bỏ trống = summary"),
    ("days", 8, False, "Extension: số ngày cần khai khi bỏ trống start (tự xếp vào ngày còn trống)"),
]


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def read_rows(path: str):
    """Đọc dòng timesheet từ .xlsx (sheet 'Timesheet') hoặc .csv (UTF-8)."""
    if path.lower().endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise SystemExit("Cần cài openpyxl: python -m pip install openpyxl") from None
        try:
            wb = load_workbook(path, data_only=True, read_only=True)
        except PermissionError:
            raise SystemExit(f"Không mở được {path} (đang mở trong Excel?)") from None
        ws = wb["Timesheet"] if "Timesheet" in wb.sheetnames else wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        hdr_idx = next((i for i, r in enumerate(rows[:20])
                        if {"project", "summary"} <= {_cell_text(c).lower() for c in r}), None)
        if hdr_idx is None:
            raise SystemExit(f"{path}: không thấy dòng tiêu đề có cột 'project' và 'summary'")
        header = [_cell_text(c).lower() for c in rows[hdr_idx]]
        for r in rows[hdr_idx + 1:]:
            yield {k: _cell_text(v) for k, v in zip(header, r) if k}
    else:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                yield {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}


def build_template(jira: Jira, out: str, projects: list[str]) -> None:
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.worksheet.datavalidation import DataValidation

    all_projects = jira.api("GET", "project")
    metas = {p: jira.create_meta(p) for p in projects}
    phases = [p["phaseValue"] for p in jira.phases(metas[projects[0]]["project_id"])]

    F = "Arial"
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    h_req = PatternFill("solid", fgColor="1F4E78")
    h_opt = PatternFill("solid", fgColor="5B8DB8")
    f_in = PatternFill("solid", fgColor="FFF9DB")
    f_ex = PatternFill("solid", fgColor="EDEDED")
    hdr_font = Font(name=F, bold=True, color="FFFFFF", size=10)
    body = Font(name=F, size=10)
    n_rows = 200

    wb = Workbook()
    ws = wb.active
    ws.title = "Timesheet"
    for c, (key, width, req, note) in enumerate(COLUMNS, 1):
        cell = ws.cell(row=1, column=c, value=key)
        cell.font, cell.fill, cell.border = hdr_font, (h_req if req else h_opt), border
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.comment = Comment(("BẮT BUỘC. " if req else "") + note, "jira_timesheet")
        ws.column_dimensions[cell.column_letter].width = width
    ws.row_dimensions[1].height = 22

    example = [projects[0], "Fix lỗi đánh giá bảo mật của bên thứ 3 cho dự án Cơ sở dữ liệu tổng hợp",
               "37.3.1", dt.date(2026, 11, 6), dt.date(2026, 11, 6), 8, "Create", "Coding", None, "1d", None, None]
    for r in range(2, n_rows + 2):
        for c, (key, *_rest) in enumerate(COLUMNS, 1):
            cell = ws.cell(row=r, column=c)
            cell.font, cell.border = body, border
            cell.fill = f_ex if r == 2 else f_in
            cell.alignment = Alignment(vertical="center", wrap_text=key in ("summary", "description"))
            if key in ("start", "end"):
                cell.number_format = "dd/mm/yyyy"
            elif key in ("component", "skip", "estimate"):
                cell.number_format = "@"  # giữ dạng chữ: 10.10 không bị đổi thành 10.1
    for c, v in enumerate(example, 1):
        ws.cell(row=2, column=c, value=v)
    ws.cell(row=2, column=1).comment = Comment(
        "Dòng mẫu (đã khai: BTC_CSDL2_S7_2025-5769). Chạy lại sẽ bị bỏ qua vì trùng. "
        "Có thể xóa dòng này.", "jira_timesheet")
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = f"A1:{ws.cell(row=1, column=len(COLUMNS)).column_letter}{n_rows + 1}"

    # Danh mục
    dm = wb.create_sheet("Danh mục")
    sections = [("A", "Dự án", ["key", "name"], [[p["key"], p["name"]] for p in all_projects]),
                ("D", "Type of Work", ["type"], [[t] for t in TYPES_OF_WORK]),
                ("F", "Phase", ["phase"], [[p] for p in phases]),
                ("H", "Component", ["project", "component", "id"],
                 [[p, c["name"], c["id"]] for p in projects for c in metas[p]["fields"]["components"]["allowedValues"]])]
    from openpyxl.utils import column_index_from_string, get_column_letter
    for col, title, heads, data in sections:
        c0 = column_index_from_string(col)
        dm.cell(row=1, column=c0, value=title).font = Font(name=F, bold=True, size=11, color="1F4E78")
        for j, h in enumerate(heads):
            cell = dm.cell(row=2, column=c0 + j, value=h)
            cell.font, cell.fill, cell.border = hdr_font, h_req, border
        for i, rowv in enumerate(data, 3):
            for j, v in enumerate(rowv):
                cell = dm.cell(row=i, column=c0 + j, value=v)
                cell.font, cell.border = body, border
        if col in ("A", "D", "F"):
            name = {"A": "ds_project", "D": "ds_type", "F": "ds_phase"}[col]
            ref = f"'Danh mục'!${col}$3:${col}${len(data) + 2}"
            wb.defined_names[name] = DefinedName(name, attr_text=ref)
    for col, w in {"A": 26, "B": 70, "D": 14, "F": 24, "H": 22, "I": 90, "J": 10}.items():
        dm.column_dimensions[col].width = w
    dm.freeze_panes = "A3"

    # Validation trên sheet Timesheet
    rng = lambda key: (lambda L: f"{L}2:{L}{n_rows + 1}")(get_column_letter([k for k, *_ in COLUMNS].index(key) + 1))
    for key, name in (("project", "ds_project"), ("type", "ds_type"), ("phase", "ds_phase")):
        dv = DataValidation(type="list", formula1=f"={name}", allow_blank=True, showErrorMessage=True,
                            errorTitle="Giá trị không hợp lệ", error="Chọn giá trị trong danh sách")
        dv.add(rng(key))
        ws.add_data_validation(dv)
    for key in ("start", "end"):
        dv = DataValidation(type="date", operator="greaterThan", formula1="DATE(2020,1,1)", allow_blank=True,
                            showErrorMessage=True, error="Nhập ngày dạng dd/mm/yyyy")
        dv.add(rng(key))
        ws.add_data_validation(dv)
    dv = DataValidation(type="decimal", operator="between", formula1="0.5", formula2="8", allow_blank=True,
                        showErrorMessage=True, error="Số giờ/ngày từ 0.5 đến 8")
    dv.add(rng("hours"))
    ws.add_data_validation(dv)

    # Hướng dẫn
    hd = wb.create_sheet("Hướng dẫn")
    lines = [
        ("Cách dùng", True),
        ("1. Điền mỗi công việc 1 dòng ở sheet 'Timesheet' (ô nền vàng). Cột tiêu đề xanh đậm là bắt buộc.", False),
        ("2. Dòng 2 (nền xám) là dòng mẫu đã khai. Có thể xóa hoặc giữ; chạy lại sẽ bị bỏ qua vì trùng.", False),
        ("3. Lưu file, đóng Excel, rồi chạy thử:  python jira_timesheet.py batch timesheet.xlsx --dry-run", False),
        ("4. Kiểm tra kết quả thử, rồi khai thật:  python jira_timesheet.py batch timesheet.xlsx", False),
        ("", False),
        ("Quy tắc", True),
        ("- Tự bỏ qua thứ 7, chủ nhật. Ngày lễ/phép ghi vào cột 'skip'.", False),
        ("- Không khai được ngày trong tương lai; tháng trước có thể bị chặn.", False),
        ("- Tổng giờ mỗi ngày (mọi dự án) không vượt 8h; dòng vượt sẽ báo lỗi và không tạo.", False),
        ("- Task trùng (cùng summary + ngày bắt đầu) sẽ bị bỏ qua.", False),
        ("- Worklog tạo ra ở trạng thái Pending, chờ PM duyệt.", False),
        ("", False),
        ("Danh mục lấy từ Jira ngày " + dt.date.today().strftime("%d/%m/%Y") +
         ". Tạo lại: python jira_timesheet.py template timesheet.xlsx --overwrite", False),
    ]
    for i, (text, bold) in enumerate(lines, 1):
        hd.cell(row=i, column=1, value=text).font = Font(name=F, size=12 if bold else 10, bold=bold,
                                                         color="1F4E78" if bold else "000000")
    hd.column_dimensions["A"].width = 110

    wb.active = 0
    wb.save(out)
    print(f"Đã tạo {out}: {len(all_projects)} dự án, {len(phases)} phase, "
          f"{sum(len(m['fields']['components']['allowedValues']) for m in metas.values())} component")


def print_worklogs(jira: Jira, ym: str) -> None:
    y, m = map(int, ym.split("-"))
    rows = sorted(jira.month_worklogs(y, m), key=lambda o: dt.datetime.strptime(o["loggedDate"], "%d/%b/%Y"))
    total: dict[str, float] = defaultdict(float)
    for o in rows:
        total[o["loggedDate"]] += float(o["hours"])
        print(f"{o['loggedDate']} | {o['hours']:>3}h | {o['status']:<8} | {o['issueKey']:<24} | {o['type']:<7} | "
              f"{o['phase']:<10} | {o['desc'][:60]}")
    print("\nTổng theo ngày:", ", ".join(f"{k[:6]}={fmt_hours(v)}h" for k, v in total.items()) or "(trống)")


# --- CLI ----------------------------------------------------------------------
def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description="Khai timesheet Jira FIS")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("projects", help="Liệt kê dự án")
    c = sub.add_parser("components", help="Liệt kê component của dự án")
    c.add_argument("project")
    w = sub.add_parser("worklogs", help="Xem worklog của mình theo tháng (YYYY-MM)")
    w.add_argument("month")

    def common(p):
        p.add_argument("--no-close", action="store_true", help="Log work nhưng để task ở In Progress")
        p.add_argument("--force", action="store_true", help="Bỏ qua kiểm tra 8h/ngày")
        p.add_argument("--dry-run", action="store_true")

    lg = sub.add_parser("log", help="Khai 1 dòng timesheet")
    lg.add_argument("-p", "--project", required=True)
    lg.add_argument("-s", "--summary", required=True)
    lg.add_argument("-c", "--component", required=True, help="ID, tiền tố (vd '37.3.1') hoặc 1 phần tên")
    lg.add_argument("--start", required=True)
    lg.add_argument("--end", help="Mặc định = start")
    lg.add_argument("--hours", type=float, default=8, help="Giờ/ngày (mặc định 8)")
    lg.add_argument("--type", default="Create", help=f"Type of Work: {', '.join(TYPES_OF_WORK)}")
    lg.add_argument("--phase", default="Coding", help="Analysis, Design, Coding, Test, Customer Support, ...")
    lg.add_argument("--skip", default="", help="Ngày nghỉ bỏ qua, cách nhau bởi dấu phẩy")
    lg.add_argument("-e", "--estimate", help="Mặc định = số ngày làm việc (vd 2d)")
    lg.add_argument("-d", "--description", help="Mặc định = summary")
    common(lg)

    b = sub.add_parser("batch", help="Khai nhiều dòng từ file .xlsx hoặc .csv")
    b.add_argument("file")
    common(b)

    t = sub.add_parser("template", help="Tạo file Excel mẫu kèm danh mục từ Jira")
    t.add_argument("out", nargs="?", default="timesheet.xlsx")
    t.add_argument("-p", "--projects", nargs="+",
                   default=[x for x in os.environ.get("JIRA_PROJECTS", "").split(",") if x.strip()],
                   help="Dự án lấy danh sách component (mặc định: JIRA_PROJECTS trong .env)")
    t.add_argument("--overwrite", action="store_true")

    a = ap.parse_args()
    for k in ("JIRA_URL", "JIRA_USER", "JIRA_PASS"):
        if not os.environ.get(k):
            raise SystemExit(f"Thiếu biến môi trường {k} (xem .env.example)")
    jira = Jira(os.environ["JIRA_URL"], os.environ["JIRA_USER"], os.environ["JIRA_PASS"])

    if a.cmd == "projects":
        for p in jira.api("GET", "project"):
            print(f"{p['key']} | {p['name']}")
    elif a.cmd == "components":
        for comp in jira.create_meta(a.project)["fields"]["components"]["allowedValues"]:
            print(f"{comp['id']} | {comp['name']}")
    elif a.cmd == "worklogs":
        print_worklogs(jira, a.month)
    elif a.cmd == "log":
        log_one(jira, vars(a), a, {})
    elif a.cmd == "batch":
        cache: dict = {}
        for row in read_rows(a.file):
            if row.get("summary") and not row.get("project", "").startswith("#"):
                missing = [k for k in ("project", "component", "start") if not row.get(k)]
                if missing:
                    print(f"\n[{row.get('project') or '?'}] {row['summary']}\n  LỖI: script Python cần cột {', '.join(missing)} "
                          f"(extension tự điền được các cột này)")
                    continue
                try:
                    log_one(jira, row, a, cache)
                except SystemExit as e:  # lỗi 1 dòng không dừng cả file
                    print(f"  LỖI: {e}")
    elif a.cmd == "template":
        if not a.projects:
            raise SystemExit("Cần -p <dự án ...> hoặc JIRA_PROJECTS trong .env")
        if Path(a.out).exists() and not a.overwrite:
            raise SystemExit(f"{a.out} đã tồn tại (thêm --overwrite để ghi đè)")
        build_template(jira, a.out, [p.strip() for p in a.projects])


if __name__ == "__main__":
    main()
