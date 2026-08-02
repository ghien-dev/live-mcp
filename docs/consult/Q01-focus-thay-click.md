---
id: Q01
tiêu_đề: Dùng focus() thay cú click thật — đánh đổi những gì
trạng_thái: đang-áp-dụng
mức_độ_chặn: chặn
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - docs/livemcp-architecture.md §2.1 (bắt buộc trusted events), §2.2 (toạ độ là ngôn ngữ chung)
  - docs/project-ideal.md (triết lý "chuột và bàn phím, không gọi JavaScript")
  - packages/extension/src/content/plan.ts
  - packages/extension/src/sw/cdp.ts
---

## 1. Khó khăn

Triết lý dự án bắt buộc mọi input phải là **trusted event**, nên chúng tôi dispatch qua CDP: `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`.

Nhưng `Input.dispatchMouseEvent` **chỉ nhận toạ độ `x, y`** — CDP không có lệnh "click vào element này". Điều đó ép chúng tôi phải đo toạ độ phần tử rồi mới click, và chính chỗ đó vừa gây ra một lỗi tốn nhiều thời gian: content script đo toạ độ cả form trong một mẻ (mỗi phép đo gọi `scrollIntoView`, làm sai toạ độ đã đo trước), rồi service worker mới phát lại chuỗi click. Kết quả trên trang thật là click trượt, focus nằm nguyên ở ô cũ, và cả chuỗi phím đổ nhầm sang đó — ô "số khách" nhận trọn chuỗi ngày tháng.

Hướng thoát: **không dùng chuột để lấy focus nữa**. Content script gọi `el.focus()` (DOM API ở isolated world, không đụng JavaScript của trang), rồi service worker gõ phím qua CDP vào phần tử đang focus. Toàn bộ việc điền form trở thành không phụ thuộc toạ độ.

Chỗ tôi không tự quyết được: `el.focus()` là thứ **con người không làm được** — người ta click hoặc bấm Tab. Tôi không đủ cơ sở để đánh giá hết hệ quả của việc lệch khỏi hành vi người thật ở bước này, trong khi cả dự án đặt cược vào tính "y như con người".

## 2. Tôi đã suy nghĩ và thử những gì

**Đã loại trừ — click theo toạ độ đo một mẻ.** Chính là lỗi vừa xảy ra. Toạ độ là sản phẩm của một trạng thái layout, chỉ đúng trong khoảnh khắc đo; dùng nó làm danh tính phần tử là sai nguyên tắc.

**Đã làm và giữ lại — đo từng phần tử ngay trước khi dùng.** Đã viết lại thành máy trạng thái điền từng ô một, mỗi lượt chỉ đo đúng một ô. Cải thiện thật nhưng vẫn còn khe hở ~20ms giữa lúc đo và lúc dispatch (chi tiết ở [Q04](Q04-khe-ho-do-toa-do.md)).

**Đã làm và giữ lại — kiểm `elementFromPoint` trước mỗi click.** Nếu điểm sắp click không rơi vào phần tử đang nhắm thì huỷ hành động và báo lỗi chỉ đích danh, thay vì gõ bừa. Chuyển kiểu hỏng "im lặng gõ nhầm ô" thành kiểu hỏng "báo lỗi rõ ràng".

**Đã cân nhắc và loại — CDP `DOM.focus` gọi từ service worker.** Thuần CDP, không có mã nào chạy trong ngữ cảnh trang. Nhưng service worker phải giải `nodeId`, tức quay lại phụ thuộc selector — mà selector yếu đúng những chỗ chúng tôi cần mạnh: phần tử trùng nhau, shadow DOM, phần tử vừa sinh ra không có id ổn định. Spec của chúng tôi (§5.1) đã chốt giữ **element reference trực tiếp** chứ không lưu selector.

**Đã cân nhắc và loại — Tab từ ô trước đó.** Thuần bàn phím, trung thành tuyệt đối với "y như con người". Nhưng phụ thuộc tab order, vỡ khi có phần tử ẩn hoặc skip-link chen vào, và không có cách nào tới được ô đầu tiên.

**Điều tôi tin là đúng nhưng chưa kiểm chứng:** tính `isTrusted` của các sự kiện *input* không bị ảnh hưởng, vì `keydown`/`keypress`/`input`/`change`/`submit` vẫn do CDP sinh. Chỉ riêng sự kiện `focus`/`focusin` là programmatic (`isTrusted: false`).

**Điều tôi biết là mất đi:** `el.focus()` không cấp **user activation**. Luồng nào cần cử chỉ người dùng thật — mở hộp chọn file, ghi clipboard, mở popup — sẽ không chạy. Và không có `mousedown`/`click`, nên widget tự chế chỉ phản ứng theo click sẽ nằm im.

## 3. Hướng tôi đang định làm

Bàn phím là đường mặc định, chuột là ngoại lệ:

| Loại phần tử | Cách tương tác | Cần toạ độ |
|---|---|---|
| text / number / email / url / tel / textarea | `focus()` → Ctrl+A → `Input.insertText` | không |
| date / time / datetime-local | `focus()` → ArrowLeft ×3 → gõ chữ số | không |
| select | `focus()` → ArrowUp/Down theo chênh lệch index | không |
| checkbox | `focus()` → Space | không |
| radio | `focus()` radio đích → Space | không |
| nút submit | `focus()` → Enter | không |
| canvas, hover, drag, scroll, `livemcp-action="click"` trên phần tử không focus được | click chuột tại toạ độ đo ngay trước khi dispatch | **có** |

Sau `el.focus()`, content script xác minh bằng `activeElement` của `el.getRootNode()` (dùng root chứ không phải `document`, để đúng với shadow DOM); focus không vào đúng chỗ thì huỷ hành động.

**Giả định mà hướng này đang dựa vào** — đây chính là những thứ tôi cần chuyên gia xác nhận hoặc bác bỏ:

- Sự kiện input do CDP sinh vẫn `isTrusted: true` bất kể focus được lấy bằng cách nào.
- Việc thiếu user activation không ảnh hưởng tới form HTML thông thường.
- Không có framework UI phổ biến nào từ chối xử lý vì `focus` có `isTrusted: false`.

## 4. Câu hỏi cụ thể

1. **`Input.dispatchKeyEvent` của CDP có cấp transient user activation cho trang không?** Nếu có, thì lo ngại "`focus()` không cấp activation" là thừa — vì thứ cần activation là *hành động* (Enter/Space trên nút), không phải bước lấy focus. Nếu không, thì những luồng nào cụ thể sẽ hỏng?

2. **Có framework hoặc thư viện UI phổ biến nào kiểm `event.isTrusted` trên `focus`/`focusin` rồi từ chối xử lý không?** Tôi quan tâm React, Vue, Radix, Headless UI, và các thư viện combobox/datepicker — vì đó là những thứ trang thật hay dùng.

3. **Mẫu "focus programmatic + phím trusted" có tạo dấu vết lệch so với người thật không** — thiếu `mousemove`/`mousedown` trước đó? Hệ thống chống bot nhìn vào đó có phát hiện được không? Và điều đó có thực sự đáng lo với một sản phẩm agent **công khai danh tính** không (Chrome đã hiện banner "đang gỡ lỗi trình duyệt này", chúng tôi coi đó là tính năng minh bạch chứ không tìm cách che)?

4. **Có nên phát thêm một cú `Input.dispatchMouseEvent` tại đúng toạ độ *sau khi* đã focus, để hoàn thiện dấu vết không?** Hay đó là tự rước lại đúng rủi ro toạ độ mà chúng tôi vừa thoát ra, đổi lấy một lợi ích không có thật?

5. **Có con đường nào khác để lấy focus mà tôi chưa nghĩ tới** — thuần CDP, không cần toạ độ, không cần selector? Hoặc một cách khác hoàn toàn để giải bài toán "gõ vào đúng phần tử này" mà tôi đang bỏ sót?

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

Kết luận trước: hướng "bàn phím mặc định, chuột là ngoại lệ" là **đúng** và nên chốt. Trong ba giả định ở mục 3, hai cái đúng, còn cái thứ ba sai — nhưng sai theo hướng *có lợi* cho bạn.

**Một sự thật đảo ngược tiền đề của cả câu hỏi:** sự kiện `focus`/`focusin` sinh ra từ `el.focus()` trong Chrome là **`isTrusted: true`**. `click()` mới là ngoại lệ — HTML spec đặc tả riêng rằng `click()` phải dispatch một sự kiện synthetic (untrusted). Còn `focus()` chạy "focusing steps" của spec, và sự kiện focus do chính UA phát trong các bước đó, không qua `dispatchEvent()`. Nghĩa là dấu vết sự kiện của bạn còn sạch hơn bạn tưởng: *không có sự kiện untrusted nào cả*. Độ tin của tôi ở điểm này: cao, nhưng vì nó là điểm tựa của cả thiết kế, hãy xác minh bằng một dòng log trên trang demo — mất một phút.

**Câu 1 — user activation: Có.** Sự kiện từ `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent` đi qua pipeline input của browser process — chính vì thế chúng `isTrusted: true` — và user activation được cấp ở đúng tầng đó: mọi `keydown` (trừ `Escape`), `mousedown`/`pointerup` thật đều kích hoạt. Bằng chứng sống: Puppeteer/Playwright mở popup, ghi clipboard, kích hoạt fullscreen qua chính đường này hàng ngày. Vậy activation gắn với *hành động* (phím/chuột), không phải bước lấy focus — lo ngại của bạn là thừa, vì luồng nào của bạn cũng có ít nhất một keydown (Ctrl+A, Space, Enter…) trước bước cần activation.

Một caveat có thật đáng ghi thành invariant: **`Input.insertText` không phải keydown** — nó mô phỏng IME commit, không tự cấp activation. Hôm nay bạn luôn Ctrl+A trước nên không sao; nhưng hãy ghi vào mã: *mọi chuỗi hành động phải chứa ít nhất một keydown hoặc mousedown thật trước bước cần user activation*. Ngoài ra activation là transient (hết hạn sau vài giây, hiện ~5s trong Chromium, và bị "tiêu" bởi một số API như `window.open`, `showPicker()`) — với form HTML thường thì không chạm tới.

**Câu 2 — không framework lớn nào kiểm `isTrusted` trên focus.** Lý do mang tính cấu trúc chứ không phải may mắn: focus programmatic là *xương sống của chính các thư viện đó* — focus trap của modal, `autofocus`, roving tabindex của Radix/Headless UI đều gọi `el.focus()` liên tục. Thư viện nào từ chối focus untrusted sẽ tự phá mình trước. React lắng `focusin` để đồng bộ state và không đọc `isTrusted`; Vue tương tự. Nơi duy nhất nguồn gốc focus có vai trò là heuristic `:focus-visible` (focus bằng script có thể không hiện focus ring) — thuần thẩm mỹ. Rủi ro thật nằm chỗ khác: widget tự chế mở bằng `pointerdown`/`click` (combobox div-soup) sẽ nằm im khi chỉ được focus — nhưng ca đó đã thuộc hàng "chuột là ngoại lệ" trong bảng của bạn rồi.

Một điểm cộng bạn chưa ghi nhận: **đường bàn phím vẫn sinh sự kiện `click` trusted.** Space trên checkbox/radio/button và Enter trên button khiến UA phát một sự kiện `click` thật (`isTrusted: true`, `detail: 0`). Widget nghe `click` trên `<button>` chuẩn vẫn chạy trọn vẹn với đường bàn phím — thêm một lý do để chuẩn declarative yêu cầu phần tử action phải là button thật (xem Q06).

**Câu 3 — dấu vết có lệch, và đừng che.** Anti-bot behavioral (DataDome, HUMAN/PerimeterX, reCAPTCHA v3) nhìn quỹ đạo chuột và cadence phím. "Focus không kèm mousedown" giống hệt người dùng bàn phím thuần / screen reader, nên bản thân nó là tín hiệu yếu. Các tín hiệu *mạnh hơn nhiều* thì bạn đã công khai sẵn: banner `chrome.debugger`, timing phím đều tăm tắp. Với sản phẩm công khai danh tính, khuyến nghị của tôi dứt khoát: **không tiêu một giờ kỹ sư nào cho stealth** — nó mâu thuẫn với triết lý minh bạch và là arms race bạn đã chọn không tham gia. Chấp nhận hệ quả: một số site chống bot sẽ chặn agent; đó là ranh giới sản phẩm, ghi vào tài liệu người dùng.

**Câu 4 — không.** Cú click "hoàn thiện dấu vết" mua một lợi ích không tồn tại (không framework nào cần nó — cái họ cần là click *trước* focus theo trình tự người thật, mà bạn không tái tạo được bằng cách click *sau*; anti-bot cũng không bị thuyết phục bởi một cú click lẻ không kèm quỹ đạo chuột) và trả bằng đúng rủi ro toạ độ vừa thoát. Tệ hơn, nó có thể *gây hại thật*: click vào input đặt lại caret theo vị trí điểm — phá select-all vừa làm; click vào date input rơi vào segment giữa. Nguyên tắc: mỗi phần tử một đường tương tác duy nhất, không trộn.

**Câu 5 — có một đường bạn gạt đi hơi sớm: `DOM.focus` không hề cần selector.** `DOM.focus` nhận `objectId`, và objectId lấy được từ chính element reference bạn đang giữ: content script giữ registry `Map<int, Element>` trong isolated world (§5.1 của bạn đã chốt giữ reference trực tiếp — registry chỉ là đánh số nó); service worker `Runtime.enable`, nhận diện execution context của isolated world extension qua `executionContextCreated` (auxData phân biệt world), rồi `Runtime.callFunctionOn` trong context đó trả về `objectId` của đúng phần tử. Không toạ độ, không selector, danh tính phần tử nguyên vẹn.

Giá trị thật của objectId không nằm ở focus (kết quả tương đương `el.focus()`) mà ở chỗ nó mở khoá **pipeline đo-và-bắn cùng một phía** cho nhánh chuột còn lại: `DOM.scrollIntoViewIfNeeded({objectId})` → `DOM.getContentQuads({objectId})` → `Input.dispatchMouseEvent` — ba lệnh cùng kênh `chrome.debugger`, khe hở 20ms co về ~1–2ms. Đây chính là cách Puppeteer click. Chi tiết ở Q04.

Đề xuất thực dụng: giữ `el.focus()` + xác minh `activeElement` theo `getRootNode()` (đúng cách, kể cả shadow DOM) làm đường chính vì nó chạy rồi và đơn giản; ghi objectId pipeline vào kiến trúc làm đường nâng cấp cho nhánh chuột và iframe.

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Điểm làm đổi nhiều nhất: `focus`/`focusin` từ `el.focus()` là `isTrusted: true`.** Tôi đã hỏi câu này dựa trên một tiền đề sai của chính mình (mục 2: "chỉ riêng sự kiện `focus` là programmatic, `isTrusted: false`"). Hoá ra `el.click()` mới là ngoại lệ được spec đặc tả riêng, còn `focus()` chạy focusing steps và UA tự phát sự kiện. Nghĩa là đường bàn phím **không đưa sự kiện untrusted nào vào trang** — mạnh hơn hẳn thứ tôi tưởng mình đang đánh đổi.

**Đã đổi trong mã:**

- `plan.ts` — thêm `focusElement()`: `scrollIntoView` → `el.focus({preventScroll:true})` → xác minh `getRootNode().activeElement === el`, sai thì `PlanError`. Mọi ô của form đi qua đây.
- `plan.ts` — bỏ hẳn `focusFirstSegment()` (click mép trái + ArrowLeft) và `focusSelectByLabel()` (click nhãn, fallback mở popup rồi Escape). Cái sau là nguy hiểm nhất trong mã cũ: nó *cố ý* mở popup native — thứ Q03 cảnh báo có thể treo cả phiên.
- `plan.ts` — checkbox/radio chuyển từ click sang `focus()` + Space; submit chuyển sang `focus()` + Enter.
- `planElement()` action mặc định: phần tử focus được → Enter; chỉ phần tử **không** focus được mới còn click theo toạ độ (`isKeyboardOperable()`).
- Ghi INVARIANT về user activation vào đầu `plan.ts`: `Input.insertText` không phải keydown nên không tự cấp activation; mọi chuỗi phải có ít nhất một phím thật trước bước cần activation. Hôm nay đúng nhờ Ctrl+A mở đầu — ghi ra để không ai "tối ưu" mất nó.

**Câu 4 (thêm cú click hoàn thiện dấu vết): không làm.** Lý do quyết định không phải "vô ích" mà là "có hại": click vào input đặt lại caret theo vị trí điểm, phá select-all vừa làm. Nguyên tắc rút ra và đã áp dụng — mỗi phần tử một đường tương tác duy nhất, không trộn.

**Câu 3 (stealth): chốt không làm, và ghi thành ranh giới sản phẩm.** Một số site chống bot sẽ chặn agent; đó là hệ quả chấp nhận được của việc công khai danh tính.

**Câu 5 (objectId pipeline): ghi vào kiến trúc §2.2 làm đường nâng cấp, chưa hiện thực.** Ở mô hình bàn phím hiện tại nhánh chuột đã thu hẹp còn canvas + phần tử không focus được, nên lợi ích chưa đủ để trả chi phí `Runtime.enable` + nhận diện isolated world. Sẽ cần khi làm iframe (§5.3) hoặc M6 canvas — đó mới là lúc nó thật sự trả lời một bài toán chứ không chỉ tối ưu một con số.

**Đã xác minh bằng một dòng log như chuyên gia đề nghị:** `booking.js` giờ ghi `isTrusted` của `focusin` và có máy ghi sự kiện với khẳng định âm (không sự kiện tương tác nào được `isTrusted === false`).
