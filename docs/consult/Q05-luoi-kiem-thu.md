---
id: Q05
tiêu_đề: Dựng lưới kiểm thử cho extension + CDP
trạng_thái: đã-trả-lời
mức_độ_chặn: quan-trọng
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - Q04
  - packages/extension/src/sw/cdp.ts
---

## 1. Khó khăn

Lỗi toạ độ vừa qua tốn nhiều lượt sửa sai mới tìm ra, và **không một unit test nào có thể bắt được nó**. Lý do: jsdom và happy-dom trả `getBoundingClientRect()` toàn số 0 và không có layout thật. Test sẽ xanh trong khi sản phẩm hỏng — loại test tệ hơn không có test, vì nó tạo cảm giác an toàn giả.

Chủ dự án đã nói thẳng rằng cần một cơ chế kiểm tra, và họ đúng. Nhưng hệ thống này có năm lớp bất đồng bộ (agent ↔ MCP stdio ↔ server ↔ WebSocket ↔ service worker ↔ CDP ↔ DOM), nên một lưới E2E đầy đủ rất dễ trở nên nặng tới mức không ai chạy — mà lưới không ai chạy thì cũng bằng không.

## 2. Tôi đã suy nghĩ và thử những gì

**Đã có và vẫn giữ — 19 unit test cho logic thuần.** Chuyển đổi HTML → JSON Schema, định tuyến tên tool, suy luận thứ tự segment ngày. Đây là những chỗ nhiều nhánh, sai lặng lẽ, và không cần browser. Chúng có giá trị thật: một test trong số đó đã bắt được lỗi định tuyến namespace, và tôi đã kiểm chứng nó **đỏ trên mã cũ** trước khi tin.

**Đã làm và thấy hiệu quả — harness chạy bằng Node.** Giả lập extension nối vào WebSocket và giả lập agent nói MCP qua stdio. Nhờ nó mà khoanh được lỗi "ở lớp browser hay không ở lớp browser" mà không cần mở Chrome. Đã tìm ra một lỗi thật (đụng namespace giữa tool hệ thống và tool của site).

**Đã đặt vào đường chạy production thay vì test — ba lớp tự kiểm.** `focusElement()` xác minh focus vào đúng phần tử; `assertHits()` xác minh điểm click; và xác minh giá trị từng ô ngay sau khi gõ, sai thì sửa hoặc dừng chứ không bao giờ submit form sai. Đây là phản ứng trực tiếp với việc lỗi vừa rồi hỏng *im lặng*.

**Chưa làm — Playwright.** Chỉ thị của chủ dự án là không tự ý dựng browser thật; phải hỏi trước. Và tôi cũng có một nghi ngờ kỹ thuật thật sự khiến chưa dám đề xuất chắc chắn (câu 1 bên dưới).

## 3. Hướng tôi đang định làm

Chưa quyết. Tôi nghiêng về: giữ unit test cho logic thuần, giữ harness Node cho lớp giao thức, và thêm **một** kịch bản E2E thật sự chạy trên Chrome cho luồng điền form — nhưng chỉ khi câu hỏi 1 dưới đây có lời giải.

## 4. Câu hỏi cụ thể

1. **Đây là câu chặn:** Playwright nạp được MV3 unpacked extension qua persistent context. Nhưng extension của chúng tôi gọi `chrome.debugger.attach` vào tab, còn Playwright cũng điều khiển trình duyệt qua CDP. **Hai bên có đụng nhau kiểu "Another debugger is already attached to the tab" không?** Nếu có thì kiến trúc test phải xoay thế nào — Playwright chỉ mở trang và quan sát, còn mọi thao tác để extension tự làm? Hay có cách chia session CDP?

2. **Truy cập và kiểm service worker MV3 trong Playwright hiện đã ổn định chưa?** Tôi cần đọc được log và trạng thái của service worker để biết nó chết lúc nào, nhưng nhớ mang máng rằng phần này từng phải lách.

3. **Có mẫu nào để tự động kiểm `isTrusted: true` không?** Đây là thứ cả triết lý dự án đặt cược vào, nên nó xứng đáng có lưới bảo vệ tự động chứ không chỉ kiểm bằng mắt. Hiện trang demo của chúng tôi ghi log `isTrusted` của từng sự kiện `change` — cách này có đủ tin cậy để dựng assertion không?

4. **Đặt lưới ở đâu cho đáng công với hệ thống nhiều lớp bất đồng bộ như thế này?** Vài E2E sâu chạy chậm, hay contract test dày ở ranh giới content script ↔ service worker? Kinh nghiệm thực chiến nghiêng về đâu, và có loại lỗi nào mà E2E bắt được còn contract test thì không (hoặc ngược lại) đáng để biết trước?

5. **Có cách nào kiểm được lớp layout mà không cần cả một browser thật không** — kiểu jsdom có layout engine, hoặc một môi trường trung gian nào đó? Hay đó là ảo tưởng và cứ browser thật hoặc không gì cả?

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

**Câu 1 — câu chặn của bạn ít chặn hơn bạn nghĩ, vì hai lý do độc lập.**

Thứ nhất, về kỹ thuật: từ Chrome 63, DevTools protocol là **multi-client** — Playwright (nối qua pipe/port riêng) và `chrome.debugger` (extension API) là hai client với session riêng biệt trên cùng target, đồng tồn tại được. Lỗi "Another debugger is already attached" ngày nay chủ yếu xảy ra giữa *hai extension* cùng gọi `chrome.debugger`, không phải giữa extension và CDP client bên ngoài. Tôi đánh giá rủi ro đụng độ là thấp — nhưng đừng lấy lời tôi làm bảo hiểm: hãy để chính lưới trả lời. Ca E2E *đầu tiên* nên là smoke test "attach được không": Playwright mở trang → extension attach → dispatch một phím → assert kết quả. Bản Chrome nào phá vỡ điều này, CI đỏ và bạn biết trong ngày.

Thứ hai, và quan trọng hơn: **kiến trúc đúng làm câu hỏi này gần như biến mất — Playwright chỉ dựng rạp và quan sát, không bao giờ diễn.** Playwright: khởi động Chrome (`launchPersistentContext` + load extension unpacked), serve trang test, cuối cùng đọc DOM/recorder để assert. Mọi *thao tác* đi qua đường sản phẩm thật: harness MCP giả (bạn có sẵn) → server → WebSocket → extension → CDP. Nếu để Playwright click/gõ hộ thì bài test không còn kiểm sản phẩm nữa — nó kiểm Playwright. Với vai passive, Playwright không gửi lệnh `Input` nào, hai bên không giẫm chân nhau bất kể multi-client có kẽ hở gì.

**Câu 2 — đã ổn định từ lâu.** `context.serviceWorkers()` / `context.waitForEvent('serviceworker')` bắt được SW của extension, `worker.evaluate()` đọc được trạng thái bên trong. Console của SW không stream tiện như page — mẫu thực dụng: SW tự ghi log vào ring buffer trong biến module (hoặc `chrome.storage.session`), test đọc qua `worker.evaluate`. Và vì bạn nhắc "biết SW chết lúc nào": MV3 SW bị tắt sau ~30s idle — lưới NÊN có một ca *cố tình* chờ SW chết rồi kiểm hành vi tái sinh + tái attach debugger. Đó là loại lỗi chỉ E2E thấy được, và là loại sẽ cắn người dùng thật đầu tiên. Bonus cho CI: headless mới (hợp nhất từ ~Chrome 112) chạy được extension — lưới này lên CI không cần màn hình.

**Câu 3 — recorder trang test là đủ tin cậy, nâng nó thành fixture chính thức.** `isTrusted` là thuộc tính readonly do UA gán khi dispatch, trang không giả mạo được — listener capture-phase đọc là giá trị thật. Mẫu: trang test gắn listener cho `change`/`input`/`click`/`keydown`/`focusin`, ghi `{type, isTrusted, targetName}` vào mảng; test assert. Thêm một **assertion âm tính** đáng giá hơn assertion dương: sau khi điền xong form, *không tồn tại* sự kiện tương tác nào `isTrusted === false` trong recorder. Nó sẽ bắt được cái ngày ai đó lỡ thêm một `dispatchEvent` "chỉ lần này thôi" — đúng loại xói mòn triết lý mà không review mắt nào thấy.

**Câu 4 — hình dạng lưới cho hệ này, xếp theo loại lỗi đã thực sự xảy ra:**

- Giữ 19 unit test logic thuần — đúng vị trí, đúng tiêu chí (nhiều nhánh, sai lặng lẽ, không cần browser).
- Giữ harness Node làm contract test lớp giao thức — nó đã tự chứng minh (bắt lỗi namespace). Lớp này bắt: schema drift, routing, vòng đời message.
- Thêm **ít** E2E thật (3–6 ca) trên Chrome thật. Lý do quyết định nằm trong chính trải nghiệm của bạn: lỗi đau nhất (toạ độ/layout/focus) sống *trong* browser — mọi contract test với DOM giả đều mù trước nó, vì DOM giả chính là kẻ nói dối `getBoundingClientRect`. E2E là tầng **duy nhất** thấy lớp lỗi này; đó là câu trả lời cho "loại lỗi nào E2E bắt được mà contract không": tất cả những gì cần layout, focus thật, CDP thật, locale thật.
- Danh sách ca đề xuất: (1) điền form đủ loại ô + submit + assert recorder toàn trusted; (2) form trong shadow DOM; (3) **đường fail**: phần tử bị che phải ra lỗi rõ ràng, không gõ nhầm — bạn vừa đầu tư vào đường fail, nó xứng đáng có lưới; (4) SW chết giữa phiên → tái sinh; (5) **locale ngày**: chạy `launchPersistentContext` với `--lang=en-US` / `vi` / `de-DE` — thứ tự segment của date input đi theo UI locale, tức ma trận locale "không test được" hoá ra test được bằng một tham số dòng lệnh. Ca (5) nâng probe của Q02 từ "tin là đúng" thành "được chứng minh trên ba locale".
- Kỷ luật sống còn, bạn đã tự nói ra: *lưới không ai chạy bằng không*. Toàn bộ E2E phải chạy bằng một lệnh, xong dưới ~60 giây, không setup tay. Lưới chết vì ma sát, không phải vì thiếu ca.

**Câu 5 — không, và đừng đi tìm.** "jsdom có layout engine" không tồn tại ở mức tin được; mọi tầng giả layout sẽ tái tạo đúng loại test-xanh-sản-phẩm-hỏng bạn vừa gọi tên. Trung gian *thật* duy nhất là: Chrome for Testing + headless mới — vẫn là browser thật (nên đáng tin) nhưng nhẹ và CI-được. Browser chính là layout engine: thuê nó, đừng giả nó.

*(Ghi chú quy trình: phần trên là thiết kế lưới, không phải lệnh thực thi — theo chỉ thị dự án, việc thực sự dựng Playwright/browser thật vẫn cần chủ dự án gật đầu trước.)*

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Đã làm ngay (không cần browser thật):**

- `booking.js` — dựng **máy ghi sự kiện** thành fixture chính thức: listener capture cho `focusin`/`keydown`/`click`/`input`/`change`/`submit`, ghi `{type, isTrusted, target}` vào `window.__livemcpEvents`. Khẳng định **âm tính** như chuyên gia đề nghị (không tồn tại sự kiện tương tác nào `isTrusted === false`) hiện in cảnh báo ngay trên trang; khi có Playwright thì nó thành assertion. Đúng như nhận xét: nó bắt được cái ngày ai đó lỡ thêm một `dispatchEvent` "chỉ lần này thôi" — loại xói mòn triết lý mà không review bằng mắt nào thấy.
- Thêm log `isTrusted` của `focusin` — xác minh trực tiếp khẳng định trung tâm của Q01 (`el.focus()` sinh sự kiện trusted), đúng lời khuyên "mất một phút, đừng lấy lời tôi làm bảo hiểm".
- `plan.test.ts` — test cho `arrowSteps` (điều hướng select). Đủ tiêu chí "nhiều nhánh, sai lặng lẽ, không cần browser". Để test được thuần, đã tách `arrowSteps` thành hàm số học thuần `(count, from, to)` thay vì nhận `HTMLSelectElement` — refactor này tự nó cũng làm mã sạch hơn.

**Chưa làm — Playwright.** Chỉ thị dự án là không tự dựng browser thật, và chính chuyên gia cũng ghi chú lại điều đó ở cuối câu trả lời. **Cần chủ dự án gật đầu.** Thiết kế đã sẵn sàng, đây là những gì sẽ dựng:

| # | Ca | Bắt được lớp lỗi nào |
|---|---|---|
| 0 | Smoke: Playwright mở trang → extension attach → dispatch một phím | Chrome bản mới phá vỡ multi-client CDP |
| 1 | Điền form đủ loại ô + submit + assert recorder toàn trusted | hồi quy toàn tuyến |
| 2 | Form trong shadow DOM | `activeElement`/`elementFromPoint` sai root |
| 3 | **Đường fail**: phần tử bị che phải ra lỗi rõ, không gõ nhầm | chính lớp lỗi vừa tốn nhiều lượt gỡ |
| 4 | SW chết giữa phiên → tái sinh + tái attach | MV3 ~30s idle |
| 5 | `--lang=en-US` / `vi` / `de-DE` | thứ tự segment ngày trên ba locale |

Ca (5) là thứ tôi đánh giá cao nhất và không tự nghĩ ra: ma trận locale tôi tưởng "không test được" hoá ra test được bằng **một tham số dòng lệnh**. Nó nâng phép dò của Q02 từ "tin là đúng" thành "được chứng minh trên ba locale".

Ca (3) cũng đáng nói: tôi vừa đầu tư nhiều vào đường fail (`focusElement` xác minh, `assertHits`, hit target interceptor, xác minh từng ô) mà chưa có gì bảo vệ chính đường fail đó khỏi hồi quy.

**Câu 1 — nỗi lo chặn của tôi được gỡ theo hai đường độc lập**, và đường thứ hai mới là đường đúng: **kiến trúc test đúng làm câu hỏi biến mất.** Playwright chỉ dựng rạp và quan sát, mọi thao tác đi qua đường sản phẩm thật (harness MCP → server → WS → extension → CDP). Nếu để Playwright click hộ thì bài test không còn kiểm sản phẩm nữa — nó kiểm Playwright. Với vai passive, Playwright không gửi lệnh `Input` nào nên hai bên không giẫm chân nhau bất kể multi-client có kẽ hở gì.

**Câu 5 — "browser chính là layout engine: thuê nó, đừng giả nó."** Đã bỏ ý định tìm môi trường trung gian có layout. Mọi tầng giả layout sẽ tái tạo đúng loại test-xanh-sản-phẩm-hỏng mà tôi đang muốn tránh.

**Kỷ luật đã chốt trước khi viết dòng Playwright nào:** toàn bộ E2E chạy bằng một lệnh, xong dưới ~60 giây, không setup tay. Lưới chết vì ma sát, không phải vì thiếu ca.
