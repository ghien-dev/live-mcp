---
id: Q04
tiêu_đề: Khe hở giữa lúc đo toạ độ và lúc dispatch
trạng_thái: đang-áp-dụng
mức_độ_chặn: quan-trọng
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - Q01
  - docs/livemcp-architecture.md §2.2, §5.3 (iframe offset)
  - packages/extension/src/content/plan.ts
  - packages/extension/src/sw/cdp.ts
---

## 1. Khó khăn

Kiến trúc phân vai: **content script** sống trong trang nên đo được toạ độ; **service worker** giữ kết nối `chrome.debugger` nên dispatch được CDP. Hai nơi khác nhau, nói chuyện qua `chrome.runtime.sendMessage`.

Hệ quả: giữa lúc `getBoundingClientRect()` chạy và lúc `Input.dispatchMouseEvent` tới nơi có một khoảng trống — đo thực tế khoảng 20ms, đôi khi hơn. Bất cứ thứ gì làm dịch layout trong khoảng đó — ảnh vừa tải xong, font vừa đổi, animation, sticky header co lại, banner cookie xuất hiện — đều biến toạ độ đúng thành toạ độ sai.

Đây không phải giả thuyết. Một phiên bản nặng hơn của đúng vấn đề này vừa gây ra lỗi tốn nhiều thời gian: chúng tôi đo toạ độ cả form trong một mẻ rồi mới dispatch, và mỗi phép đo lại gọi `scrollIntoView` làm sai toạ độ đo trước đó.

## 2. Tôi đã suy nghĩ và thử những gì

**Đã sửa — không đo cả mẻ nữa.** Viết lại thành máy trạng thái điền từng ô một: mỗi lượt content script chỉ đo đúng một phần tử, service worker dispatch ngay, rồi content script xác minh kết quả trước khi lượt sau bắt đầu. Khe hở từ "cả form" thu về "một phần tử".

**Đã thêm — kiểm `elementFromPoint` trước mỗi click.** Content script kiểm điểm sắp click có thật sự rơi vào phần tử đang nhắm không (có xử lý shadow root bằng cách dùng `elementFromPoint` của root tương ứng). Trượt thì `throw`, huỷ hành động, báo lỗi chỉ đích danh phần tử bị trúng nhầm. Đây là kiểm ở **thời điểm đo**, nên nó bắt được layout đã sai từ trước, nhưng **không** bắt được layout dịch trong 20ms sau đó.

**Đã chuyển phần lớn sang bàn phím.** Theo hướng ở [Q01](Q01-focus-thay-click.md), việc điền form không còn cần toạ độ. Nhưng canvas, hover, drag, scroll, và `livemcp-action="click"` trên phần tử không focus được thì vẫn phải dùng chuột — nên vấn đề này không biến mất, chỉ thu hẹp.

**Biết nhưng chưa áp dụng — stability check của Playwright.** Tôi biết Playwright đợi bounding box giống hệt nhau qua hai animation frame liên tiếp rồi mới click. Chưa áp dụng vì chưa rõ nó có đủ không, và vì `requestAnimationFrame` bị đóng băng khi tab ở nền hoặc cửa sổ bị che — đúng trạng thái bình thường khi agent làm việc còn người dùng nhìn chỗ khác. Chúng tôi đã phải bỏ rAF ở một chỗ khác vì lý do này và thay bằng `MessageChannel`.

## 3. Hướng tôi đang định làm

Giữ nguyên: đo từng phần tử ngay trước khi dùng + kiểm `elementFromPoint` + huỷ khi trượt.

Đang cân nhắc thêm stability check, nhưng vướng chuyện rAF không chạy khi tab ở nền. Chưa có phương án thay thế mà tôi tin.

## 4. Câu hỏi cụ thể

1. **Stability check kiểu Playwright có phải chuẩn mực nên áp dụng không?** Và nếu `requestAnimationFrame` không chạy được (tab ở nền, cửa sổ bị che) thì lấy gì thay? Chúng tôi đã dùng `MessageChannel` để nhường một macrotask không bị throttle — nhưng nó không đồng bộ với chu kỳ vẽ, nên không rõ có dùng để đo độ ổn định layout được không.

2. **`DOM.getContentQuads` gọi từ service worker có ưu điểm gì hơn `getBoundingClientRect()` gọi từ content script?** Cụ thể với phần tử có CSS transform, phần tử bị clip bởi `overflow`, hoặc inline element trải trên nhiều dòng. Và quan trọng hơn: gọi từ service worker có **rút ngắn được khe hở** không, vì đo và dispatch cùng nằm một phía?

3. **Có cách nào đáng tin hơn `elementFromPoint` để biết phần tử có bị thứ khác che không?** `elementFromPoint` trả về phần tử trên cùng tại một điểm, nhưng phần tử có thể bị che một phần — điểm giữa thông thoáng trong khi phần lớn diện tích bị phủ, hoặc ngược lại.

4. **Với phần tử trong iframe hoặc shadow DOM, cộng offset thế nào cho đúng hệ toạ độ mà CDP mong đợi?** Tài liệu kiến trúc của chúng tôi (§5.3) ghi là phải cộng offset của iframe trong viewport tab, nhưng tôi chưa hiện thực và chưa rõ có cạm bẫy gì với iframe lồng nhau, iframe có transform, hay iframe cross-origin.

5. **Page zoom và device pixel ratio.** `getBoundingClientRect()` trả CSS pixel; `Input.dispatchMouseEvent` mong đợi gì? Chúng có luôn khớp nhau ở mọi mức zoom và mọi mức Windows display scaling không? Đây là chỗ tôi từng nghi ngờ trong quá trình gỡ lỗi nhưng chưa xác minh được.

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

Câu trả lời lớn trước, vì nó đổi khung cả năm câu nhỏ: **chuyển phép đo sang phía service worker.** Khe hở 20ms của bạn không phải hằng số tự nhiên — nó là chi phí của hai chặng `chrome.runtime.sendMessage` giữa đo và bắn. Dùng cơ chế objectId-không-cần-selector (Q01 câu 5), pipeline trở thành: `DOM.scrollIntoViewIfNeeded({objectId})` → `DOM.getContentQuads({objectId})` → `Input.dispatchMouseEvent` — ba lệnh trên cùng kênh `chrome.debugger`, đo và bắn cùng một phía, khe hở còn ~1–2ms. Đây chính là cách Puppeteer click. Khe hở không bao giờ về 0 — nhưng thu mười lần và loại bỏ chặng message là thay đổi cấp bậc, không phải tinh chỉnh.

**Câu 1 — stability check: đúng là chuẩn mực, và có bản thay thế không cần rAF.** Trực giác của bạn về rAF là đúng — nó đóng băng khi tab bị che, đúng trạng thái làm việc của agent. Nhưng có một sự thật ít người biết cứu bạn: **layout tính-theo-yêu-cầu vẫn chạy trong tab nền.** Thứ bị throttle là rendering pipeline và rAF *callback*; còn `getBoundingClientRect()` / `getContentQuads` ép tính layout đồng bộ bất kể trạng thái tab. Vậy bản thay thế là: **đo hai lần cách nhau ~30–50ms bằng chính phép đo toạ độ, bằng nhau thì bắn** — cùng ý tưởng Playwright ("hai frame giống nhau") nhưng không mượn đồng hồ của trang. `unthrottle()` của bạn (setFocusEmulationEnabled + setWebLifecycleState) có làm dịu throttle, nhưng đừng dựa vào nó để tin rAF; double-measure đứng vững độc lập với trạng thái tab. Lưu ý phạm vi: chỉ trả phí này cho **nhánh chuột** — nhánh bàn phím (giờ là mặc định) miễn nhiễm toạ độ, thêm stability check cho nó là phí vô ích.

**Câu 2 — `getContentQuads` hơn `getBoundingClientRect` ở ba chỗ thật:**
- **Transform:** quads trả tứ giác thật (xoay/scale); bbox là hình chữ nhật thẳng trục *bao ngoài* — tâm bbox của phần tử xoay có thể nằm **ngoài** phần tử. Hôm nay `assertHits` cứu bạn khỏi ca này (bằng cách từ chối); quads cho điểm đúng ngay từ đầu.
- **Inline element ngắt dòng:** nhiều quad — click tâm quad đầu tiên, thay vì tâm bbox vốn có thể rơi vào *khe giữa hai dòng* của một link wrap.
- **Không bị clip bởi overflow:** giống bbox, quads không tự trừ phần bị cắt — vẫn phải tự intersect với viewport rồi mới lấy tâm (Puppeteer làm đúng thế; làm theo).

Và có — lợi ích lớn nhất chính là điều bạn hỏi cuối: gọi từ SW đặt đo và bắn cùng phía, thu khe hở như đã nói ở đầu.

**Câu 3 — `elementFromPoint` tại tâm là đúng-và-đủ cho mục đích này, đừng phức tạp hoá phía trước — hãy gia cố phía sau.** Phân tích ca: "tâm thoáng nhưng 80% diện tích bị che" → click vào tâm vẫn *trúng* phần tử → hành động thành công, không có gì để chặn. Ca nguy hiểm duy nhất là *tâm bị che* — đúng ca `elementFromPoint` bắt được. Sample nhiều điểm chỉ thêm chi phí cho một rủi ro không tồn tại. Nâng cấp thật sự đáng giá nằm ở **xác minh sau sự kiện**: content script gắn listener capture tạm thời, ghi lại `target` thật của cú `mousedown` vừa dispatch, so với phần tử nhắm — sai thì dừng chuỗi ngay. Đây là kiểm tại thời điểm *thật* thay vì thời điểm đo, đóng nốt phần khe hở còn lại; Playwright làm chính xác trò này (họ gọi là hit target interceptor). Phiên bản SW-side tương đương của elementFromPoint là `DOM.getNodeForLocation`, tiện khi bạn chuyển đo sang SW.

**Câu 4 — shadow DOM: không có gì để cộng; iframe: đừng tự cộng.**
- Shadow DOM không tạo hệ toạ độ mới — `getBoundingClientRect`/quads đã ở toạ độ viewport của frame. Xong.
- Phép cộng offset iframe thủ công chết ở bốn chỗ: gốc document con nằm ở **content box** (phải cộng cả border lẫn padding của iframe, không chỉ `rect.left`); iframe lồng nhau đòi cộng đệ quy; iframe có **transform/zoom** làm CSS px của frame con ≠ CSS px của frame cha — lúc đó phép cộng sai *về bản chất* chứ không phải sai số; và cross-origin thì `frameElement` là null, content script của frame con không tự biết mình nằm đâu. Lời giải: **đo bằng `DOM.getContentQuads` từ session top-level** — với same-process iframe, quads trả về theo hệ toạ độ viewport chính, đúng thứ `Input.dispatchMouseEvent` cần, miễn cộng trừ. Với OOPIF (cross-origin khác process) phải attach session cho frame đó (`Target.setAutoAttach` flatten qua `chrome.debugger`) và hành vi từng thay đổi giữa các bản Chrome — đây là chỗ tôi khuyên viết một ca E2E riêng (Q05) thay vì tin bất kỳ tài liệu nào, kể cả đoạn này.
- Thứ tự triển khai: same-origin iframe qua quads trước (phủ đại đa số form nhúng thực tế); OOPIF để sau, có test rồi mới làm.

**Câu 5 — zoom/DPR: cùng đơn vị trên lý thuyết, một probe 5 dòng trên thực tế.** `Input.dispatchMouseEvent` nhận **CSS pixel theo viewport chính** — cùng đơn vị `getBoundingClientRect`. Windows display scaling / DPR *không* ảnh hưởng: quy đổi sang physical px xảy ra bên dưới API, không phải việc của bạn. Page zoom (Ctrl+±) về nguyên tắc cũng bảo toàn CSS px ở cả hai phía; *thực tế* lịch sử Chromium từng có bug lệch toạ độ input CDP khi zoom ≠ 100%. Theo đúng triết lý probe ngày của bạn: khi attach, dispatch một cú click vào phần tử mốc do extension tạo, listener ghi `clientX/Y`, so với toạ độ đã đo — khớp thì tin cả phiên; lệch thì báo "mức zoom này không được hỗ trợ" rõ ràng thay vì click trượt im lặng. Đo, đừng tin — kể cả tin tôi.

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Sự thật gỡ được nút thắt của tôi:** rAF bị đóng băng ở tab nền, nhưng **layout tính-theo-yêu-cầu thì không**. Thứ bị throttle là rendering pipeline và rAF *callback*; `getBoundingClientRect()` vẫn ép tính layout đồng bộ bất kể trạng thái tab. Tôi đã bỏ stability check chỉ vì tưởng nó buộc phải cưỡi trên rAF — hoá ra chỉ cần **lấy chính phép đo làm đồng hồ** thay vì mượn nhịp vẽ của trang.

**Đã đổi trong mã:**

- `plan.ts` — `rectOf()` → `stableRect()`: đo hai lần cách nhau 40ms, khác nhau thì đo lại, tối đa 4 lần rồi `PlanError`. Không dùng rAF, nên đứng vững độc lập với trạng thái tab.
- `plan.ts` + `index.ts` — **hit target interceptor**: `armHitCheck()` gắn listener capture `mousedown` trước khi dispatch, `hitCheckError()` đối chiếu `composedPath()[0]` sau khi dispatch. Đây là điểm tôi đánh giá cao nhất trong câu trả lời: nó chuyển từ kiểm *tại thời điểm đo* sang kiểm *tại thời điểm thật*, bịt nốt phần khe hở mà `elementFromPoint` về nguyên tắc không thể chạm tới.
- Chỉ trả phí này cho **nhánh chuột**. Sau Q01, nhánh bàn phím là mặc định và miễn nhiễm toạ độ — thêm stability check cho nó là phí vô ích. Ghi rõ phạm vi trong kiến trúc §2.2.

**Câu 3 — giữ nguyên `elementFromPoint` tại tâm, và không phức tạp hoá.** Phân tích ca của chuyên gia thuyết phục: "tâm thoáng nhưng 80% diện tích bị che" thì click vào tâm vẫn *trúng*, không có gì để chặn; ca nguy hiểm duy nhất là *tâm bị che* — đúng ca hiện tại đã bắt được. Sample nhiều điểm là thêm chi phí cho một rủi ro không tồn tại. Tôi đã định làm việc đó và đã bỏ.

**Câu 4 — đã sửa `docs/livemcp-architecture.md` §5.3, và nó vốn đang SAI.** Tài liệu cũ ghi "toạ độ phải cộng offset của iframe trong trang cha". Chuyên gia chỉ ra phép cộng thủ công chết ở bốn chỗ, trong đó nặng nhất: iframe có transform/zoom làm CSS px của frame con ≠ CSS px của frame cha — lúc đó phép cộng **sai về bản chất**, không phải sai số. Đã thay bằng "đo bằng `DOM.getContentQuads` từ session top-level". May là chưa hiện thực phần này, nên đây là sửa tài liệu chứ chưa phải sửa lỗi.

Cũng đã ghi thêm: shadow DOM **không** tạo hệ toạ độ mới — chỗ duy nhất nó khác là `activeElement`/`elementFromPoint` phải hỏi `getRootNode()`.

**Đường nâng cấp lớn (đo và bắn cùng phía qua objectId): đã ghi vào §2.2, chưa làm.** Sau Q01 nhánh chuột thu hẹp còn canvas + phần tử không focus được, nên khe hở 20ms không còn là đường chính. Sẽ làm khi đụng iframe hoặc M6 canvas — lúc đó nó giải một bài toán mới, không chỉ tối ưu một con số.

**Còn treo — câu 5 (zoom/DPR).** Chuyên gia xác nhận cùng đơn vị CSS px về lý thuyết, nhưng nhắc lịch sử Chromium từng có bug lệch toạ độ khi zoom ≠ 100%, và đề nghị một probe click 5 dòng lúc attach. Chưa làm: nhánh chuột hiện chỉ còn `planElement`, và nghiệm thu M1 đi hoàn toàn bằng bàn phím. Ghi vào việc cần làm trước M6.
