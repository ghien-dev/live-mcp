---
id: Q03
tiêu_đề: select và popup native ngoài tầm CDP
trạng_thái: đang-áp-dụng
mức_độ_chặn: quan-trọng
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - Q01
  - packages/extension/src/content/plan.ts
---

## 1. Khó khăn

Popup của `<select>` là **cửa sổ native của trình duyệt**, không phải DOM. Sự kiện CDP dispatch vào viewport của trang không tới được nó. Nghĩa là cách làm tự nhiên nhất — click mở dropdown rồi click chọn option — bất khả thi trong khuôn khổ "chỉ dùng trusted event".

Đây là chỗ Playwright và Puppeteer đều bỏ cuộc và chuyển sang gọi JavaScript (`selectOption` set `.value` rồi bắn `change` nhân tạo). Nhưng dự án này cấm đúng điều đó: triết lý là *không gọi JavaScript của trang*, và sự kiện nhân tạo có `isTrusted: false`.

## 2. Tôi đã suy nghĩ và thử những gì

**Đã loại trừ — mở popup rồi click option.** Không có đường CDP nào tới được cửa sổ native.

**Đã loại trừ — set `.value` + `dispatchEvent(new Event('change'))`.** Đúng cách Playwright làm, và đúng thứ triết lý dự án bác bỏ. Sự kiện có `isTrusted: false`.

**Đang dùng — làm như người dùng bàn phím.** Focus vào select (không mở popup), rồi bấm ArrowUp/ArrowDown theo chênh lệch giữa index hiện tại và index đích. Trên Chrome, mũi tên ở select **đang đóng** đổi lựa chọn ngay tại chỗ.

**Chỗ tôi đang lo mà chưa kiểm chứng:** nếu mỗi lần bấm mũi tên đều phát `change`, thì đi từ option 1 tới option 8 sẽ phát bảy sự kiện `change`. Một trang thật nghe `change` để gọi API (đổi khu vực → tải lại khung giờ trống) sẽ bị gọi bảy lần, sáu lần trong đó là rác. Với thao tác có hệ quả thật — đổi địa chỉ giao hàng, đổi phương thức thanh toán — đó không chỉ là lãng phí.

**Đã cân nhắc — type-ahead.** Gõ tiền tố nhãn của option (`"Ngo"` để tới "Ngoài trời"). Về lý thuyết chỉ phát một `change`. Nhưng tôi không rõ nó xử lý ra sao khi nhiều option trùng tiền tố, và nó có phụ thuộc vào khoảng cách thời gian giữa các phím không (cơ chế type-ahead thường có timeout gộp phím).

## 3. Hướng tôi đang định làm

Giữ cách mũi tên làm mặc định vì đã chạy được, nhưng chuyển sang type-ahead nếu nó thực sự an toàn hơn về số lượng sự kiện `change`.

Kèm theo: xác minh `.value` sau khi chọn, sai thì báo lỗi rõ ràng thay vì submit bừa.

## 4. Câu hỏi cụ thể

1. **Trên Chrome/Windows, mỗi lần ArrowDown ở `<select>` đang đóng có phát `change` không, hay chỉ phát một lần khi select mất focus?** Nếu phát mỗi lần thì có mẫu nào tránh mà vẫn không phải mở popup?

2. **Type-ahead có an toàn hơn không?** Cụ thể: nó phát bao nhiêu sự kiện `change`, xử lý thế nào khi nhiều option trùng tiền tố, và có phụ thuộc timing giữa các phím không? Nếu có timeout gộp phím thì con số đó là bao nhiêu và có ổn định không?

3. **Có đường CDP nào chạm được vào popup native không** — kể cả không chính thống, kể cả phụ thuộc nền tảng? Tôi hỏi để biết chắc là không, chứ không phải để đi đường vòng.

4. **`<select multiple>` và `<optgroup>` cần lưu ý gì thêm?** Với `multiple`, chọn nhiều mục bằng bàn phím (Ctrl+mũi tên, Space) hoạt động thế nào qua CDP?

5. **Câu hỏi rộng hơn:** với một chuẩn declarative đang được thiết kế mới, có nên khuyến nghị dev dùng radio group hoặc listbox ARIA thay cho `<select>` native khi muốn thân thiện với agent không? Hay `<select>` vẫn nên là công dân hạng nhất và chúng tôi phải giải cho bằng được?

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

**Câu 1 — có, mỗi lần bấm phát một cặp `input` + `change` ngay lập tức** (Chrome trên Windows/Linux; select đang đóng, mũi tên đổi selection tại chỗ). Nỗi lo "bảy change rác" là có thật. Nhưng trước khi tìm cách né, hãy định khung lại: **đây chính xác là chuỗi sự kiện một người dùng bàn phím thật tạo ra.** Site nào bắn API không debounce theo từng `change` của select thì đã hỏng với người dùng bàn phím từ trước khi agent tồn tại. Triết lý "y như con người" ngụ ý chấp nhận cả những hệ quả xấu xí của hành vi con người — lời giải đúng tầng không nằm ở extension mà nằm ở chuẩn: ghi thành yêu cầu conformance *"trang phải coi `change` là tạm thời; hiệu lực chỉ xảy ra ở hành động commit tường minh (submit)"* — chi tiết ở Q06.

Giảm thiểu thực dụng trong khuôn trusted, đáng làm vì rẻ: **Home/End nhảy về option đầu/cuối bằng một lần bấm** (một `change`), rồi mũi tên đi nốt — số change giảm từ |Δindex| về khoảng cách tới đầu/cuối gần hơn.

**Cảnh báo quan trọng hơn mọi câu trả lời: đừng bao giờ MỞ popup.** Trên Windows, Alt+ArrowDown hoặc F4 mở dropdown native — và một khi nó mở, CDP không đưa phím vào được nữa (popup là cửa sổ native có vòng input riêng, ngoài renderer), kể cả Escape để đóng cũng không chắc tới nơi. Một cú click nhầm vào select có thể treo phiên cho đến khi người dùng thật động tay. Hãy nâng "không bao giờ click / Alt+Down vào select" thành assertion trong plan, không chỉ là quy ước.

**Câu 2 — type-ahead: không an toàn hơn, loại.** Ba lý do: (i) mỗi keypress làm selection nhảy đều phát `change` — gõ "Ngo" có thể ra 2–3 change chứ không phải 1; (ii) timeout gộp prefix của Chrome (~1s) là chi tiết cài đặt không cam kết, nghĩa là kết quả phụ thuộc timing bạn không kiểm soát; (iii) tệ nhất: khi nhiều option trùng chữ cái đầu, bấm lặp chữ đó sẽ *cycle* qua các option cùng prefix — kết quả phụ thuộc trạng thái buffer mà bạn không quan sát được. Với một máy trạng thái cần dự đoán được, type-ahead thua mũi tên về mọi mặt trừ số lần bấm.

**Câu 3 — không có, và tôi trả lời chắc chắn để bạn khỏi tốn thời gian.** Popup của select là widget browser-side (native menu / cửa sổ Aura), không phải web content — không tồn tại target CDP nào trỏ tới nó, không domain nào dispatch vào nó được. Headless cũ thậm chí không render nó. Cộng với cảnh báo ở câu 1: mở nó ra là tự nhốt mình.

**Câu 4 — multiple/optgroup, và một cạm bẫy index bạn chưa nhắc:**

- **Số học Δindex là bẫy:** mũi tên *bỏ qua* option `disabled` (và option ẩn), nên "bấm Δindex lần" sai ngay khi form có option bị khoá. Đừng làm số học — làm **vòng bấm-rồi-xác-minh**: bấm một lần → content script đọc `selectedIndex` → còn lệch thì bấm tiếp, chặn trên là số option. Chậm hơn không đáng kể, đúng tuyệt đối, và tự miễn nhiễm luôn với optgroup.
- **optgroup:** label nhóm không phải option, mũi tên tự nhảy qua; `selectedIndex` vẫn đếm phẳng. Vòng bấm-xác-minh xử lý sạch, không cần nhánh riêng.
- **`<select multiple>`:** hiển thị dạng listbox inline — không có popup, tin tốt. Trên Windows: Ctrl+ArrowUp/Down di chuyển focus *không* đổi selection, Ctrl+Space toggle mục đang focus, Shift+mũi tên chọn dải. Qua CDP chỉ cần `modifiers` đúng bit (Ctrl=2) — `pressKey` của bạn đã hỗ trợ. Mỗi toggle phát một `change`: đúng và nên chấp nhận, vì mỗi toggle là một hành động người thật có chủ đích.

**Câu 5 — `<select>` phải là công dân hạng nhất.** Nó là control chọn-một phổ biến nhất của web form; chuẩn không cầm được select là chuẩn chết từ đầu. Và **đừng** khuyên dev đổi sang listbox ARIA tự chế: listbox tự chế trung bình tệ hơn select native về a11y, mobile, *và cho chính agent* — vì hành vi bàn phím của nó là code tự viết, không có gì bảo đảm. Nguyên tắc chuẩn nên phát biểu (nối Q06): *"phần tử tương tác được cho agent ≡ phần tử vận hành được thuần bàn phím theo chuẩn HTML/ARIA APG"*. Phát biểu như vậy thừa kế miễn phí hai mươi năm công sức accessibility, và mọi trang keyboard-accessible nghiễm nhiên agent-accessible.

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Cảnh báo quan trọng hơn mọi câu trả lời — và nó bắt đúng một quả mìn trong mã tôi đang chạy.** Chuyên gia nói: đừng bao giờ mở popup, một cú click nhầm vào select có thể treo phiên cho tới khi người dùng thật động tay. Mã cũ của tôi có `focusSelectByLabel()` với fallback: *"Không có nhãn: đành click thẳng (popup bung), rồi Escape để đóng lại."* Tức là tôi đã **cố ý viết đường mở popup** và tin rằng Escape gỡ được — mà Escape thì cũng không chắc tới nơi. Demo hiện tại có `<label for>` nên chưa bao giờ chạm vào nhánh đó; trên một trang thật thiếu nhãn thì nó sẽ treo phiên.

Đã xoá `focusSelectByLabel()` hoàn toàn. Select giờ chỉ có một đường: `focusElement()` + phím. Nâng "không bao giờ click / Alt+Down vào select" thành **invariant ghi trong `plan.ts` và kiến trúc §2.2**, đúng như chuyên gia đề nghị.

**Đã đổi trong mã:**

- Bỏ số học Δindex một-phát-ăn-ngay → **vòng bấm-rồi-xác-minh** (`selectRounds`, trần 6 vòng). Cạm bẫy chuyên gia chỉ ra mà tôi hoàn toàn không nghĩ tới: mũi tên **bỏ qua option `disabled`**, nên phép trừ sai ngay khi form có option bị khoá — và nó tự miễn nhiễm luôn với `<optgroup>`, không cần nhánh riêng.

  Một điều chỉnh so với lời khuyên: tôi bấm **theo lô rồi xác minh**, không bấm-một-lần-rồi-xác-minh. Mỗi vòng xác minh là một chặng message content script ↔ SW, nên bấm từng phím sẽ tốn 7 chặng cho một select 8 option. Bảo đảm vẫn y hệt (mỗi vòng đọc `selectedIndex` **thật** rồi tính lại, không tích luỹ sai số), chỉ ít round-trip hơn.

- Thêm tối ưu Home/End: chọn đường ít phím nhất trong ba lối (đi thẳng / Home rồi xuống / End rồi lên). Không phải để nhanh — để **giảm số lần trang bị đánh thức**, vì mỗi lần bấm phát một cặp `input`+`change`.

- `<select multiple>` → `PlanError` rõ ràng thay vì im lặng làm sai. Cơ chế Ctrl+Space/Shift+mũi tên chuyên gia mô tả để dành khi có ca dùng thật.

- Có test cho `arrowSteps` (`plan.test.ts`): nó có ba nhánh và **hỏng lặng lẽ** — bấm thiếu một nấc thì form vẫn gửi được, chỉ là gửi sai lựa chọn. Test khẳng định cả *đường ngắn nhất* lẫn *tới đúng nơi*, quét toàn bộ cặp (vị trí, đích).

**Câu 1 — cách định khung lại đáng giá hơn câu trả lời.** Tôi hỏi "làm sao tránh 7 sự kiện `change` rác"; câu trả lời đúng là **đừng tránh** — đó chính xác là chuỗi một người dùng bàn phím thật tạo ra, và site nào bắn API không debounce theo từng `change` thì đã hỏng với người dùng bàn phím từ trước khi agent tồn tại. Lời giải nằm ở tầng chuẩn, không ở extension → đã viết thành **spec §9.5.2** (`change`/`input` là tạm thời; hiệu lực chỉ ở commit tường minh).

**Câu 2 — type-ahead: loại, và mừng vì đã hỏi trước khi làm.** Lý do tôi không tự nghĩ ra: khi nhiều option trùng chữ cái đầu, bấm lặp sẽ *cycle* theo một buffer trạng thái mà tôi **không quan sát được**. Với một máy trạng thái cần dự đoán được thì đó là hỏng về nguyên tắc, không phải một nhược điểm cân đo được.

**Câu 5 — `<select>` là công dân hạng nhất, và không khuyên dev đổi sang listbox ARIA tự chế.** Đã viết vào spec §9.5.1 kèm lý do: listbox tự chế trung bình tệ hơn select native về a11y, mobile, *và cho chính agent* — hành vi bàn phím của nó là code tự viết.
