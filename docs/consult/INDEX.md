# Bảng theo dõi hỏi–đáp

*Cập nhật lần cuối: 2026-08-02 (đã áp dụng Q01–Q06 vào mã và tài liệu)*

| Mã | Chủ đề | Mức độ | Trạng thái | Ngày hỏi | Ngày trả lời | Người trả lời |
|---|---|---|---|---|---|---|
| [Q01](Q01-focus-thay-click.md) | Dùng `focus()` thay cú click thật — đánh đổi những gì | **chặn** | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |
| [Q02](Q02-input-date-segment.md) | `<input type="date">` và việc nhắm segment | **chặn** | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |
| [Q03](Q03-select-popup-native.md) | `<select>` và popup native ngoài tầm CDP | quan-trọng | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |
| [Q04](Q04-khe-ho-do-toa-do.md) | Khe hở giữa lúc đo toạ độ và lúc dispatch | quan-trọng | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |
| [Q05](Q05-luoi-kiem-thu.md) | Dựng lưới kiểm thử cho extension + CDP | quan-trọng | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |
| [Q06](Q06-ranh-gioi-chuan-declarative.md) | Trang khai báo bao nhiêu, extension suy luận bao nhiêu | tham-khảo | đang-áp-dụng | 2026-08-02 | 2026-08-02 | Fable |

## Đang chờ chủ dự án quyết

- **[Q06](Q06-ranh-gioi-chuan-declarative.md) — chế độ lint/validator trong extension.** Việc mới phát sinh từ câu trả lời, chưa có trong roadmap. Đề xuất đặt ở M4.

## Việc mới lộ ra từ lưới E2E

- ~~**Scanner không xuyên shadow root.**~~ ✅ Đã làm ở M2 (03/08/2026): scanner đệ quy vào `shadowRoot`, observer gắn cho từng root, `livemcp-ignore`/`hidden` đi xuyên được ranh giới shadow. `fixme` đã gỡ.
- **Ô `time` vẫn suy từ `Intl` thay vì đo.** Đúng lỗi nguyên tắc đã sửa cho ô ngày nhưng chưa sửa cho ô giờ ([Q02](Q02-input-date-segment.md) câu 5). Vẫn là `test.fixme` — *lưu ý: `test.fixme` KHÔNG tự nhắc khi tính năng xong, phải nhớ gỡ tay.*

## Đã áp dụng — thay đổi lớn nhất

Kiến trúc §2.2 bị **đảo**: từ "toạ độ là ngôn ngữ chung của mọi hành động" sang **"bàn phím là đường mặc định, toạ độ chỉ là ngôn ngữ của hành động chuột"**. Toàn bộ việc điền form không còn phụ thuộc toạ độ. Chuẩn declarative có thêm §9.5 với hai yêu cầu conformance về hành vi (keyboard-operable; `change` là tạm thời) — cả hai đều không thêm attribute nào.

Chi tiết từng thay đổi nằm ở mục 5 của mỗi tài liệu.

## Bối cảnh chung cho người mới đọc

Live MCP là local server cầu nối cho AI agent điều khiển trang web **thuần declarative** — trang chỉ khai báo khả năng tương tác bằng HTML attribute, không có Imperative API. Triết lý nền: *agent phải tương tác y như con người — chuột và bàn phím thật, không gọi JavaScript của trang*. Vì vậy mọi input đi qua Chrome DevTools Protocol để có `isTrusted: true`.

Kiến trúc ba thành phần: **Local Server** (nói MCP với agent) ↔ WebSocket ↔ **Chrome Extension** (service worker dispatch CDP + content script quét DOM) ↔ **trang web**.

Chi tiết: [`../livemcp-architecture.md`](../livemcp-architecture.md), [`../livemcp-declarative-spec.md`](../livemcp-declarative-spec.md), [`../project-ideal.md`](../project-ideal.md).
