---
id: Q02
tiêu_đề: input[type=date] và việc nhắm segment
trạng_thái: đang-áp-dụng
mức_độ_chặn: chặn
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - Q01
  - packages/extension/src/content/dateOrder.ts
  - packages/extension/src/content/plan.ts
  - docs/livemcp-declarative-spec.md §4 (bảng HTML → JSON Schema)
---

## 1. Khó khăn

`<input type="date">` có một tính chất khiến tự động hoá bằng bàn phím rất khó:

- `.value` **luôn** là ISO `YYYY-MM-DD`, bất kể locale.
- Nhưng thứ tự các segment hiển thị — và do đó thứ tự phải gõ chữ số — do **locale giao diện của trình duyệt** quyết định. Không phải `lang` của trang. Không phải `navigator.language`. Một trang tiếng Việt chạy trên Chrome cài tiếng Anh vẫn hiện `mm/dd/yyyy`.

Nghĩa là agent nhận yêu cầu `2026-08-20` nhưng không biết phải gõ `08202026` hay `20082026` hay `20260820`. Gõ sai thứ tự thì hoặc ô từ chối (tháng 20 không tồn tại), hoặc — tệ hơn nhiều — **nhận nhầm thành một ngày hợp lệ khác** (05/06 ↔ 06/05) mà không ai phát hiện.

Thêm một tầng khó: muốn gõ đúng thì con trỏ phải đang ở **segment đầu tiên**. Trước đây chúng tôi click sát mép trái ô rồi bấm ArrowLeft bốn lần cho chắc — nhưng chính cú click theo toạ độ đó là thứ vừa gây lỗi (xem [Q01](Q01-focus-thay-click.md)).

## 2. Tôi đã suy nghĩ và thử những gì

**Đã loại trừ — đoán bằng `Intl.DateTimeFormat`.** Đây là thứ tôi làm đầu tiên và nó sai về nguyên tắc: `Intl` bám `navigator.language`, tức ngôn ngữ trang/người dùng khai báo, không phải locale giao diện trình duyệt. Hai thứ này lệch nhau thường xuyên. Chủ dự án chỉ ra điều này bằng đúng một câu: "dù bạn có set định dạng thế nào một số trình duyệt nó vẫn ngoan cố theo cách của nó".

**Đã làm và đang dùng — dò thực nghiệm.** Thay vì đoán thì đo:

1. Tạo một `<input type="date">` ẩn trong shadow root **của riêng extension** (CSS trang không phá được, và quan trọng hơn: ứng dụng của trang không bao giờ nhìn thấy nó).
2. Gõ vào đó ngày mốc `01` / `02` / `2026` theo đúng đường CDP như khi gõ thật.
3. Đọc `.value` trả về:
   - `2026-01-02` → segment đầu là **tháng** → MDY
   - `2026-02-01` → segment đầu là **ngày** → DMY
   - năm khác 2026 (segment đầu nuốt mất `0102` làm năm) → YMD
4. Gỡ ô dò, ghi nhớ kết quả cho cả vòng đời trang.

Chọn mốc 01 và 02 vì cả hai đều hợp lệ cho *cả* ngày lẫn tháng — không segment nào bị trình duyệt tự ép về giá trị khác, nên phép đo không nhập nhằng.

**Đã làm và giữ lại — xác minh rồi vét cạn.** Sau khi điền, đọc lại `.value` thật và so với thứ agent yêu cầu. Lệch thì gõ lại theo thứ tự tiếp theo chưa thử, tối đa ba thứ tự. Hết cách thì báo lỗi rõ ràng chứ không im lặng coi như thành công.

**Đang định bỏ — click mép trái + ArrowLeft ×4.** Đây là heuristic phụ thuộc toạ độ, và tự nó cũng mong manh: chọn `min(12, width/4)` làm khoảng cách từ mép trái là con số tôi tự đặt, không có cơ sở.

## 3. Hướng tôi đang định làm

Thay cú click bằng `el.focus()` (theo hướng ở [Q01](Q01-focus-thay-click.md)), rồi bấm `ArrowLeft` ba lần trước khi gõ chữ số.

**Giả định mà hướng này đang dựa vào:**

- `focus()` trên `type="date"` đặt con trỏ ở **segment đầu tiên** theo thứ tự hiển thị.
- `ArrowLeft` ở segment đầu tiên **đứng yên** (clamp), không nhảy vòng sang segment cuối. Nếu nó wrap thì ba lần ArrowLeft của tôi sẽ đưa con trỏ đi lung tung — và ca **gõ lại** (con trỏ đang ở segment cuối sau lần gõ hỏng) sẽ hỏng theo kiểu khó lần ra.

Cả hai giả định này tôi chưa kiểm chứng, và chúng đủ sức làm hỏng toàn bộ nhánh xử lý ô ngày.

## 4. Câu hỏi cụ thể

1. **`HTMLInputElement.focus()` trên `type="date"` có bảo đảm đặt con trỏ ở segment đầu tiên theo thứ tự hiển thị không?** Đây là hành vi được chuẩn hoá ở đâu đó, hay chỉ là chi tiết cài đặt của Chrome có thể đổi giữa các bản?

2. **`ArrowLeft` ở segment đầu tiên bị clamp hay wrap sang segment cuối?** Và `ArrowRight` ở segment cuối thì sao? Hành vi này có khác nhau giữa các nền tảng (Windows/macOS/Linux) không?

3. **Có cách nào chính thống hơn để biết thứ tự segment không?** Phép dò thực nghiệm của tôi hoạt động nhưng tốn một vòng dispatch và cảm giác như đang lách. Có API nào — kể cả CDP, kể cả không chính thống — cho biết locale giao diện của trình duyệt hoặc trực tiếp cho biết thứ tự segment của date input không?

4. **Câu hỏi thiết kế chuẩn.** Live MCP đang định nghĩa một chuẩn declarative nhắm tới agent. Chuẩn đó nên:
   - **(a)** khuyến nghị dev *tránh* `type="date"`, dùng `type="text"` + `pattern` cho ô ngày — đơn giản hoá tuyệt đối cho agent, nhưng lấy mất trải nghiệm date picker của người dùng thật; hoặc
   - **(b)** chấp nhận `type="date"` và gánh toàn bộ độ phức tạp ở tầng extension — giữ nguyên trải nghiệm người dùng, nhưng chuẩn phải sống chung với một nhánh xử lý mong manh; hoặc
   - **(c)** một lối thứ ba tôi chưa nghĩ tới (ví dụ: cho trang khai báo `livemcp-value-format` để agent biết gửi giá trị dạng nào)?

   Kinh nghiệm thực chiến nghiêng về đâu? Đây là quyết định khó đảo ngược vì nó nằm trong bản thân chuẩn, không phải trong mã.

5. **`type="time"` với locale 12 giờ**, và `type="datetime-local"`, `month`, `week` — có cạm bẫy nào tương tự mà tôi nên biết trước không? Hiện tôi xử lý `time` bằng cách kiểm `Intl.DateTimeFormat(...).resolvedOptions().hour12` rồi gõ thêm phím `a`/`p`, nhưng nếu `Intl` không đáng tin cho ngày thì nhiều khả năng cũng không đáng tin cho giờ.

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

Trước hết: phép dò thực nghiệm của bạn **không phải lách — nó là calibration**, và là kỹ thuật đúng chuẩn mực trong tự động hoá khi đối mặt hành vi UA-defined. Nguyên tắc bạn đã tự tìm ra đáng được nâng thành nguyên tắc thiết kế của dự án: *hành vi không được spec chuẩn hoá thì đo trên chính trình duyệt đang chạy, không tin tài liệu — kể cả tài liệu này.*

**Câu 1 — focus() đặt caret ở segment đầu: đúng trên Chrome, nhưng không được chuẩn hoá.** Rendering của date input là UA-defined; spec không có khái niệm segment. Trong Blink, ô ngày là một shadow tree nội bộ gồm các field, và focus vào host được chuyển tiếp cho field *đầu tiên theo thứ tự hiển thị*. Hành vi này ổn định nhiều năm nhưng về nguyên tắc là chi tiết cài đặt. Cách xử lý đúng không phải tin lời tôi — mà là để probe đo luôn (xem câu 2).

**Câu 2 — ArrowLeft ở field đầu: clamp, không wrap.** Trên Chrome desktop (Windows/macOS/Linux như nhau — logic field nằm trong Blink, không phụ thuộc nền tảng), ArrowLeft ở field đầu đứng yên, ArrowRight ở field cuối đứng yên. Độ tin: cao. Nhưng điểm chính tôi muốn nói là bạn **không cần tin tôi**: probe hiện tại đo được cả điều này trong cùng một lần dò. Sau khi gõ ngày mốc thứ nhất (caret đang ở field cuối), bấm ArrowLeft ×3 rồi gõ bộ chữ số mốc *thứ hai* và đọc `.value` — kết quả đúng kỳ vọng thì cả "focus về field đầu", "clamp", lẫn "thứ tự segment" đều được xác nhận trên đúng bản Chrome đang chạy, qua đúng đường CDP thật. Một lần dò, ba sự thật. Đây cũng chính là bài kiểm cho ca "gõ lại" mà bạn lo.

**Câu 3 — có một API bạn bỏ sót: `chrome.i18n.getUILanguage()`.** Nó trả về đúng **locale giao diện trình duyệt** — thứ thực sự quyết định thứ tự segment — chứ không phải Accept-Language như `navigator.language`. `Intl.DateTimeFormat(chrome.i18n.getUILanguage(), ...)` cho thứ tự đúng trong đại đa số trường hợp. Tuy vậy khuyến nghị của tôi: dùng nó làm *cross-check rẻ tiền*, giữ probe làm *nguồn sự thật* — vì chuỗi suy luận "getUILanguage → dữ liệu CLDR → Blink render đúng CLDR" có ba mắt xích, còn probe đo thẳng đầu ra. Khi hai nguồn lệch nhau thì log lại: đó là dữ liệu quý. Không tồn tại CDP API nào cho biết thứ tự segment trực tiếp.

**Câu 4 — chọn (b), dứt khoát.**

- **(a) chết về adoption và phản triết lý.** Một chuẩn mở màn bằng "hãy bỏ date picker của người dùng để chiều agent" là đảo ngược tiền đề của chính dự án: *agent thích nghi với web của con người, không phải ngược lại*. Chưa kể `type="text"` + pattern thua `type="date"` về validation, bàn phím mobile, và a11y.
- **(c) `livemcp-value-format` là attribute độc**, vì người viết *không thể điền đúng*: thứ tự hiển thị do browser UI locale của từng người dùng quyết định — trang không biết và không thể biết trước. Một attribute mà tác giả không có cách nào điền đúng sẽ sai hàng loạt (xem thêm bài học ARIA ở Q06). Còn wire format thì đã có lời giải tốt nhất rồi: agent **luôn gửi ISO 8601** — trùng khớp `.value` — extension lo phần dịch sang keystroke.
- **(b) khả thi vì độ mong manh đã được cách ly và có lưới đỡ.** Toàn bộ phức tạp nằm trong một module (dateOrder + plan), và vòng *xác minh rồi vét cạn* của bạn (đọc lại `.value`, so, thử thứ tự khác, tối đa ba, fail rõ ràng) chính là mẫu mà password manager và screen reader đã dùng để sống chung với web thật hàng chục năm. Hãy nhìn `.value` luôn-là-ISO như một món quà: đó là **oracle xác minh tuyệt đối tin cậy** — phần lớn hệ tự động hoá mơ có một oracle như vậy mà không được.

**Câu 5 — time và họ hàng:**

- **`hour12` từ `Intl` mắc đúng lỗi nguyên tắc như date** — bám nhầm nguồn (`navigator.language`). Sửa tối thiểu: truyền `chrome.i18n.getUILanguage()` vào `Intl.DateTimeFormat`. Sửa đúng: mở rộng probe sang `type="time"` — gõ mốc, đọc `.value`, biết ngay 12/24h.
- **Cạm bẫy AM/PM ít người biết: có locale đặt AM/PM ĐỨNG TRƯỚC giờ** (ko-KR: "오전 07:05"). Đừng giả định field AM/PM ở cuối — probe đo được luôn vị trí của nó. Phím `a`/`p` đúng là cách Chrome nhận.
- **`datetime-local`**: tới 5–6 field (kể cả AM/PM), nên "ArrowLeft ×3" không đủ tổng quát. Thay bằng: số lần ArrowLeft = số field đã đo từ probe; hoặc đơn giản hơn — blur rồi `focus()` lại để reset về field đầu (hành vi reset này cũng đo được bằng probe, cùng nguyên tắc).
- **`month`/`week`**: hiếm trên web thật (`week` có dạng value riêng `2026-W31`). Hỗ trợ qua cùng máy móc nhưng để ưu tiên thấp — đừng cho chúng chặn milestone.
- Chốt: để probe sinh ra một "bảng hành vi đã đo" tại runtime (thứ tự segment, clamp, vị trí AM/PM, hành vi re-focus) và mọi nhánh xử lý đọc từ bảng đó. Đừng hard-code gì ngoài bộ chữ số mốc.

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Thứ giá trị nhất không phải một câu trả lời mà là một nguyên tắc:** *hành vi không được spec chuẩn hoá thì đo trên chính trình duyệt đang chạy, không tin tài liệu — kể cả tài liệu này.* Chuyên gia trả lời cả câu 1 và câu 2 kèm độ tin cao, rồi vẫn nói "đừng tin tôi, để probe đo luôn". Tôi đã làm đúng thế, và đó là thay đổi có giá trị nhất trong lượt này.

**Đã đổi trong mã:**

- `plan.ts` + `index.ts` — **phép dò hai lượt, một lần dò ba sự thật.** Lượt 1 gõ mốc A (01/02/2026) → biết thứ tự segment. Lượt 2 ArrowLeft ×3 rồi gõ mốc B (03/04/2027) → nếu ra đúng kỳ vọng thì cả "focus() về segment đầu" lẫn "ArrowLeft clamp chứ không wrap" đều đã được chứng minh trên đúng bản Chrome đang chạy. Hai lượt không khớp → **không ghi nhớ thứ tự nào**, để vòng xác minh từng ô tự vét cạn, vì nó đọc giá trị thật chứ không dựa vào giả định nào.
- Mốc B cố ý khác hẳn mốc A, để phân biệt "đã gõ lại đúng" với "không gõ được gì nên giá trị giữ nguyên".
- `dateOrder.ts` — thêm `uiLanguage()` dùng `chrome.i18n.getUILanguage()`, và `guessOrderFromIntl()`/`guessHour12()` giờ truyền nó vào `Intl` thay vì để `undefined` (tức `navigator.language`). Đây là **sửa đúng lỗi nguyên tắc**: hai nguồn này khác nhau, và tôi đã bám nhầm nguồn.
- Nhưng theo đúng khuyến nghị: locale chỉ là **cross-check**, probe là nguồn sự thật. `crossCheckWithLocale()` chỉ log khi hai bên lệch — đúng như chuyên gia nói, đó là dữ liệu quý.
- `backToFirstSegment()` thay "ArrowLeft ×3 cứng" bằng số lần theo `SEGMENT_COUNT` của từng loại ô (date 3, datetime-local 6, month/week 2). An toàn nhờ clamp; giải luôn điểm chuyên gia chỉ ra ở câu 5 rằng ×3 không tổng quát cho `datetime-local`.

**Câu 4 — chốt (b): chấp nhận `type="date"`, gánh phức tạp ở tầng extension.** Hai lý do bác bỏ đủ dứt khoát để tôi không cần cân nhắc thêm: (a) đảo ngược tiền đề của dự án — agent thích nghi với web của con người, không phải ngược lại; (c) `livemcp-value-format` là attribute mà **tác giả trang không có cách nào điền đúng**, vì thứ tự hiển thị do browser UI locale của từng người dùng quyết định. Phép thử "dev có thể điền sai mà trang vẫn chạy bình thường không?" ở Q06 áp vào đây cho kết quả rõ ràng.

Cách nhìn tôi giữ lại: `.value` luôn-là-ISO không phải phiền toái mà là **oracle xác minh tuyệt đối tin cậy**. Vòng xác minh-rồi-vét-cạn đứng được là nhờ nó.

**Còn treo — `type="time"` với locale AM/PM đứng trước giờ (ko-KR).** `timeKeys()` hiện vẫn giả định AM/PM ở cuối; vòng xác minh sẽ bắt được nếu sai, nhưng lời giải đúng là mở phép dò sang `type="time"` để đo luôn vị trí field AM/PM. Ghi TODO trong `plan.ts`, để M2. `month`/`week` để ưu tiên thấp theo đúng khuyến nghị — không cho chúng chặn milestone.
