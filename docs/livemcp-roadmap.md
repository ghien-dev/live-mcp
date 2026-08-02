# Lộ trình phát triển Live MCP

> **File này sống lâu dài và được sửa liên tục.** Nó vừa là lộ trình, vừa là nơi
> hỏi ý kiến chuyên gia về *hướng đi* — cách dùng ghi ở mục cuối cùng
> ([Quy ước dùng file](#quy-uoc-dung-file)). Đọc mục đó trước nếu bạn là người
> mới tham gia.

| | |
|---|---|
| Phiên bản | 1.0 (đề xuất, **chờ duyệt**) |
| Cập nhật | 2026-08-02 |
| Người đề xuất | Claude |
| Trạng thái | ⏳ chờ chuyên gia duyệt |
| Tài liệu nền | [`project-ideal.md`](project-ideal.md) · [`livemcp-architecture.md`](livemcp-architecture.md) §8 · [`livemcp-declarative-spec.md`](livemcp-declarative-spec.md) |

---

## 1. Đang ở đâu

**Xong:** M0 (walking skeleton toàn tuyến) · M1 (form + gõ phím thật + schema converter) · lưới E2E trên Chrome thật (ngoài kế hoạch gốc).

| Tầng bảo vệ | Số lượng | Bắt gì |
|---|---|---|
| Unit (vitest) | 31 | logic thuần: schema, định tuyến, thứ tự segment, bảng phím |
| E2E (Playwright) | 23 + 2 `fixme` | layout, focus thật, CDP thật, ba locale, vòng đời MV3 |
| Tự kiểm trong production | 3 lớp | focus xác minh, hit-test, xác minh giá trị từng ô |

**Một quyết định kiến trúc đã bị đảo trong quá trình làm M1:** §2.2 từ *"toạ độ là ngôn ngữ chung của mọi hành động"* thành *"bàn phím là đường mặc định, toạ độ chỉ là ngôn ngữ của hành động chuột"*. Chi tiết và lý do: [`consult/Q01`](consult/Q01-focus-thay-click.md), [`consult/Q04`](consult/Q04-khe-ho-do-toa-do.md).

---

## 2. Nguyên tắc dẫn đường cho phần còn lại

Bốn nguyên tắc dưới đây **không phải khẩu hiệu** — mỗi cái đã trả giá bằng một lỗi cụ thể, và chúng ràng buộc thứ tự làm việc ở mục 3.

**N1 · Đo, đừng tin — và đo cho TỪNG tầng hành vi.**
Hành vi không được spec chuẩn hoá thì đo trên chính trình duyệt đang chạy. Bài học đắt nhất: đã dựng phép dò rất cẩn thận cho *thứ tự segment* ô ngày rồi vẫn gõ sai, vì *cơ chế tự-nhảy-segment* là một tầng hành vi khác mà phép dò không chạm tới. Đo một tầng không miễn nhiễm cho tầng kia.

**N2 · Hỏng ồn ào hơn hỏng im lặng.**
Mọi lớp mới phải trả lời được: "nếu cái này sai thì ai biết, và biết bằng cách nào?" Lỗi tốn nhiều thời gian nhất của dự án không phải lỗi khó — nó chỉ *im lặng*.

**N3 · Chuẩn chỉ bắt khai thứ không suy luận được từ DOM.**
Phép thử cho mọi attribute ứng viên: *"dev có thể điền SAI mà trang vẫn chạy bình thường không?"* Nếu có → sẽ sai hàng loạt ngoài thực địa, vì không gì trừng phạt người điền sai. (Nguồn: [`consult/Q06`](consult/Q06-ranh-gioi-chuan-declarative.md).)

**N4 · Chuẩn sống nhờ vòng phần thưởng, không nhờ chất lượng văn bản.**
Nguyên nhân tử vong số một của chuẩn declarative là *không có phần thưởng tức thì cho người khai*. Đối chứng: microformats/RDFa chết ↔ schema.org sống, khác đúng một chỗ — schema.org đổi được rich snippet trong tuần. Nguyên tắc này là lý do mục 3 dưới đây **đổi thứ tự** so với §8 của kiến trúc.

---

## 3. Lộ trình đề xuất

### 3.1 Tổng quan và chỗ khác với kiến trúc §8

| | Kiến trúc §8 (gốc) | Đề xuất | Lý do đổi |
|---|---|---|---|
| M2 | Đợi + DOM động | Đợi + DOM động **+ shadow DOM** | cùng đụng scanner & observer; tách ra phải sửa hai lần |
| M3 | Tool tham số hoá + resource | *(giữ nguyên)* | |
| — | *(không có)* | **M3.5 — Validator & DX** ⬅ *mới* | N4: vòng phần thưởng là thứ quyết định chuẩn sống hay chết |
| M4 | Policy layer | Policy layer, **tách phần bắt buộc lên sớm** | hôm nay WS chưa có token — xem [R02] |
| M5 | Bee cursor | Bee cursor | |
| M6 | Canvas + MPA + iframe | Canvas + MPA + iframe | |
| M7 | Đóng gói | Đóng gói + Streamable HTTP | |

Kích thước ghi theo **S / M / L** thay vì ngày. Lý do: bốn ngày qua cho thấy ước lượng theo ngày ở dự án này sai rất xa — riêng M1 tốn nhiều lượt gỡ hơn cả M0, và phần đắt nhất là *chẩn đoán*, thứ không ước lượng được. S/M/L nói được thứ tự ưu tiên mà không giả vờ chính xác.

---

### M2 — Cơ chế đợi & DOM động · **L** · ưu tiên 1

> Đây là milestone **quan trọng nhất còn lại**, vì nó là chỗ chứng minh luận điểm trung tâm của cả dự án.

Chủ dự án viết trong [`project-ideal.md`](project-ideal.md): *"DOM mới được sinh ra từ tương tác người dùng chứ nó hoàn toàn không tự sinh ra… agent phải học cách đợi của Playwright"*. Nếu mẫu **hành động → đợi → declarative mới → tool mới** chạy được, thì lập luận "không cần Imperative API" đứng vững. Nếu không, mọi thứ còn lại đều lung lay. M0/M1 mới chỉ chứng minh phần dễ hơn: form tĩnh.

**Việc cụ thể**

1. `MutationObserver` trong content script, lọc đúng theo declarative và debounce (kiến trúc §5.2) → `declarative_delta`.
2. Server phát `notifications/tools/list_changed` khi tool list đổi; xử lý `seq` chống race giữa delta và snapshot mới sau navigation (§6.2).
3. Waiter thật theo thứ tự ưu tiên spec §7.2: `livemcp-state` → `livemcp-wait`/`wait-gone` → DOM lắng → timeout. Thay bản tối giản hiện tại.
4. Tool hệ thống `livemcp_wait(site, selector?, timeoutMs)` — cho agent chủ động đợi (§6.4).
5. **Shadow DOM** *(gộp vào đây, xem [R01])*: scanner đệ quy vào `shadowRoot`; observer phải gắn cho **từng** shadow root — observer của `document` không thấy thay đổi bên trong shadow tree.
6. Trang demo: dropdown động (mẫu spec §5.2) + một form dựng bằng web component.

**Nghiệm thu**

- Agent gọi tool mở dropdown → đợi → **nhận được tool mới** sinh từ DOM mới → gọi tiếp → hoàn tất, không cần biết trước gì về dropdown đó.
- E2E: form trong shadow DOM (gỡ `fixme` ở `packages/e2e/tests/05-gaps.spec.ts`).
- E2E: tool xuất hiện/biến mất đúng theo DOM, không phụ thuộc `sleep`.

**Rủi ro** — Observer bắn quá nhiều (trang React re-render liên tục) → bão `list_changed` làm ngộp agent. Ứng phó: debounce + so sánh nội dung, chỉ báo khi *tool list* đổi thật chứ không phải DOM đổi. Đây cũng là chỗ N2 cần được thiết kế vào từ đầu: delta sai thì hỏng im lặng.

---

### M3 — Tool tham số hoá & resource · **M** · ưu tiên 2

**Việc cụ thể**

1. `livemcp-arg` — gộp nhiều phần tử cùng `livemcp-name` thành một tool có tham số (spec §5.3). Hiện `findElement()` luôn lấy phần tử đầu tiên (`TODO(M3)` trong mã).
2. `livemcp-resource` → MCP resource; `livemcp_read_page(site)` (§6.4).
3. Cắt trần & chuẩn hoá text đọc từ trang (§5.4) — đã có `MAX_RESULT_CHARS`, cần áp cho resource.

**Nghiệm thu** — Danh sách sản phẩm lặp: agent gọi `add_to_cart(item: "iPhone 17")` trúng đúng dòng, không phải dòng đầu. Agent đọc được bảng giá qua resource mà không cần chụp màn hình.

---

### M3.5 — Validator & vòng phần thưởng cho dev · **M** · ⬅ **mới, đề xuất chèn** · [R03]

> Đây là đề xuất tôi tin nhất trong cả lộ trình này, và cũng là chỗ tôi lệch nhiều nhất so với kiến trúc gốc.

Kiến trúc §9 có nhắc `npx livemcp-validate <url>` nhưng xếp nó vào phần "ứng phó rủi ro", không thành milestone. Theo N4, tôi cho rằng nó **không phải phần phụ mà là phần quyết định chuẩn sống hay chết**.

Lập luận: độ sai của `livemcp-*` **vô hình với người viết** — y hệt ARIA hỏng mà dev không thấy vì không chạy screen reader. Dev không chạy agent thì sẽ không thấy `livemcp-*` hỏng. ARIA mất mười năm mới có công cụ kiểm; ta có thể ship validator *cùng ngày* với chuẩn.

**Việc cụ thể**

1. **Chế độ lint trong extension** — panel hiện lỗi tuân thủ ngay trên trang dev đang mở: khai `livemcp-name` trên phần tử không focus được (vi phạm spec §9.5.1), schema nói `number` nhưng input là `text`, hai tool trùng tên, `livemcp-wait` trỏ selector không tồn tại, thiếu `livemcp-confirm` cho hành động có vẻ phá huỷ.
2. **Vòng phần thưởng dưới 5 phút** — dev thêm hai attribute → mở extension → *thấy* agent điền được form của mình, ngay. Cần một "thử ngay" trong extension không cần dựng agent thật.
3. Trang tài liệu tối giản: copy-paste được, chạy được.

**Nghiệm thu** — Một dev chưa biết gì về Live MCP, đọc tài liệu và làm form của họ chạy được với agent **trong dưới 15 phút**, không cần hỏi ai. Đây là tiêu chí *đo trên người thật*, không tự chấm.

---

### M4 — Policy layer (bảo mật) · **L** · ưu tiên 3 · [R02]

Kiến trúc §6.3 ghi rõ *"không được cắt xén khi triển khai"* và §8 ghi *"bắt buộc xong trước khi đưa ai khác dùng"*.

**Trạng thái hôm nay: chưa có gì.** WS bind `127.0.0.1` nhưng **không có token**; không có origin allowlist; không có confirm gate; không có sanitizer. Nghĩa là bất kỳ tiến trình local nào cũng nối được vào hub và điều khiển trình duyệt.

**Việc cụ thể** (theo §6.3)

1. Token pairing: server sinh token, user dán vào popup extension một lần.
2. Origin allowlist: lần đầu gặp origin mới → hỏi user, lưu quyết định. Không allowlist → không quét, không thi hành.
3. Confirm gate cho `livemcp-confirm` (MCP elicitation, fallback `confirmed: true`).
4. **Sanitizer** — mọi text từ web là dữ liệu không tin cậy. Đây là chốt chặn duy nhất trước agent, và §9 xếp prompt injection là rủi ro **cao nhất**.
5. Rate limit ~2 action/giây/tab.
6. Chặn `input[type=password]` — *đã có*, cần đưa vào settings.

**Nghiệm thu** — Một trang độc cố nhét `"ignore previous instructions"` vào `livemcp-description` không làm agent đổi hành vi. Tiến trình local khác không nối được vào hub.

---

### M5 — Bee cursor 🐝 · **M** · ưu tiên 4 · [R04]

Kiến trúc §5.5. Con ong bay tới vị trí, chân trái/phải theo click, kim ở miệng nhấp khi gõ.

**Ghi chú thẳng thắn:** đây là milestone tôi *không chắc* về vị trí. Nó thuần trải nghiệm, không mở khoá năng lực nào — nhưng nó có thể chính là "phần thưởng tức thì" mà N4 nói tới, và là thứ khiến người ta nhớ sản phẩm. Xem [R04].

**Ràng buộc kỹ thuật đã biết:** overlay `pointer-events: none` là **bắt buộc** — con ong không bao giờ được chặn chính cú click nó đang biểu diễn. Animation lỗi thì vẫn phải dispatch; visual không bao giờ được chặn chức năng.

---

### M6 — Canvas · MPA · iframe · **L** · ưu tiên 5

1. Canvas mẫu A/B/C (spec §8) trên demo-site.
2. Điều hướng đa trang (spec §7.3).
3. **Iframe** — theo [`consult/Q04`](consult/Q04-khe-ho-do-toa-do.md): same-origin qua `DOM.getContentQuads` từ session top-level *(không cộng offset thủ công — cách cũ sai về bản chất khi iframe có transform)*; OOPIF để sau, và **chỉ làm khi đã có ca E2E riêng**.
4. Đường nâng cấp objectId (kiến trúc §2.2): `Runtime.callFunctionOn` trong isolated world → `objectId` → `getContentQuads` → dispatch, tất cả cùng một kênh. Đây là lúc nó thật sự giải một bài toán chứ không chỉ tối ưu một con số.
5. Probe zoom/DPR lúc attach ([`consult/Q04`](consult/Q04-khe-ho-do-toa-do.md) câu 5) — nhánh chuột nở ra ở đây nên phải trả nốt khoản này.

---

### M7 — Đóng gói & phát hành · **M** · ưu tiên 6

1. `npx livemcp-server` installer; onboarding extension.
2. Streamable HTTP transport (kiến trúc §2.5) — hiện `--http` chỉ báo lỗi.
3. Tài liệu người dùng, gồm **ghi rõ ranh giới sản phẩm**: banner debugger không tắt được; một số site chống bot sẽ chặn agent (quyết định có ý thức ở [`consult/Q01`](consult/Q01-focus-thay-click.md) câu 3, không phải thiếu sót).

---

## 4. Nợ kỹ thuật đang treo

Không thuộc milestone nào; ghi ra để không rơi.

| Việc | Nguồn | Đề xuất xử lý |
|---|---|---|
| Ô `time` còn suy từ `Intl` thay vì đo | `consult/Q02` câu 5, `e2e/05-gaps` | gộp vào M2 (cùng nguyên tắc N1) |
| Locale đặt AM/PM **trước** giờ (ko-KR) | `consult/Q02` | cùng trên |
| `<select multiple>` chưa hỗ trợ | `consult/Q03` câu 4 | M3, hoặc bỏ nếu không có ca dùng thật |
| `month` / `week` | `consult/Q02` câu 5 | ưu tiên thấp nhất, đừng để chặn milestone |
| Chọn phần tử theo `livemcp-arg` | `TODO(M3)` trong `content/index.ts` | M3 |

---

## 5. Bảng câu hỏi cho chuyên gia

| Mã | Chủ đề | Mức | Trạng thái | Ngày hỏi | Người trả lời |
|---|---|---|---|---|---|
| R01 | Gộp shadow DOM vào M2, hay tách riêng? | quan-trọng | ⏳ chờ | 2026-08-02 | |
| R02 | Bảo mật ở M4 có quá muộn không? | **chặn** | ⏳ chờ | 2026-08-02 | |
| R03 | Chèn M3.5 Validator — đúng chỗ chưa? | **chặn** | ⏳ chờ | 2026-08-02 | |
| R04 | Con ong: làm sớm hay để cuối? | tham-khảo | ⏳ chờ | 2026-08-02 | |
| R05 | Khi nào đóng băng spec v1.0? | quan-trọng | ⏳ chờ | 2026-08-02 | |
| R06 | Đo thế nào để biết chuẩn đang sống? | quan-trọng | ⏳ chờ | 2026-08-02 | |
| R07 | Rủi ro lớn nhất mà lộ trình này chưa thấy? | tham-khảo | ⏳ chờ | 2026-08-02 | |

*Trạng thái: ⏳ chờ · ✅ đã trả lời · 🔧 đang áp dụng · ✔ khép lại*

---

## 6. Nhật ký hỏi–đáp

> Chuyên gia viết vào mục `▸ Trả lời` của từng câu. **Không sửa phần câu hỏi** —
> nếu thấy câu hỏi sai đề thì nói ra trong phần trả lời. Chi tiết quy ước ở
> [mục 7](#quy-uoc-dung-file).

---

### R01 — Gộp shadow DOM vào M2, hay tách thành milestone riêng?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Scanner hiện dùng `root.querySelectorAll`, vốn không xuyên qua shadow root, nên form khai báo đúng chuẩn nằm trong shadow DOM **chưa bao giờ được phát hiện**. Lưới E2E đã ghi việc này thành `test.fixme`.

Lý do tôi muốn gộp vào M2: cả hai cùng đụng scanner và MutationObserver, mà observer của `document` **không** thấy thay đổi bên trong shadow tree — làm tách ra thì phải sửa đúng một chỗ hai lần.

Lý do tôi phân vân: nó làm M2 (vốn đã là **L**) phình thêm, mà M2 lại là milestone chứng minh luận điểm trung tâm — tôi không muốn nó chậm vì một tính năng không liên quan tới luận điểm đó.

**Câu hỏi**

1. Gộp vào M2 hay tách riêng sau M3?
2. Trong thực tế, tỉ lệ trang dùng web component/shadow DOM cho **form** có đủ cao để đây là việc phải làm sớm không? Hay đa số design system chỉ dùng shadow DOM cho component hiển thị, còn form vẫn ở light DOM?
3. Có cạm bẫy nào của việc quét đệ quy shadow root mà tôi nên biết trước — hiệu năng trên trang lớn, `mode: 'closed'`, slot/`assignedElements`?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R02 — Bảo mật ở M4 có quá muộn không?

**Mức:** **chặn** · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Kiến trúc §6.3 ghi *"không được cắt xén"*, §8 ghi *"bắt buộc xong trước khi đưa ai khác dùng"*. Nhưng hôm nay: WS bind `127.0.0.1` mà **không có token**, không origin allowlist, không sanitizer. Bất kỳ tiến trình local nào cũng nối được vào hub và điều khiển trình duyệt của người dùng.

Lập luận giữ nguyên M4: chưa ai dùng ngoài chủ dự án, nên rủi ro thực tế bằng 0; làm bảo mật sớm là trả chi phí cho một rủi ro chưa tồn tại.

Lập luận kéo lên sớm: ranh giới "chưa ai dùng" rất dễ bị vượt qua **không chủ ý** — chỉ cần demo cho một người, hoặc chính chủ dự án mở một trang lạ trong lúc server đang chạy. Và sanitizer thì càng lùi càng khó nhét vào, vì nó phải bọc mọi đường text từ web tới agent.

**Câu hỏi**

1. Có nên **tách M4** thành hai phần: phần bắt buộc-ngay (token pairing + sanitizer) kéo lên trước M2, phần còn lại (origin allowlist, confirm gate, rate limit) giữ ở M4?
2. Nếu chỉ được làm **một** thứ về bảo mật ngay bây giờ, thứ đó là gì?
3. Prompt injection được §9 xếp rủi ro cao nhất. Sanitize bằng cách strip mẫu chỉ thị ("ignore previous instructions"…) nghe như trò mèo vờn chuột — có cách nào **về bản chất** hơn không? Ví dụ đóng khung mọi text từ web trong một cấu trúc mà agent được dạy là dữ liệu, thay vì cố lọc nội dung?
4. Câu hỏi thật lòng: với một dự án cá nhân giai đoạn sớm, có phải tôi đang **lo quá mức** không? Đâu là ngưỡng hợp lý giữa "làm cho xong tính năng" và "làm cho an toàn" ở giai đoạn này?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R03 — Chèn M3.5 "Validator & vòng phần thưởng" — đúng chỗ chưa?

**Mức:** **chặn** · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Đây là chỗ tôi lệch nhiều nhất khỏi kiến trúc gốc, dựa trên chẩn đoán ở [`consult/Q06`](consult/Q06-ranh-gioi-chuan-declarative.md): nguyên nhân tử vong số một của chuẩn declarative là *không có phần thưởng tức thì cho người khai*, và extension chính là "rich snippet" của dự án này.

Nhưng tôi cũng ý thức được một điều: Live MCP **chưa có người dùng nào**. Tối ưu cho adoption khi chưa ai biết tới có thể là tối ưu quá sớm — cổ điển. Có thể thứ đúng là làm cho sản phẩm mạnh đã (M2/M3), rồi mới lo chuyện người ta có dùng được không.

**Câu hỏi**

1. M3.5 đặt sau M3 có đúng không, hay nên sớm hơn/muộn hơn?
2. Với một chuẩn **chưa có người dùng nào**, thứ tự đúng là "làm sản phẩm mạnh trước" hay "làm vòng phần thưởng trước"? Có mẫu nào từ các chuẩn đã thành công không?
3. Giữa **lint trong extension** và **CLI `npx livemcp-validate <url>`** (kiến trúc §9 nhắc cái sau), cái nào đáng làm trước? Trực giác của tôi là lint trong extension, vì nó ở đúng nơi dev đang nhìn — nhưng CLI thì cắm được vào CI.
4. Tiêu chí nghiệm thu tôi đặt là *"dev lạ làm form chạy được trong dưới 15 phút"*. Con số đó có hợp lý không, và có cách nào đo nó mà không cần tuyển người thật?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R04 — Con ong 🐝: làm sớm hay để cuối?

**Mức:** tham-khảo · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Con ong là ý tưởng riêng của chủ dự án, có trong `project-ideal.md` từ đầu: bay tới vị trí tương tác, chân trái/phải theo click, kim ở miệng nhấp khi gõ. Kiến trúc xếp nó ở M5.

Tôi xếp nó ưu tiên 4 (sau bảo mật) vì nó không mở khoá năng lực nào. Nhưng tôi ngờ rằng mình đang đánh giá thấp nó: theo N4, thứ khiến người ta *thấy* sản phẩm hoạt động chính là thứ khiến chuẩn lan ra. Con ong làm cho một thứ vô hình (agent đang thao tác) trở thành hữu hình — và đó có thể là toàn bộ giá trị của nó.

**Câu hỏi**

1. Ở vị trí ưu tiên 4 là hợp lý, hay nên kéo lên cùng M3.5 như một phần của vòng phần thưởng?
2. Có rủi ro nào khi làm hiệu ứng thị giác *trước* khi luồng chức năng ổn định không — kiểu animation che mất lỗi thật, hoặc làm chậm chẩn đoán?
3. Kiến trúc ghi *"SW chờ content script báo ong đã tới nơi rồi mới dispatch"*. Điều đó thêm một chặng bất đồng bộ vào đúng đường thi hành — chỗ đã tốn nhiều công gỡ. Có nên tách hẳn: **ong chạy song song, không bao giờ nằm trên đường thi hành**, chấp nhận hiệu ứng lệch một nhịp so với hành động?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R05 — Khi nào đóng băng spec v1.0?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Spec đang mang số `1.0` và trang demo khai `<meta name="livemcp" content="1.0">`. Nhưng nó vẫn đang đổi: riêng tuần này đã thêm §9.5 (hai yêu cầu conformance) sau khi hỏi chuyên gia. Nếu có người áp dụng rồi mới đổi tiếp thì breaking change rất đắt; nhưng đóng băng sớm thì khoá luôn những sai lầm chưa kịp phát hiện.

**Câu hỏi**

1. Nên đóng băng v1.0 ở mốc nào — sau M3? sau M4 (đủ an toàn để người khác dùng)? hay sau khi có N trang thật áp dụng?
2. Có nên đánh số spec tách khỏi số phiên bản sản phẩm không? Hiện chúng đang lẫn.
3. Cơ chế tương thích ngược nào đáng dựng **từ bây giờ** để sau này đổi spec không phá trang cũ — `<meta name="livemcp" content="1.0">` đã đủ chưa, hay cần thêm gì?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R06 — Đo thế nào để biết chuẩn đang sống?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Lộ trình này toàn tiêu chí kỹ thuật ("agent nhận được tool mới", "sanitizer chặn được injection"). Nhưng không tiêu chí nào trả lời được câu quan trọng nhất: *chuẩn này có đang đi đúng hướng không?* Không có thước đo thì rất dễ làm xong tám milestone rồi mới phát hiện chẳng ai cần.

**Câu hỏi**

1. Với một chuẩn declarative giai đoạn sớm, **hai hoặc ba** chỉ số nào đáng theo dõi? Tôi đoán: số trang thật áp dụng, tỉ lệ tác vụ agent hoàn thành không cần người can thiệp, thời gian dev từ lúc đọc tài liệu tới lúc chạy được.
2. Có tín hiệu **sớm** nào cho biết chuẩn đang chết mà người trong cuộc thường bỏ qua không?
3. Nên có "trang thật đầu tiên ngoài demo-site" ở milestone nào? Tôi ngờ rằng càng để lâu càng dễ thiết kế chuẩn quanh chính demo của mình — một dạng overfit.

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

### R07 — Rủi ro lớn nhất mà lộ trình này chưa nhìn thấy?

**Mức:** tham-khảo · **Hỏi:** 2026-08-02 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Bảng rủi ro ở kiến trúc §9 liệt kê: prompt injection, banner debugger, MV3 SW bị kill, web khai sai, race seq, đụng tên tool. Bốn ngày qua cho thấy rủi ro thật lại đến từ chỗ **không có trong bảng**: một quyết định kiến trúc đã chốt và viết thành tài liệu (§2.2 "toạ độ là ngôn ngữ chung") hoá ra sai — nó đúng về mặt gọn mã nên nghe rất thuyết phục, và vì thế sống sót qua M0 rồi mới cắn ở M1.

Đó là loại rủi ro tôi không tự thấy được, vì nếu thấy thì đã không viết vào tài liệu.

**Câu hỏi**

1. Nhìn từ ngoài vào lộ trình này và kiến trúc hiện tại, **rủi ro lớn nhất mà chúng tôi chưa gọi tên** là gì?
2. Có giả định nào trong `project-ideal.md` mà anh/chị thấy đáng nghi không? Cụ thể là luận điểm nền: *"con người hoàn thành được luồng công việc mà không cần gọi JavaScript thì agent cũng phải làm được như vậy"* — nó có chỗ nào hổng không?
3. Câu mở: nếu chỉ được đổi **một** điều trong lộ trình này, anh/chị đổi gì?

#### ▸ Trả lời

*(chưa có)*

#### ▸ Ghi nhận & áp dụng

*(chưa có)*

---

<a id="quy-uoc-dung-file"></a>

## 7. Quy ước dùng file

### Vì sao một file, không phải một thư mục

`docs/consult/` (mỗi câu một file) dùng cho **câu hỏi kỹ thuật sâu** — dài, độc lập, có vòng đời riêng. File này dùng cho **câu hỏi về hướng đi** — chúng chỉ có nghĩa khi đọc cùng lộ trình, nên tách ra là làm mất ngữ cảnh.

Phân biệt khi phân vân: *"câu này trả lời xong thì đổi **mã**, hay đổi **thứ tự việc**?"* Đổi mã → `consult/`. Đổi thứ tự việc, phạm vi, hay ưu tiên → file này.

### Thêm câu hỏi mới

1. Cấp mã tiếp theo (`R08`, `R09`…). **Số không bao giờ tái sử dụng**, kể cả khi câu hỏi bị huỷ — nhờ vậy trích dẫn "R03" ở commit message hay chat luôn trỏ đúng chỗ.
2. Thêm một dòng vào **bảng mục 5**.
3. Thêm khối câu hỏi vào **cuối mục 6**, theo đúng khung: Bối cảnh → Câu hỏi đánh số → `▸ Trả lời` → `▸ Ghi nhận & áp dụng`.
4. Nếu câu hỏi ảnh hưởng một milestone, gắn `[Rxx]` vào dòng milestone đó ở mục 3.

Câu hỏi luôn **thêm vào cuối**, không chèn giữa — thứ tự trong file là thứ tự thời gian, đọc từ trên xuống là thấy được dự án đã nghĩ gì theo thời gian.

### Trả lời

- Chuyên gia chỉ viết trong mục `▸ Trả lời`. **Không sửa phần Bối cảnh và Câu hỏi** — giữ nguyên bản ghi "lúc đó chúng tôi hiểu vấn đề thế nào"; về sau thứ đó thường quý hơn cả câu trả lời.
- Thấy câu hỏi sai đề thì nói trong phần trả lời, đừng sửa câu hỏi.
- Nhiều người trả lời → mỗi người một đoạn riêng kèm tên và ngày, không ghi đè nhau. Ý kiến trái chiều được giữ nguyên cả hai.
- Trả lời xong: đổi trạng thái ở **cả** bảng mục 5 **và** dòng trạng thái của khối câu hỏi.

### Không dùng anchor link giữa các mục

Trích dẫn câu hỏi bằng mã trần (`R03`), không phải link. Tiêu đề còn đổi, mà link hỏng thì im lặng — trong khi `Ctrl+F "R03"` thì không bao giờ hỏng. Đây là file dùng lâu dài nên chọn thứ bền hơn thứ tiện.

### Sửa lộ trình

Lộ trình đổi thì **cập nhật tại chỗ** và tăng số phiên bản ở đầu file. Không giữ bản cũ trong file này — lịch sử đã nằm trong git. Ngoại lệ: khi đổi vì một câu trả lời, ghi lý do vào mục `▸ Ghi nhận & áp dụng` của câu đó, để về sau còn truy được *vì sao* đổi.
