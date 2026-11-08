# Jira FIS timesheet

Khai timesheet hàng loạt trên https://jira.fis.com.vn (Jira 6.4 + plugin worklog của FIS) từ file Excel.

Có 2 cách dùng, cùng một định dạng file Excel:

| | Chrome extension (khuyên dùng) | Script Python |
|---|---|---|
| Cài đặt | Load thư mục `chrome-extension/` vào Chrome | Python 3.9+, `pip install openpyxl` |
| Đăng nhập | Dùng phiên Jira đang mở, **không lưu mật khẩu** | Mật khẩu trong `.env` |
| Thao tác | Nút **⏱ Timesheet** trong Jira → chọn file → Kiểm tra → Khai | `python jira_timesheet.py batch file.xlsx` |

## 1. File Excel

Dùng `timesheet.xlsx` (hoặc nút **Tải file mẫu** trong extension). Điền mỗi công việc một dòng ở sheet **Timesheet**:

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| project | ✔ | Chọn từ dropdown |
| summary | ✔ | Tiêu đề task |
| component | ✔ | Mã (vd `30.3`) hoặc ID, xem sheet **Danh mục** |
| start | ✔ | dd/mm/yyyy |
| end | | Bỏ trống = bằng ngày bắt đầu |
| hours | | Giờ/ngày, mặc định 8 |
| type | | Create / Correct / Study / Review / Test, mặc định Create |
| phase | | Mặc định Coding |
| skip | | Ngày nghỉ trong khoảng: `05/11/2026, 06/11/2026` |
| estimate | | Mặc định = số ngày (vd `3d`) |
| description | | Mặc định = summary |

Thứ 7 và chủ nhật tự được bỏ qua.

## 2. Chrome extension

Cài một lần:
1. Mở `chrome://extensions`, bật **Developer mode** (góc trên bên phải).
2. Bấm **Load unpacked**, chọn thư mục `chrome-extension`.

Cập nhật bản mới: mở `chrome://extensions`, bấm **↻** trên thẻ extension, rồi F5 trang Jira.

Mở Jira (đã đăng nhập) và bấm nút **⏱ Timesheet** ở góc phải dưới (hoặc bấm icon extension). Kéo thanh tiêu đề để di chuyển bảng; nhấp đúp để đưa về giữa màn hình.

**Tab "Khai mới"**
- Thêm dòng bằng **+ Thêm dòng**, bằng **Nhập Excel…**, hoặc chọn ngày ở tab Lịch.
- Mọi ô sửa được ngay trên bảng: Dự án, Công việc (gợi ý tiêu đề task cũ), Component (gõ mã như `30.3`), Từ/Đến/Bỏ ngày, Giờ/ngày, Type, Phase.
- Tự điền từ Jira:
  - Dự án và Component lấy theo task gần nhất, hoặc theo task cũ có cùng tiêu đề.
  - Type và Phase lấy theo giá trị bạn dùng nhiều nhất.
  - Không có ngày thì tự xếp vào ngày còn trống trong tuần (cột `days` = số ngày cần).
- Bảng tự kiểm tra lại sau mỗi lần sửa: Hợp lệ / Đã khai rồi / Lỗi (có lý do) / Chưa đủ thông tin.
- Bảng nháp được lưu lại; tải lại trang không bị mất.
- Bấm **Khai timesheet** để khai các dòng Hợp lệ.

**Tab "Lịch & đã khai"**
- Lịch tháng hiển thị giờ đã khai mỗi ngày: xanh = đủ 8h, vàng = thiếu, đỏ = chưa khai, `+8` = giờ đang có trong bảng nháp.
- Chọn ngày, rồi bấm **Thêm dòng khai cho ngày đã chọn**.
- Dùng **Đánh dấu nghỉ** cho ngày nghỉ phép/lễ: những ngày này không bị tự xếp và được bỏ qua khi khai.
- Danh sách worklog trong tháng theo từng task:
  - **✎** sửa số giờ, **×** xóa một ngày, **Xóa cả task**.
  - Chỉ thao tác được với worklog chưa Approved.
  - Start/Due/Estimate của task được tự cập nhật. Task đã Closed sẽ được mở lại, sửa, rồi Close lại.
  - Task không còn worklog nào sẽ chuyển Cancelled.

## 3. Script Python

```bash
cp .env.example .env                                   # điền JIRA_USER / JIRA_PASS / JIRA_PROJECTS
python jira_timesheet.py batch timesheet.xlsx --dry-run  # kiểm tra
python jira_timesheet.py batch timesheet.xlsx            # khai thật
python jira_timesheet.py worklogs 2026-11                # xem worklog trong tháng
python jira_timesheet.py template timesheet.xlsx --overwrite  # tạo lại file mẫu với danh mục mới nhất
```

## Quy trình mỗi dòng (cả 2 cách)

1. Tạo Task: Summary, Component, Start Date, Due Date, Original Estimate.
2. Chuyển `In Progress`. Plugin không cho log work khi task ở Open, Closed hoặc Cancelled.
3. Log work qua `/rest/fis-worklog/1.0/createWorkLog`. Plugin tự cập nhật Actual Start Date.
4. Chuyển `Completed` rồi `Closed`. Actual End Date được gán khi Close.
5. Worklog ở trạng thái **Pending** cho tới khi PM duyệt.

Trước khi tạo, mỗi dòng được kiểm tra:
- trùng task đã có (cùng summary + Start Date) → bỏ qua;
- tổng giờ trong ngày (mọi dự án và các dòng phía trên trong file) vượt 8h → báo lỗi;
- ngày trong tương lai, sai component, sai phase, dòng lặp trong file → báo lỗi;
- khai cho tháng trước → cảnh báo, vì có thể bị Jira chặn.

## Lưu ý kỹ thuật

- Request tới plugin phải có header `Content-Type: application/json; charset=utf-8`, nếu không tiếng Việt bị lỗi font.
- Trên Windows/Git Bash, đừng truyền tiếng Việt qua tham số của `curl.exe` (bị chuyển sang cp1252).
- File CSV vẫn đọc được, nhưng phải lưu dạng **CSV UTF-8**. Nên dùng `.xlsx`.
