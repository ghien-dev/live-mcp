---
id: Q06
tiêu_đề: Trang khai báo bao nhiêu, extension suy luận bao nhiêu
trạng_thái: đang-áp-dụng
mức_độ_chặn: tham-khảo
người_hỏi: Claude
ngày_hỏi: 2026-08-02
người_trả_lời: Fable
ngày_trả_lời: 2026-08-02
liên_quan:
  - Q02
  - Q03
  - docs/livemcp-declarative-spec.md
  - docs/project-ideal.md
---

## 1. Khó khăn

Live MCP đang định nghĩa một chuẩn declarative mới, và câu hỏi nền tảng của mọi chuẩn kiểu này là: **ranh giới giữa "trang tự khai báo" và "công cụ tự suy luận" nằm ở đâu?**

Hiện tại content script tự suy ra cách tương tác từ `htmlType`: thấy `select` thì bấm mũi tên, thấy `date` thì gõ chữ số theo thứ tự segment, thấy `checkbox` thì bấm Space. Càng suy luận nhiều thì càng nhiều heuristic có thể sai — và mấy ngày qua đã cho thấy heuristic sai thì hỏng rất lặng lẽ.

Nhưng chiều ngược lại cũng có giá: càng bắt trang khai báo nhiều thì càng ít dev chịu áp dụng chuẩn. Và một chuẩn không ai dùng thì đúng đắn đến mấy cũng vô nghĩa.

Đây là quyết định khó đảo ngược, vì nó nằm trong bản thân chuẩn chứ không phải trong mã.

## 2. Tôi đã suy nghĩ và thử những gì

**Nguyên tắc đang theo:** trang chỉ khai báo *cái gì làm được*, còn *làm bằng cách nào* là việc của extension. Trang viết `livemcp-name="book_table"` và mô tả các ô; extension tự lo chuyện click hay gõ phím. Lý do: dev viết trang không nên phải biết CDP tồn tại.

**Chỗ nguyên tắc này đang căng:** với `<select>` và `<input type="date">`, cách tương tác đúng phụ thuộc vào những thứ extension không thể biết chắc — trang có nghe `change` để gọi API không (ảnh hưởng việc nên bấm mũi tên hay type-ahead, xem [Q03](Q03-select-popup-native.md)), widget tự chế có phản ứng với click hay không.

**Đã cân nhắc:** thêm attribute kiểu `livemcp-input-method="keyboard|mouse"` để trang tự nói. Nhưng tôi ngờ rằng dev sẽ điền sai hoặc bỏ trống, và khi đó chuẩn có thêm một trường vô dụng — tệ hơn là không có.

## 3. Hướng tôi đang định làm

Chưa quyết. Nghiêng về giữ nguyên tắc "trang khai báo cái gì, extension lo cách nào", và chỉ mở thêm attribute khi có bằng chứng cụ thể rằng extension không thể suy luận đúng.

## 4. Câu hỏi cụ thể

1. **Có nên thêm attribute kiểu `livemcp-input-method="keyboard|mouse"` hoặc `livemcp-commit-key` không?** Hay đó là dấu hiệu chuẩn đang rò rỉ chi tiết cài đặt ra ngoài, và đúng ra phải giấu đi?

2. **Bài học từ ARIA/WAI-ARIA về việc bắt trang khai báo:** đâu là ngưỡng mà dev còn chịu làm? Và mẫu nào trong ARIA bị dùng sai nhiều nhất — để chuẩn của chúng tôi tránh lặp lại đúng hình dạng đó?

3. **Chuẩn nên định nghĩa khái niệm "agent-focusable" (tương tự `tabindex`) không** — để một phần tử tự nói rằng nó tương tác được bằng bàn phím? Hay cứ dựa vào việc phần tử có thực sự focus được theo chuẩn HTML là đủ?

4. **Câu hỏi rộng nhất, và là câu tôi mong được nghe nhất:** với kinh nghiệm nhìn nhiều chuẩn web sống và chết, **điều gì thường giết một chuẩn declarative?** Quá nhiều thứ phải khai báo? Quá ít nên công cụ phải đoán rồi đoán sai? Hay là chuyện hoàn toàn khác — công cụ, tài liệu, thời điểm ra mắt?

## ═══ TRẢ LỜI ═══

<!-- Chuyên gia viết từ đây trở xuống. Mỗi người một mục ### riêng kèm tên và ngày. -->

### Fable — 2026-08-02

Nguyên tắc bạn đang theo — *trang khai báo cái gì, extension lo cách nào* — là đúng, và các câu dưới đây đều là hệ quả của việc giữ nó một cách kỷ luật.

**Câu 1 — không thêm `livemcp-input-method`, và đây là phép thử cho mọi attribute tương lai.** Attribute này phạm cả hai tội của một attribute tồi: *(i) rò rỉ cơ chế* — "keyboard|mouse" là chi tiết của extension hôm nay, vô nghĩa với consumer khác của cùng chuẩn ngày mai (voice agent, screen-reader agent); *(ii) người viết không thể điền đúng* — dev của trang không biết và không nên phải biết CDP gõ phím thế nào. Phép thử nhanh cho mọi đề xuất attribute về sau: **"dev có thể điền SAI mà trang của họ vẫn chạy bình thường không?"** Nếu có, attribute đó sẽ sai hàng loạt ngoài thực địa — vì không gì trừng phạt người điền sai.

Riêng `livemcp-commit-key`: nhu cầu thật đằng sau nó ("khi nào thay đổi có hiệu lực") đã có ngữ nghĩa HTML chuẩn — form + nút submit = commit tường minh. Thay vì attribute mới, ghi thành **yêu cầu conformance**: *"trang phải coi `change`/`input` là tạm thời; hiệu lực chỉ xảy ra ở hành động commit tường minh"*. Một câu đó giải luôn nỗi lo bảy-lần-`change` của Q03, ở đúng tầng của nó.

**Câu 2 — bài học ARIA, phần xương máu:**
- **Ngưỡng dev chịu làm**, quan sát thực địa: *một* attribute, ý nghĩa cục bộ nhìn-phát-hiểu, viết một lần không phải bảo trì — như `placeholder`, `required` — thì tỉ lệ dùng cao. Thứ chết hàng loạt là attribute phải **đồng bộ với trạng thái runtime** (`aria-expanded`, `aria-selected`): nó rot ngay sau lần refactor đầu tiên, vì DOM đổi mà attribute không ai nhớ đổi theo.
- **Mẫu bị dùng sai nhiều nhất:** role không kèm hành vi — `role="button"` trên `<div>` không xử lý phím, vỏ ngữ nghĩa rỗng ruột; và vi phạm chính quy tắc số một của ARIA: *đừng dùng ARIA khi HTML native đã đủ*.
- **Hình dạng cần tránh lặp lại** gồm hai dạng: attribute *mô tả sự thật mà DOM đã tự nói* (mời khai trùng → sớm muộn khai lệch), và attribute *mà độ sai vô hình với người viết* — dev không chạy screen reader nên không thấy ARIA hỏng; dev không chạy agent thì sẽ không thấy `livemcp-*` hỏng.
- **Thuốc giải bạn đang cầm sẵn:** extension chính là validator sống. Làm chế độ lint ngay trong nó: "khai `livemcp-name` trên phần tử không focus được", "schema nói number nhưng input là text", "hai tool trùng tên". ARIA mất mười năm mới có công cụ kiểm; bạn có thể ship validator *cùng ngày* với chuẩn — dev thấy lỗi ngay lúc thêm attribute là loại chuẩn tự lan.

**Câu 3 — không phát minh "agent-focusable"; dựa hẳn vào focusability chuẩn HTML, phát biểu thành điều kiện conformance:** *"phần tử tương tác khai báo cho agent PHẢI focus được theo chuẩn HTML (form control, button, link, hoặc tabindex hợp lệ) và vận hành được thuần bàn phím."* Ba cái lợi: không có gì để khai sai; máy kiểm được tự động (validator ở câu 2); và nó ép trang tử tế với bàn phím — nghĩa là **agent-accessible ≡ keyboard-accessible**. Đây là đòn bẩy chiến lược lớn nhất của cả dự án: hai mươi năm hạ tầng WCAG/APG trở thành nền móng miễn phí, và cộng đồng a11y trở thành đồng minh tự nhiên thay vì một nhóm phải thuyết phục thêm.

**Câu 4 — điều gì giết một chuẩn declarative.** Nhìn xác các chuẩn, nguyên nhân tử vong số một *không phải* khai nhiều hay khai ít. Là: **không có phần thưởng tức thì cho người khai.** Cặp đối chứng sạch nhất: microformats/RDFa chết ↔ schema.org sống — độ phức tạp tương đương, khác đúng một chỗ: schema.org đổi được rich snippet trên Google trong tuần. P3P chết vì bắt viết policy phức tạp mà không ai thưởng. Do-Not-Track chết kiểu khác nhưng cùng họ: khai xong bị consumer phớt lờ — chuẩn mất uy tín còn nhanh hơn chuẩn khó dùng. XHTML2 chết vì đòi đập đi làm lại. ARIA sống lay lắt rồi thắng nhờ hai thứ chẳng liên quan chất lượng spec: nghĩa vụ pháp lý, và *chui được vào framework* — dev dùng Radix là có ARIA miễn phí, không cần đọc một trang spec nào.

Rút cho Live MCP, theo thứ tự ưu tiên:

1. **Vòng phần thưởng dưới 5 phút.** Dev thêm hai attribute → mở extension → *thấy* agent điền được form của mình, ngay. Extension + validator chính là "rich snippet" của bạn. Thiếu vòng này thì mọi thứ khác trong spec vô nghĩa.
2. **Lan qua toolchain, không qua spec.** Recipe/wrapper cho React/Vue để `livemcp-*` sinh ra như tác dụng phụ của component dev đang dùng sẵn. Chuẩn sống trong thư viện, không sống trong PDF.
3. **Nhỏ một cách tàn nhẫn.** Chỉ bắt khai thứ *không thể suy luận*: tên tool, mô tả ý định, ranh giới form, schema tham số. Mọi thứ suy luận được từ HTML semantics thì extension phải tự suy — mỗi attribute ứng viên phải trả lời "sự thật này đã tồn tại ở đâu trong DOM chưa?"; có rồi thì không thêm. (Điều này cũng trả lời chỗ "nguyên tắc đang căng" ở mục 2: `<select>` nghe `change` hay không — lời giải không phải attribute mới mà là yêu cầu conformance ở câu 1.)
4. **Thời điểm đang thuận, đừng lãng phí.** Hệ sinh thái MCP cho bạn sẵn phía tiêu thụ — agent thật, hôm nay — thứ mà đa số chuẩn chết trẻ không bao giờ có. Cửa sổ này nên tiêu vào demo loop ở mục 1, không phải vào đánh bóng văn bản chuẩn.

## 5. Ghi nhận & áp dụng

*Claude — 2026-08-02*

**Đã có một phép thử để dùng cho mọi đề xuất attribute về sau:**

> *"Dev có thể điền SAI mà trang của họ vẫn chạy bình thường không?"* — Nếu có, attribute đó sẽ sai hàng loạt ngoài thực địa, vì không gì trừng phạt người điền sai.

Phép thử này giá trị hơn cả câu trả lời cho câu 1, vì nó dùng được nhiều lần. Áp thử ngay: `livemcp-value-format` ở [Q02](Q02-input-date-segment.md) câu 4 — dev **không thể** điền đúng, vì thứ tự hiển thị do browser UI locale của từng người dùng quyết định. Loại.

**Đã đổi trong chuẩn (`docs/livemcp-declarative-spec.md` §9.5) — hai yêu cầu conformance, không attribute mới:**

- **§9.5.1** — phần tử khai báo cho agent PHẢI focus được theo chuẩn HTML và vận hành được thuần bàn phím. **Agent-accessible ≡ keyboard-accessible.** Đây là điều tôi đánh giá là đòn bẩy chiến lược lớn nhất trong toàn bộ sáu câu: thay vì phát minh khái niệm "agent-focusable" của riêng mình (câu 3, chuyên gia bảo đừng), chuẩn thừa kế miễn phí hai mươi năm hạ tầng WCAG/APG, và cộng đồng a11y thành đồng minh tự nhiên thay vì một nhóm phải thuyết phục thêm.
- **§9.5.2** — `change`/`input` là tạm thời; hiệu lực chỉ ở hành động commit tường minh. Một câu này giải luôn nỗi lo "bảy `change` rác" của [Q03](Q03-select-popup-native.md) **ở đúng tầng của nó** — thay cho `livemcp-commit-key` mà tôi đã định thêm.
- Bổ sung hai dòng tương ứng vào checklist §10, kèm cách tự kiểm cụ thể ("rút chuột ra, làm hết workflow bằng Tab + Enter/Space/mũi tên").

**Câu 4 — chẩn đoán làm tôi đổi thứ tự ưu tiên.** Tôi hỏi "khai nhiều hay khai ít giết một chuẩn"; câu trả lời là **cả hai đều không phải** — nguyên nhân tử vong số một là *không có phần thưởng tức thì cho người khai*. Cặp đối chứng microformats/RDFa (chết) ↔ schema.org (sống) sạch đến mức khó cãi: độ phức tạp tương đương, khác đúng một chỗ là schema.org đổi được rich snippet trong tuần.

Rút ra cho Live MCP, và tôi ghi lại đây vì nó ảnh hưởng tới cả roadmap:

1. **Vòng phần thưởng dưới 5 phút** — dev thêm hai attribute → mở extension → *thấy* agent điền được form của mình, ngay. Extension + validator chính là "rich snippet" của dự án này.
2. **Lan qua toolchain, không qua spec** — recipe/wrapper cho React/Vue. Chuẩn sống trong thư viện, không sống trong PDF. (ARIA thắng nhờ chui được vào framework, không nhờ chất lượng spec.)
3. **Nhỏ một cách tàn nhẫn** — mỗi attribute ứng viên phải trả lời "sự thật này đã tồn tại ở đâu trong DOM chưa?"; có rồi thì không thêm.

**Việc mới phát sinh, chưa có trong roadmap — chế độ lint/validator ngay trong extension.** Chuyên gia gọi extension là "validator sống": khai `livemcp-name` trên phần tử không focus được, schema nói number nhưng input là text, hai tool trùng tên. Lập luận thuyết phục nhất: **độ sai của `livemcp-*` vô hình với người viết**, đúng như ARIA hỏng mà dev không thấy vì không chạy screen reader. ARIA mất mười năm mới có công cụ kiểm; ta ship validator *cùng ngày* với chuẩn được. Đề xuất đưa vào M4 (cùng đợt settings/UI) — **cần chủ dự án quyết vị trí trong roadmap.**

**Nguyên tắc gốc được xác nhận giữ nguyên:** trang khai báo *cái gì làm được*, extension lo *làm bằng cách nào*. Chỗ tôi thấy "đang căng" ở mục 2 (`<select>` có nghe `change` không) hoá ra không cần attribute nào — nó là yêu cầu conformance §9.5.2.
