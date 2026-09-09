# Lộ trình phát triển Live MCP

> **File này sống lâu dài và được sửa liên tục.** Nó vừa là lộ trình, vừa là nơi
> hỏi ý kiến chuyên gia về *hướng đi* — cách dùng ghi ở mục cuối cùng
> ([Quy ước dùng file](#quy-uoc-dung-file)). Đọc mục đó trước nếu bạn là người
> mới tham gia.

| | |
|---|---|
| Phiên bản | 1.3 — ghi lùi kênh Ask + Streamable HTTP; R08 vẫn đang chờ |
| Cập nhật | 2026-09-09 |
| Người đề xuất | Claude · duyệt: Fable |
| Trạng thái | ✅ M1.5 · ✅ M2 · ✅ ngoài lộ trình: kênh Ask + HTTP · ⏭ kế tiếp: **M4 (phần đã đổi vế)** rồi **M2.5 chạm thực địa** |
| Tài liệu nền | [`project-ideal.md`](project-ideal.md) · [`livemcp-architecture.md`](livemcp-architecture.md) §8 · [`livemcp-declarative-spec.md`](livemcp-declarative-spec.md) |

---

## 1. Đang ở đâu

**Xong:** M0 (walking skeleton) · M1 (form + gõ phím thật + schema converter) · lưới E2E trên Chrome thật (ngoài kế hoạch gốc) · M1.5 (vệ sinh bảo mật) · **M2 (đợi + DOM động + shadow DOM)** · **kênh Ask + Streamable HTTP (ngoài lộ trình, xem mục ngay dưới M2)**.

| Tầng bảo vệ | Số lượng | Bắt gì |
|---|---|---|
| Unit (vitest) | 128 | logic thuần: schema, định tuyến, thứ tự segment, bảng phím, cổng handshake, bộ lọc text, diff tool, waiter, race điều hướng, **hàng đợi Ask, guard HTTP, vòng MCP qua HTTP** |
| E2E (Playwright) | 30 | layout, focus thật, CDP thật, ba locale, vòng đời MV3, DOM động, shadow DOM |
| Tự kiểm trong production | 3 lớp | focus xác minh, hit-test, xác minh giá trị từng ô |

**Lỗ hổng đã biết trong lưới:** kênh Ask và transport HTTP **chưa có ca E2E nào** —
cả 42 test mới đều là unit. Với widget thì đúng là không nên test (thuần giao diện),
nhưng đường `trang → SW → server → agent → về đúng tab`, và đặc biệt ca *trả lời về
đúng lúc tab đang F5*, thì không phải giao diện: nó là loại lỗi chỉ browser thật mới
thấy. Ghi vào nợ kỹ thuật ở mục 4.

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

**N5 · Đối thủ không phải Imperative API, mà là "không cần chuẩn nào cả".** *(từ [R07])*
Agent thị giác không đòi trang hợp tác. Nếu ta vượt được khe hai-phía (trang chưa khai → agent vô giá trị; agent chưa có → khai báo vô giá trị) đúng lúc vision đã "đủ tốt, đủ rẻ", câu dev sẽ hỏi là *"sao tôi phải khai attribute?"*. Không đua độ phủ với vision — đứng ở chỗ vision không đứng được: **tất định · rẻ và nhanh · kiểm toán được**. Mọi lựa chọn tính năng và mọi câu quảng bá phải quy về được một trong ba chữ đó.

**N6 · Agent không có mắt — đó là tiền đề, không phải hệ quả.** *(từ [R07])*
Luận điểm nền *"người làm được không cần JS thì agent cũng làm được"* bỏ sót một thứ người mang theo mà agent không có: **kênh hồi phục bằng mắt**. Người điền sai thì nhìn thấy và tự sửa. Vì vậy phát biểu đúng phải là điều kiện: *mọi tín hiệu người dùng cần thấy để ra quyết định phải tồn tại dưới dạng text hoặc attribute*. Trang báo lỗi chỉ bằng màu viền, báo trạng thái chỉ bằng icon — đó là điểm mù đúng nghĩa, không phải ca hiếm.

---

## 3. Lộ trình đề xuất

### 3.1 Tổng quan và chỗ khác với kiến trúc §8

| | Kiến trúc §8 (gốc) | Sau khi duyệt | Lý do đổi |
|---|---|---|---|
| — | *(không có)* | **M1.5 — Vệ sinh bảo mật** ⬅ *mới, đang làm* | [R02]: lỗ đang mở **hôm nay**, không phải rủi ro tương lai |
| M2 | Đợi + DOM động | Đợi + DOM động, shadow DOM là **hạng mục cuối có quyền rơi** | [R01]: gộp *code* nhưng không gộp *cam kết* |
| — | *(không có)* | **Kênh Ask** ⬅ *ngoài lộ trình, đã làm* | nhu cầu dùng thật, không ai duyệt trước — xem mục ghi lùi |
| — | *(không có)* | **M2.5 — Chạm thực địa** ⬅ *mới* | [R06]/[R07]: demo-site không bao giờ phản bác mình |
| M3 | Tool tham số hoá + resource | *(giữ nguyên)* | |
| — | *(không có)* | **M3.5 — Validator & DX** ⬅ *mới* | N4: vòng phần thưởng quyết định chuẩn sống hay chết |
| M4 | Policy layer | Policy layer, **đã trừ phần lên M1.5**; confirm gate + rate limit **kéo lên trước M2.5** | `--http` mở endpoint ra internet → hai mục đó đổi vế trong phép thử của [R02] |
| M5 | Bee cursor | Bee cursor, **không nằm trên đường thi hành** | [R04]: đảo ngược kiến trúc §5.5 có chủ đích |
| M6 | Canvas + MPA + iframe | Canvas + MPA + iframe | |
| M7 | Đóng gói | Đóng gói; **Streamable HTTP đã làm sớm** ✅ | cần cắm claude.ai trước khi cần đóng gói | |

Hai thay đổi tôi đề xuất mà **chuyên gia bác lại một phần**, ghi ra để không quên: kéo cả M4 lên sớm (chỉ token + `toAgentText()` được kéo — phần còn lại bảo vệ người chưa tồn tại) và gộp shadow DOM vào M2 như hạng mục ngang hàng (thành hạng mục có quyền rơi).

Kích thước ghi theo **S / M / L** thay vì ngày. Lý do: bốn ngày qua cho thấy ước lượng theo ngày ở dự án này sai rất xa — riêng M1 tốn nhiều lượt gỡ hơn cả M0, và phần đắt nhất là *chẩn đoán*, thứ không ước lượng được. S/M/L nói được thứ tự ưu tiên mà không giả vờ chính xác.

---

### M1.5 — Vệ sinh bảo mật · **S** · ưu tiên 0 · [R02] [R05]

> Không phải "đầu tư bảo mật". Là khoá cửa trước khi đi ngủ — hai việc rẻ đóng đúng
> những lỗ **đang mở hôm nay**, không phải lỗ giả định.

**Mô hình đe doạ đã bị sửa.** Lộ trình v1.0 viết *"bất kỳ tiến trình local nào cũng nối được vào hub"*. Sai ở chỗ nhẹ tay: **bất kỳ trang web nào đang mở trong bất kỳ trình duyệt nào** cũng mở được WebSocket tới `127.0.0.1` — handshake WS không bị CORS chặn. Nghĩa là ranh giới "chưa demo cho ai" đã bị vượt qua **từ ngày đầu**: mỗi lần lướt web trong lúc server chạy, mọi trang ghé qua đều có cơ hội bắt tay với hub và điều khiển trình duyệt của chính chủ dự án. Đây là kịch bản drive-by thật, hôm nay.

**Việc cụ thể**

1. **Token pairing** — server sinh token lần chạy đầu, lưu vào file cấu hình người dùng; extension gửi kèm lúc handshake; sai token thì đóng socket ngay.
2. **Chặn origin trình duyệt** — WS đến từ một trang web luôn mang header `Origin: http(s)://…`, còn từ service worker của extension thì không. Trang web **không giả mạo được** header này, nên đây là bộ lọc rẻ và chặt hơn cả token cho đúng lớp tấn công trên. Làm cả hai: token là *xác thực*, origin là *chặn lớp*.
3. **`toAgentText()` — một cửa duy nhất** cho mọi chuỗi từ web đi tới agent. Hôm nay chỉ cần: cắt trần độ dài, vô hiệu hoá code-fence/delimiter để text trang không phá được khung bao nó, gắn nhãn nguồn. Giá trị nằm ở chỗ **có đúng một cửa** — M4 làm giàu bộ lọc sau mà không phải truy lại từng đường text. Đây là lý do phần này không đợi được M4: càng lùi thì số đường text phải bọc càng nhiều.
4. **Hợp đồng tương thích phía consumer** *([R05] câu 3)* — phải có **trước khi** tồn tại bất kỳ "trang cũ" nào, tức là bây giờ: gặp attribute `livemcp-*` lạ → bỏ qua, không bao giờ fail; gặp **major** spec lạ → nói rõ "trang khai spec vN, extension này hiểu vM" thay vì im lặng (N2).
5. **Hạ nhãn spec xuống draft** — `1.0` là lời hứa ổn định mà dự án chưa muốn giữ (bằng chứng: §9.5 vừa thêm tuần này). Meta tag chỉ khai **major**.

**Nghiệm thu** — Một trang web mở WS tới hub bị từ chối (cả khi đoán đúng cổng). Không có token → không nối được. Mọi text từ trang tới agent đi qua đúng một hàm, có test chứng minh text độc không phá được khung bao.

---

### M2 — Cơ chế đợi & DOM động · **L** · ✅ **xong 2026-08-03**

> Đây là milestone **quan trọng nhất còn lại**, vì nó là chỗ chứng minh luận điểm trung tâm của cả dự án.

Chủ dự án viết trong [`project-ideal.md`](project-ideal.md): *"DOM mới được sinh ra từ tương tác người dùng chứ nó hoàn toàn không tự sinh ra… agent phải học cách đợi của Playwright"*. Nếu mẫu **hành động → đợi → declarative mới → tool mới** chạy được, thì lập luận "không cần Imperative API" đứng vững. Nếu không, mọi thứ còn lại đều lung lay. M0/M1 mới chỉ chứng minh phần dễ hơn: form tĩnh.

**Việc cụ thể**

1. ✅ `MutationObserver` trong content script, lọc đúng theo declarative và debounce (kiến trúc §5.2) → `declarative_delta`.
2. ✅ Server phát `notifications/tools/list_changed` khi tool list đổi *(đã có từ M0)*; ✅ chống race sau navigation — **hoá ra `seq` một mình không đủ**, phải thêm `pageId`; kiến trúc §6.2 đã được sửa kèm lý do.
3. ✅ Waiter thật theo spec §7.2: `livemcp-state` → `livemcp-wait`/`wait-gone` → DOM lắng → timeout. **Ràng buộc từ [R07] câu 2 đã hiện thực:** state là **tối ưu hoá**, DOM lắng là **đường tin cậy**; `state="busy"` kẹt trong khi DOM đã lắng ≥2s thì đi tiếp và **cảnh báo to** thay vì đợi hết giờ.
4. ✅ Tool hệ thống `livemcp_wait(tool, gone?, timeoutMs?)` — cho agent chủ động đợi (§6.4). Nghe `store.onChange` chứ không polling, và **server tự đặt trần 60s** thay vì tin tham số agent gửi lên.
5. ✅ Trang demo: `dynamic.html` — menu danh mục sinh tool tại chỗ, kèm một nút **cố ý để state mục** làm ca kiểm cho ràng buộc trên.
6. ✅ **Shadow DOM** — *hạng mục cuối, có quyền rơi* (xem [R01]), nhưng bậc 1 xong nhanh nên làm luôn. Scanner đệ quy vào `shadowRoot`; observer gắn cho **từng** shadow root; `livemcp-ignore` và `hidden` nay đi xuyên được ranh giới shadow (`closest` thường dừng ở biên, làm vùng khai "bỏ qua" mất hiệu lực đúng chỗ cần nhất). Bốn cạm bẫy đã biết trước:
   - **Không có sự kiện nào báo `attachShadow`** — node có thể vào DOM trước rồi mới gắn shadow root. Ứng phó: mỗi lần xử lý node trong delta thì kiểm lại `el.shadowRoot`, chấp nhận trễ một nhịp mutation. **Không** monkey-patch `Element.prototype.attachShadow` — đường đó tiêm code vào trang, phá chính ranh giới content script.
   - **Map host → observer là chỗ rò rỉ bộ nhớ kinh điển.** *Đã né hẳn thay vì đi qua:* dùng **một** observer, và sau mỗi lần quét thì `disconnect()` rồi gắn lại toàn bộ. Disconnect xoá sạch mọi target cũ kể cả root đã mồ côi — không sổ sách, không `isConnected`, không rò rỉ.
   - **Hiệu năng**: `el.shadowRoot` không query được bằng selector nên phải đi qua từng element. Chỉ đi sâu ở lần quét đầu và trên subtree các node vừa thêm; tuyệt đối không walk cả trang mỗi mutation.
   - **Phần tử *slotted* nằm ở light DOM** — `querySelectorAll` trên document đã thấy nó rồi; đệ quy thêm qua `assignedElements` sẽ đếm trùng.

**Nghiệm thu — hai bậc** *(theo [R01])*

- **Bậc 1, bắt buộc** *(chính là luận điểm trung tâm)* — ✅ **đã đạt 2026-08-03**: agent gọi tool mở dropdown → đợi → **nhận được tool mới** sinh từ DOM mới → gọi tiếp → hoàn tất, không cần biết trước gì về dropdown đó. Bốn ca E2E ở `packages/e2e/tests/06-dynamic.spec.ts`, gồm cả ca `livemcp-state` mục không được treo agent. Còn nợ hạng mục 4 (`livemcp_wait`) và `seq` race.
- **Bậc 2, cố gắng** — ✅ **đã đạt 2026-08-03**: form trong shadow DOM chạy được, `fixme` ở `packages/e2e/tests/05-gaps.spec.ts` đã gỡ. Quyền rơi xuống M3 không cần dùng tới vì bậc 1 xong nhanh hơn dự tính.

**Rủi ro** — Observer bắn quá nhiều (trang React re-render liên tục) → bão `list_changed` làm ngộp agent. Ứng phó: debounce + so sánh nội dung, chỉ báo khi *tool list* đổi thật chứ không phải DOM đổi. Đây cũng là chỗ N2 cần được thiết kế vào từ đầu: delta sai thì hỏng im lặng.

---

### Ngoài lộ trình — Kênh Ask & Streamable HTTP · ✅ **làm 2026-08→09** · ghi lùi 2026-09-09

> **Mục này ghi lùi, và việc phải ghi lùi mới là điều đáng ghi nhất.** Từ
> 2026-08-03 (M2 xong) tới 2026-09-09, lộ trình đứng im trong khi hai tính năng
> lớn được làm xong: khoảng 2.800 dòng nằm trong cây làm việc suốt năm tuần,
> chưa commit, chưa có chỗ nào trong `docs/` nhắc tới. Không ai duyệt trước, và
> không ai *phản đối* — vì không ai nhìn thấy. Đây đúng là dạng hỏng mà N2 nói:
> nó không sai, nó chỉ **im lặng**.

**Vì sao chúng bị làm trước M2.5**, dù M2.5 mới là thứ chuyên gia chọn khi được
hỏi "nếu chỉ được đổi một điều": vì cả hai đến từ nhu cầu dùng **thật, hằng ngày**
của chủ dự án, còn M2.5 đến từ lập luận. Nhu cầu thật luôn thắng lập luận đúng khi
không có ai giữ thứ tự. Ghi ra đây để lần sau nhận ra sớm hơn, không phải để trách.

**1 · Kênh Ask** — widget nổi trên mọi trang: bôi đen → *Hỏi Claude*, hoặc `Alt+A`.
Câu hỏi vào hàng đợi server; agent nhận bằng `livemcp_ask_wait` (chặn tới 55s),
trả lời bằng `livemcp_ask_answer`, hỏi ngược bằng `livemcp_ask_followup`.
Kiến trúc và lý do từng quyết định: [`livemcp-architecture.md`](livemcp-architecture.md) §2.6.

Đây **không phải** một tính năng phụ của đường declarative — nó là **bề mặt sản
phẩm thứ hai**, đảo chiều chủ động so với phần còn lại của hệ (người dùng gọi,
agent chờ) và chạy trên *mọi* trang chứ không chỉ trang đã khai báo. Nó cũng là
ứng viên tự nhiên cho vòng phần thưởng ở M3.5: đây là thứ dùng được ngay mà
**không đòi trang hợp tác gì cả** — tức là nó đứng đúng chỗ N5 chỉ ra, và không
vướng khe hai-phía.

**2 · Streamable HTTP** — M7 hạng mục 2, kéo lên trước vì cần cắm claude.ai. Chi
tiết ba lớp cửa và quyết định "hai transport là quan hệ CỘNG": kiến trúc §2.5.

**Cái giá phải trả, ghi thẳng ra:**

| Món nợ | Vì sao nó là nợ |
|---|---|
| Không có ca E2E nào cho cả hai | 42 test mới đều là unit. Ca *"trả lời về đúng lúc tab đang F5"* — thứ mà `ask_hello` sinh ra để giải — chưa từng chạy trên browser thật |
| Bề mặt bảo mật nở ra trước khi M4 kịp làm | xem mục M4 dưới đây; đây là hệ quả trực tiếp |
| ~~Kênh Ask chưa có trong spec declarative~~ ✅ đã khai | nó không dùng attribute nào nên không thuộc spec — nhưng phải nói rõ điều đó, nếu không người đọc tưởng mình đọc thiếu. Đã thêm vào spec §1.2 ngày 09/09 |
| M2.5 bị đẩy lùi năm tuần | chỉ số ③ (§3.3) vì vậy vẫn chưa có điểm đo nào |

**Nghiệm thu (ghi lùi, đã đạt)** — Widget dùng được hằng ngày trên trang bất kỳ;
claude.ai nối được qua tunnel; 128 unit test xanh; build sạch. **Chưa đạt:** lưới
E2E chưa chạm tới cả hai.

---

### M2.5 — Chạm thực địa · **S** · ⬅ **mới** · [R06] [R07]

> Khi được hỏi *"nếu chỉ được đổi một điều trong lộ trình"*, chuyên gia chọn đúng
> mục này. Đó là lý do nó nằm ngay sau M2 chứ không nằm trong phần "sau này".

**Vì sao ở đây, không muộn hơn.** Demo-site không bao giờ phản bác mình — nó do chính mình thiết kế để chuẩn chạy đẹp. Trang của người khác thì có. Nguy cơ overfit compound theo tuần, nên gặp càng sớm thì mỗi lần bị phản bác càng rẻ. Nó cũng là thuốc cho đúng loại rủi ro đã cắn ở M1: quyết định nghe thuyết phục, sống sót chỉ vì chưa gặp thứ gì đủ lạ để phản bác.

**Việc cụ thể**

1. Lấy một app mã nguồn mở có **form thật** (booking / todo / admin), tự khai báo nó **trong vai bên thứ ba**.
2. **Luật chơi:** chỉ được sửa template của app, **không được sửa spec cho vừa tay**. Mỗi lần muốn "nới spec một tí cho xong" chính là chỗ dev thật sẽ bỏ cuộc → ghi thành backlog, không sửa ngay.
3. Trang này sau đó dùng lại ba lần: bộ E2E thứ hai, ví dụ trong tài liệu M3.5, và điểm đo cho chỉ số ③ ở mục 3.3.

**Nghiệm thu** — Agent hoàn thành một tác vụ đầu-cuối trên app không do mình thiết kế. Danh sách "chỗ muốn nới spec" được ghi lại đầy đủ — danh sách này *chính là* kết quả có giá trị nhất của milestone, không phải cái form chạy được.

---

### M3 — Tool tham số hoá & resource · **M** · ưu tiên 2

**Việc cụ thể**

1. `livemcp-arg` — gộp nhiều phần tử cùng `livemcp-name` thành một tool có tham số (spec §5.3). Hiện `findElement()` luôn lấy phần tử đầu tiên (`TODO(M3)` trong mã).
2. `livemcp-resource` → MCP resource; `livemcp_read_page(site)` (§6.4).
3. Cắt trần & chuẩn hoá text đọc từ trang (§5.4) — đã có `MAX_RESULT_CHARS`, cần áp cho resource.

**Nghiệm thu** — Danh sách sản phẩm lặp: agent gọi `add_to_cart(item: "iPhone 17")` trúng đúng dòng, không phải dòng đầu. Agent đọc được bảng giá qua resource mà không cần chụp màn hình.

---

### M3.5 — Validator & vòng phần thưởng cho dev · **M** · ⬅ **mới** · [R03]

> Chỗ lệch nhiều nhất so với kiến trúc gốc, và là chỗ chuyên gia ủng hộ mạnh nhất
> trong cả lộ trình.

Kiến trúc §9 có nhắc `npx livemcp-validate <url>` nhưng xếp nó vào phần "ứng phó rủi ro", không thành milestone. Theo N4, nó **không phải phần phụ mà là phần quyết định chuẩn sống hay chết**: độ sai của `livemcp-*` **vô hình với người viết** — y hệt ARIA hỏng mà dev không thấy vì không chạy screen reader. ARIA mất mười năm mới có công cụ kiểm; ta ship validator *cùng ngày* với chuẩn.

**Đừng dồn lint thành một cục** *([R03] câu 1)*. Nhiều rule sinh ra tự nhiên như *công cụ gỡ lỗi của chính mình* — "`livemcp-wait` trỏ selector không tồn tại" chính là thứ sẽ thèm có khi debug cơ chế đợi ở M2. Vậy: **mỗi milestone viết rule nó cần cho chính nó**; M3.5 chỉ là nơi **đóng gói** chúng thành trải nghiệm dev. Nhờ vậy M3.5 co lại còn đúng phần giá trị riêng của nó: vòng phần thưởng.

**Việc cụ thể**

1. **Đóng gói lint thành panel** — gom rule đã viết rải rác ở M2/M3 vào một chỗ dev nhìn thấy được. Rule ưu tiên **cao nhất: state-rot** (`livemcp-state` không khớp thực tế) — theo [R07] đây sẽ là *chuyện thường* ngoài thực địa, không phải ngoại lệ. Các rule khác: `livemcp-name` trên phần tử không focus được (spec §9.5.1), khai báo nằm trong **closed shadow root** (dùng `chrome.dom.openOrClosedShadowRoot` để *phát hiện* rồi báo lỗi tuân thủ, thay vì im lặng không thấy gì), schema nói `number` nhưng input là `text`, hai tool trùng tên, thiếu `livemcp-confirm` cho hành động có vẻ phá huỷ.
2. **Điều kiện bắt buộc: panel chạy được KHÔNG cần server** — chỉ extension + trang. Bước thử đầu tiên của dev không được đòi dựng cả hệ.
3. **Vòng phần thưởng dưới 5 phút** — dev thêm hai attribute → mở extension → *thấy* agent thao tác trên trang của mình, ngay. Phần "thấy được" dùng **highlight/pulse** quanh phần tử đang tác động: overlay vài chục dòng, một phần mười chi phí con ong (xem M5).
4. Trang tài liệu tối giản: copy-paste được, chạy được. Ví dụ lấy từ app thật ở M2.5.

**Chưa làm ở đây: CLI `npx livemcp-validate`** *([R03] câu 3)*. Muốn trung thực thì CLI phải dựng browser thật và **tái dùng đúng scanner của extension** — làm bây giờ là trả chi phí hạ tầng cho khách hàng chưa tồn tại. Làm rẻ bằng cách parse HTML tĩnh thì **nói dối**: nó sẽ pass những trang mà scanner thật fail (DOM động, shadow root), vi phạm N2. Chờ một adopter thật hỏi "cắm CI thế nào", rồi driver-hoá extension chứ không viết lại logic.

**Nghiệm thu** — Một dev lạ đọc tài liệu và làm form của họ chạy được với agent **trong dưới 15 phút**, không cần hỏi ai. Đo theo ba bậc, không cần đợi "tuyển được nhóm test":

1. *Tự đo có kỷ luật* — profile Chrome sạch, làm theo tài liệu **đúng từng chữ**, ghi lại mọi chỗ phải dùng "kiến thức ngầm" mới qua được. Mỗi chỗ đó là vài phút của người lạ.
2. *Dev-lạ nhân tạo* — đưa **chỉ tài liệu** (không repo, không chat sử) cho một agent LLM chưa từng thấy code, bảo nó khai báo một form mẫu. Chỗ agent hiểu sai tài liệu trùng đáng ngạc nhiên với chỗ người thật sẽ hiểu sai; rẻ và lặp lại được sau mỗi lần sửa docs.
3. *Người thật* — **N=1 đã là phép đo hợp lệ**; ba người là điểm chi phí/hiệu quả tốt.

---

### M4 — Policy layer (bảo mật) · **M** · **hai phần, hai mức ưu tiên** · [R02]

Kiến trúc §6.3 ghi rõ *"không được cắt xén khi triển khai"* và §8 ghi *"bắt buộc xong trước khi đưa ai khác dùng"*. Phần **token + `toAgentText()`** đã tách lên M1.5.

> **Sửa 2026-09-09 — milestone này vừa bị tách làm đôi bởi chính việc mình đã làm.**
> Lập luận cũ ("phần còn lại bảo vệ *người dùng tương lai* nên chưa gấp") dựa trên
> một tiền đề nay không còn đúng: rằng bề mặt duy nhất là WS hub trên máy này.
> `--http` + tunnel đưa endpoint MCP **ra internet**, và kênh Ask mở một đường text
> hai chiều chạy trên *mọi* trang. Áp lại đúng phép thử hai vế của [R02] —
> *(rẻ ∧ đóng lỗ đang mở hôm nay)* vs *(đắt ∨ bảo vệ người chưa tồn tại)* — thì hai
> mục đổi vế. Ba lớp cửa HTTP chặn **ai vào được**; không lớp nào chặn **vào rồi
> làm được gì**. Đó đúng là câu hỏi mà [R02] câu 3 bảo phải trả lời bằng *danh sách
> hành động được phép*, không bằng bộ lọc.

**Phần A — đã đổi vế, làm trước M2.5 · S · ưu tiên 1**

1. **Confirm gate** cho `livemcp-confirm` (MCP elicitation, fallback `confirmed: true`). Chỗ cắm đã có sẵn: `TODO(M4)` ở `mcp/server.ts`.
2. **Rate limit** ~2 action/giây/tab.

Hai mục này là **trần thiệt hại**, và chúng cần nhất đúng lúc M2.5 bắt đầu — vì M2.5 nghĩa là thả agent lên trang **không do mình viết**.

**Phần B — giữ nguyên ưu tiên 3** (bảo vệ người dùng tương lai, đúng phép thử cũ)

3. Origin allowlist: lần đầu gặp origin mới → hỏi user, lưu quyết định. Không allowlist → không quét, không thi hành.
4. Chặn `input[type=password]` — *đã có*, cần đưa vào settings.
5. Làm giàu `toAgentText()`: đóng khung mọi text từ web thành khối được đánh dấu rõ là **dữ liệu trang cung cấp, không phải chỉ thị**, với delimiter mà bước escape ở M1.5 bảo đảm trang không tự thoát ra được.

**Câu thiết kế đúng cho milestone này** *(từ [R02] câu 3)*: **không tồn tại phòng thủ kín cho prompt injection.** Vì thế lớp quyết định không phải lọc-xác-suất mà là **chặn-trần-thiệt-hại**. Sanitizer giảm *xác suất*; capability gate chặn *trần*. Câu phải trả lời được là: *"nếu injection **thành công**, nó làm được tối đa những gì?"* — và trả lời bằng **danh sách hành động agent được phép**, không phải bằng bộ lọc.

**Nghiệm thu** — Trả lời được câu in đậm ở trên bằng một danh sách hữu hạn, viết ra giấy. Một trang độc nhét `"ignore previous instructions"` vào `livemcp-description` không làm agent đổi hành vi; và kể cả khi nó đổi được, hành động phá huỷ vẫn vấp confirm gate.

---

### M5 — Bee cursor 🐝 · **M** · ưu tiên 4 · [R04]

Kiến trúc §5.5. Con ong bay tới vị trí, chân trái/phải theo click, kim ở miệng nhấp khi gõ.

**Giữ ở ưu tiên 4, vì N4 không đòi con ong** *([R04] câu 1)*. Tách hai nhu cầu cho đúng vai: *vòng phần thưởng* cần dev **thấy** agent đang thao tác — nhu cầu đó đã được đáp ứng bằng highlight/pulse ở M3.5. Con ong là thứ khác: nó là **cá tính sản phẩm**, thứ người ta chụp màn hình và kể lại cho nhau. Đừng để N4 đứng ra bảo lãnh cho nó — *phần thưởng cần thấy được, không cần đáng yêu*. Khi đến lúc quảng bá, con ong sẽ là ngôi sao, đúng lúc sản phẩm đã đáng tin để được quảng bá.

**Invariant — ong quan sát hành động; hành động không bao giờ đợi ong** *([R04] câu 3)*. Kiến trúc §5.5 hiện ghi *"SW chờ content script báo ong đã tới nơi rồi mới dispatch"* — câu đó đặt một chặng nhắn tin bất đồng bộ **và một failure mode mới** vào đúng con đường đã tốn nhiều học phí nhất của dự án. **Đảo lại:** fire-and-forget, lệch một nhịp là cái giá đúng. Muốn khớp nhịp cho đẹp mắt thì dùng một delay hằng số vài trăm ms phía dispatch — *một con số, không phải một round-trip*. Sửa §5.5 khi đến M5 và ghi rõ đây là đảo ngược có chủ đích.

**Hai ràng buộc còn lại**

- Overlay `pointer-events: none` là **bắt buộc** — con ong không bao giờ được chặn chính cú click nó đang biểu diễn. Animation lỗi thì vẫn phải dispatch.
- **Mặc định tắt trong E2E**, và phải có cờ tắt. Animation thêm nhiễu thời gian (screenshot lệch, timing dao động). Rủi ro thứ hai tinh vi hơn: hiệu ứng đẹp **che lỗi thật** — người thấy ong bay tới đúng chỗ rồi *tin* rằng hành động đã trúng, trong khi click trượt vẫn im lặng như cũ. Con ong không thay được ba tầng tự kiểm đang có.

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
2. ~~Streamable HTTP transport (kiến trúc §2.5)~~ **✅ xong** — `--http` bật THÊM
   transport HTTP bên cạnh stdio (không loại trừ nhau: cả hai cùng cần WS hub 8787).
   Cửa vào ba lớp ở `packages/server/src/http/guard.ts`: Origin chặn trình duyệt,
   Host chặn DNS rebinding, Bearer xác thực. Hướng dẫn Cloudflare Tunnel ở README.
3. Tài liệu người dùng, gồm **ghi rõ ranh giới sản phẩm**: banner debugger không tắt được; một số site chống bot sẽ chặn agent (quyết định có ý thức ở [`consult/Q01`](consult/Q01-focus-thay-click.md) câu 3, không phải thiếu sót).

---

### 3.3 Thước đo: làm sao biết chuẩn đang sống · [R06]

Lộ trình trên toàn tiêu chí kỹ thuật. Không tiêu chí nào trả lời được câu quan trọng nhất — *chuẩn này có đang đi đúng hướng không?* Ba chỉ số dưới đây trả lời câu đó, và **cả ba đều đo được ngay bây giờ**, không cần chờ có người dùng.

| | Chỉ số | Đo cái gì | Bắt đầu đo từ |
|---|---|---|---|
| ① | Tỉ lệ agent hoàn thành tác vụ **đầu-cuối không cần người can thiệp**, trên một bộ kịch bản cố định | *consumer đủ mạnh chưa* | ngay — lưới E2E hiện tại là mầm của nó |
| ② | **Time-to-first-success của dev lạ** (con số 15 phút ở M3.5) | *phần thưởng có đổi được không* | M3.5 |
| ③ | **Số thay đổi spec bị ép ra bởi mỗi trang thật mới** | *hội tụ hay đang overfit demo* | M2.5 |

Chỉ số ③ thay cho "số trang áp dụng" mà tôi định dùng: ở giai đoạn này con số đó sẽ là 0, hoặc là số **tự mình tạo ra** — cả hai đều không mang thông tin. Để dành nó cho giai đoạn sau. Trang thật thứ N mà **không ép đổi gì nữa** nghĩa là spec đã khớp thực địa; ③ vì vậy kiêm luôn tiêu chí đóng băng spec bên dưới.

**Tín hiệu chết sớm — điểm chung: tất cả đều là *sự im lặng*, và người trong cuộc đọc im lặng thành "chưa ai biết tới thôi".**

- Mọi câu hỏi và issue đều do chính tác giả đặt — chưa ai va vào chuẩn đủ mạnh để vấp.
- Tích hợp nào cũng cần tác giả ngồi cạnh mới xong — chuẩn đang thở bằng hô hấp nhân tạo.
- Người thử một lần **không quay lại** — im lặng sau lần đầu là tín hiệu mạnh hơn mọi lời chê.
- Consumer tiềm năng chọn **tự suy luận lại từ DOM** thay vì đọc khai báo — thị trường đang nói phần khai báo không đáng công viết. *(Đây chính là N5 hiện hình.)*

Đây là N2 áp lên sản phẩm chứ không phải lên mã: hỏng phải ồn ào. **Dựng ống nghe từ đầu** — một kênh feedback, một issue template "tôi kẹt ở bước này" — vì không có ống nghe thì mọi cái chết đều im lặng.

### 3.4 Khi nào đóng băng spec · [R05]

**Không đóng băng theo milestone.** Milestone đo *sản phẩm của mình*, spec phải đúng cho *trang của người khác* — hai thứ hội tụ theo nhịp khác nhau. Hai điều kiện, phải đạt **cả hai**:

- **(a)** Validator M3.5 tồn tại. Viết rule kiểm chính là bài thử độ chặt của câu chữ spec: chỗ mơ hồ sẽ lộ ra đúng lúc cố biến nó thành rule máy chạy được.
- **(b)** Đã có 2–3 trang thật ngoài demo-site áp dụng, và **chỉ số ③ giảm về 0**.

Theo lộ trình hiện tại: sớm nhất là sau M3.5 cộng trang thật đầu tiên. **Trước đó mọi bản đều là draft — và phải nói thẳng như vậy** (đã làm ở M1.5).

Ba quy tắc tương thích ngược, rẻ, không cần máy móc:

1. **Tiến hoá additive trong một major** — attribute mới luôn optional với default an toàn; đổi nghĩa hay bỏ attribute là việc của major mới. Đây là hợp đồng ràng phía *spec*.
2. **Hợp đồng phía consumer** — attribute lạ thì bỏ qua, major lạ thì nói to. Đây là hợp đồng ràng phía *extension*, và phải có trước khi tồn tại "trang cũ" nào → đã đưa vào M1.5.
3. **Kênh di trú = validator** — thứ gì deprecated thì validator cảnh báo trước một chặng dài rồi mới bỏ hẳn ở major sau.

Đừng dựng cơ chế negotiation cho một v2 giả định. Với chuẩn chưa có người dùng, ba quy tắc trên là **toàn bộ** phần tương thích ngược đáng trả tiền.

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
| Ranh giới "ngoài phạm vi v1" chưa khai trong spec: contenteditable/rich-text (IME, định dạng), drag-and-drop thật, slider tuỳ chế | [R07] câu 2 | **khai ngay ở M1.5** — ranh giới khai ra là *quyết định*, không khai là *lỗ hổng chờ người dùng phát hiện* (N2) |
| Kiến trúc §5.5 còn ghi "SW chờ ong tới nơi rồi mới dispatch" | [R04] câu 3 | sửa khi đến M5, ghi rõ là đảo ngược có chủ đích |
| Kênh Ask & transport HTTP **chưa có ca E2E nào** | mục ghi lùi ở §3 | ưu tiên cao nhất trong bảng này. Ít nhất một ca: trả lời về **đúng lúc tab đang F5** (đường `ask_hello`) — đây là loại lỗi chỉ browser thật mới thấy, và là lý do cơ chế đó tồn tại. Widget thuần giao diện thì không test |
| `--http-no-auth` chỉ được bảo vệ bằng một dòng cảnh báo | kiến trúc §2.5 | đủ cho hôm nay vì chỉ chủ dự án dùng. Trước khi mời ai khác: bắt buộc khai một cờ thứ hai, hoặc từ chối chạy nếu không có bằng chứng có hạ tầng chắn phía trước |
| Giá trị option của `select`/`radio` **chưa qua** `toAgentText()` | M1.5, `parser/schema.ts` | M4. Đây là giá trị định danh phải khớp chính xác với trang **và** với `validateArgs`, nên làm sạch một phía sẽ khiến agent gửi giá trị đã sửa rồi bị chính ta từ chối. Chỗ đúng để chuẩn hoá là content script, tức phải sửa cả hai đầu cùng lúc. |

---

## 5. Bảng câu hỏi cho chuyên gia

| Mã | Chủ đề | Mức | Trạng thái | Ngày hỏi | Người trả lời |
|---|---|---|---|---|---|
| R01 | Gộp shadow DOM vào M2, hay tách riêng? | quan-trọng | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R02 | Bảo mật ở M4 có quá muộn không? | **chặn** | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R03 | Chèn M3.5 Validator — đúng chỗ chưa? | **chặn** | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R04 | Con ong: làm sớm hay để cuối? | tham-khảo | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R05 | Khi nào đóng băng spec v1.0? | quan-trọng | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R06 | Đo thế nào để biết chuẩn đang sống? | quan-trọng | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R07 | Rủi ro lớn nhất mà lộ trình này chưa thấy? | tham-khảo | 🔧 đang áp dụng | 2026-08-02 | Fable |
| R08 | Ba phát biểu kiến trúc đã phải sửa sau khi va thực tế — có cách bắt sớm không? | quan-trọng | ⏳ chờ | 2026-08-03 | |

*Trạng thái: ⏳ chờ · ✅ đã trả lời · 🔧 đang áp dụng · ✔ khép lại*

---

## 6. Nhật ký hỏi–đáp

> Chuyên gia viết vào mục `▸ Trả lời` của từng câu. **Không sửa phần câu hỏi** —
> nếu thấy câu hỏi sai đề thì nói ra trong phần trả lời. Chi tiết quy ước ở
> [mục 7](#quy-uoc-dung-file).

---

### R01 — Gộp shadow DOM vào M2, hay tách thành milestone riêng?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Scanner hiện dùng `root.querySelectorAll`, vốn không xuyên qua shadow root, nên form khai báo đúng chuẩn nằm trong shadow DOM **chưa bao giờ được phát hiện**. Lưới E2E đã ghi việc này thành `test.fixme`.

Lý do tôi muốn gộp vào M2: cả hai cùng đụng scanner và MutationObserver, mà observer của `document` **không** thấy thay đổi bên trong shadow tree — làm tách ra thì phải sửa đúng một chỗ hai lần.

Lý do tôi phân vân: nó làm M2 (vốn đã là **L**) phình thêm, mà M2 lại là milestone chứng minh luận điểm trung tâm — tôi không muốn nó chậm vì một tính năng không liên quan tới luận điểm đó.

**Câu hỏi**

1. Gộp vào M2 hay tách riêng sau M3?
2. Trong thực tế, tỉ lệ trang dùng web component/shadow DOM cho **form** có đủ cao để đây là việc phải làm sớm không? Hay đa số design system chỉ dùng shadow DOM cho component hiển thị, còn form vẫn ở light DOM?
3. Có cạm bẫy nào của việc quét đệ quy shadow root mà tôi nên biết trước — hiệu năng trên trang lớn, `mode: 'closed'`, slot/`assignedElements`?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — gộp vào M2, nhưng phân biệt *gộp code* với *gộp cam kết*.** Lý do gộp của bạn đúng: tách ra thì scanner và observer phải mở lại hai lần. Nhưng nỗi phân vân của bạn cũng đúng, và lời giải là xếp shadow DOM làm **hạng mục cuối của M2 với quyền rơi**: nghiệm thu M2 tách hai bậc — bậc 1 (bắt buộc, là luận điểm trung tâm) là vòng *hành động → đợi → tool mới*; bậc 2 (cố gắng) là gỡ `fixme` shadow DOM. Nếu M2 kéo dài, bậc 2 rơi xuống làm cùng M3 mà không ai phải áy náy, và không milestone mới nào phải sinh ra.

**Câu 2 — đáng làm sớm, nhưng không phải vì "đa số trang".** Thực địa chia hai thế giới: hệ React/Vue chủ đạo (MUI, Ant, Chakra, shadcn...) render form ở light DOM — đa số form thương mại nằm đây; còn các design system chuẩn web component (Shoelace, Material Web, Lit, Ionic, FAST/Fluent, Salesforce LWC, ServiceNow) đặt input *bên trong* shadow root — và đó lại là hệ sinh thái enterprise/nội bộ, đúng tệp "trang muốn agent-hoá có chủ đích" mà Live MCP dễ có người dùng thật đầu tiên. Tính theo *tỉ lệ trang*, shadow DOM là thiểu số; tính theo *tỉ lệ khách hàng tiềm năng sớm*, nó không nhỏ. Kết luận "M2-cuối, có quyền rơi" ở câu 1 là cân đúng giữa hai sự thật đó.

**Câu 3 — bốn cạm bẫy, cái cuối ít người biết:**

1. **Không có sự kiện nào báo `attachShadow`.** Node có thể vào DOM trước rồi mới gắn shadow root sau — observer `childList` không thấy gì cả. Ứng phó thực dụng: mỗi lần xử lý node trong delta, kiểm lại `el.shadowRoot`; chấp nhận trễ một nhịp mutation. Đừng monkey-patch `Element.prototype.attachShadow` — đường đó tiêm code vào trang, vi phạm chính ranh giới content script của bạn.
2. **Bookkeeping observer per-root là chỗ rò rỉ bộ nhớ kinh điển.** Giữ map host → observer, disconnect khi host rời DOM — và kiểm bằng `isConnected` trong nhịp rescan chứ đừng tin removal event luôn đến đủ.
3. **Hiệu năng:** tìm shadow root bắt buộc phải đi qua *từng element* (`el.shadowRoot` không query được bằng selector). Chỉ đi sâu kiểu đó ở lần quét đầu và trên subtree các node vừa thêm; tuyệt đối không walk cả trang mỗi mutation.
4. **`mode: 'closed'` không phải ngõ cụt với extension** — content script có `chrome.dom.openOrClosedShadowRoot(host)` xuyên được cả closed root. Spec cứ giữ yêu cầu `open` (đúng cho mọi consumer khác của chuẩn), nhưng *validator* nên dùng API này để phát hiện "khai báo nằm trong closed root" và báo thành lỗi tuân thủ — thay vì im lặng không thấy gì (N2).

Thêm một lưu ý đã có trong kiến trúc §5.3 nhưng dễ quên lúc code: phần tử *slotted* nằm ở light DOM — `querySelectorAll` trên document thấy nó rồi; đệ quy thêm qua `assignedElements` sẽ đếm trùng.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình.** Phân biệt *gộp code* với *gộp cam kết* là thứ tôi không nghĩ ra — tôi đang coi "gộp hay tách" là câu hỏi nhị phân, trong khi lời giải nằm ở chiều thứ ba: gộp code, tách nghiệm thu.

- M2 nghiệm thu **hai bậc**: bậc 1 (vòng *hành động → đợi → tool mới*) bắt buộc; bậc 2 (shadow DOM) có quyền rơi xuống M3. Thoả thuận trước nên rơi không phải là trượt.
- Bốn cạm bẫy đưa thẳng vào hạng mục 6 của M2 — đặc biệt "không có sự kiện báo `attachShadow`", thứ tôi chắc chắn sẽ đâm phải rồi mới hiểu.
- `chrome.dom.openOrClosedShadowRoot` **không** dùng để lách yêu cầu `open` của spec; nó thành **rule validator** ở M3.5: phát hiện khai báo nằm trong closed root và báo lỗi tuân thủ, thay vì im lặng không thấy gì (N2).
- Ghi lại lý do đáng nhớ nhất ở câu 2: tính theo *tỉ lệ trang* thì shadow DOM là thiểu số, nhưng tính theo *tỉ lệ khách hàng tiềm năng sớm* thì không — design system web-component (Shoelace, Material Web, LWC, Fluent) tập trung ở mảng enterprise/nội bộ, đúng tệp N5 chỉ ra là nơi *độ tin cậy thắng độ phủ*.

---

### R02 — Bảo mật ở M4 có quá muộn không?

**Mức:** **chặn** · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Kiến trúc §6.3 ghi *"không được cắt xén"*, §8 ghi *"bắt buộc xong trước khi đưa ai khác dùng"*. Nhưng hôm nay: WS bind `127.0.0.1` mà **không có token**, không origin allowlist, không sanitizer. Bất kỳ tiến trình local nào cũng nối được vào hub và điều khiển trình duyệt của người dùng.

Lập luận giữ nguyên M4: chưa ai dùng ngoài chủ dự án, nên rủi ro thực tế bằng 0; làm bảo mật sớm là trả chi phí cho một rủi ro chưa tồn tại.

Lập luận kéo lên sớm: ranh giới "chưa ai dùng" rất dễ bị vượt qua **không chủ ý** — chỉ cần demo cho một người, hoặc chính chủ dự án mở một trang lạ trong lúc server đang chạy. Và sanitizer thì càng lùi càng khó nhét vào, vì nó phải bọc mọi đường text từ web tới agent.

**Câu hỏi**

1. Có nên **tách M4** thành hai phần: phần bắt buộc-ngay (token pairing + sanitizer) kéo lên trước M2, phần còn lại (origin allowlist, confirm gate, rate limit) giữ ở M4?
2. Nếu chỉ được làm **một** thứ về bảo mật ngay bây giờ, thứ đó là gì?
3. Prompt injection được §9 xếp rủi ro cao nhất. Sanitize bằng cách strip mẫu chỉ thị ("ignore previous instructions"…) nghe như trò mèo vờn chuột — có cách nào **về bản chất** hơn không? Ví dụ đóng khung mọi text từ web trong một cấu trúc mà agent được dạy là dữ liệu, thay vì cố lọc nội dung?
4. Câu hỏi thật lòng: với một dự án cá nhân giai đoạn sớm, có phải tôi đang **lo quá mức** không? Đâu là ngưỡng hợp lý giữa "làm cho xong tính năng" và "làm cho an toàn" ở giai đoạn này?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — tách, và có một sự thật khiến việc này gấp hơn bạn đang trình bày.** Lập luận "chưa ai dùng nên rủi ro thực tế bằng 0" dựa trên một mô hình sai về bề mặt tấn công. Kẻ nối được vào `ws://127.0.0.1:8787` không chỉ là "tiến trình local": **bất kỳ trang web nào đang mở trong bất kỳ trình duyệt nào** cũng mở được WebSocket tới `127.0.0.1` — handshake WS không bị CORS chặn, và các cơ chế private-network-access hiện hành chưa che kín đường này. Nghĩa là ranh giới "chưa demo cho ai" đã bị vượt **từ ngày đầu**: mỗi lần bạn lướt web trong lúc server chạy, mọi trang bạn ghé đều có cơ hội thử bắt tay với hub và điều khiển trình duyệt của chính bạn. Đây là kịch bản drive-by thật, hôm nay, không phải rủi ro tương lai.

Vậy: **token pairing kéo lên ngay trước M2.** Nó cỡ S — sinh token lần chạy đầu, dán một lần vào popup, kiểm ở handshake — một buổi là xong và đóng đúng cái lỗ trên. Origin allowlist, confirm gate, rate limit giữ nguyên ở M4: chúng bảo vệ *người dùng tương lai*, chưa có người thì chưa cần.

**Câu 2 — token.** Rẻ nhất, và là thứ duy nhất đóng một lỗ *đang mở* chứ không phải lỗ giả định.

**Câu 3 — đúng, strip-pattern là mèo vờn chuột, và bạn đã tự trả lời một nửa: đóng khung cấu trúc. Ba tầng, theo độ "bản chất" tăng dần:**

1. **Chốt kiến trúc ngay bây giờ, chưa cần thông minh:** một hàm duy nhất kiểu `toAgentText()` mà **mọi** chuỗi từ web bắt buộc đi qua trước khi tới agent. Hôm nay nó chỉ cần cắt trần độ dài + escape markdown/code-fence (để text web không phá được khung bao nó) + gắn nhãn nguồn. Giá trị nằm ở chỗ *có đúng một cửa* — M4 làm giàu nội dung lọc sau mà không phải truy lại từng đường text. Đây chính là lý do phần này không đợi được M4: bạn nói đúng, càng lùi thì số đường text phải bọc càng nhiều.
2. **Đóng khung + dạy agent:** mọi text từ web nằm trong khối được đánh dấu rõ là *dữ liệu trang cung cấp, không phải chỉ thị*, với delimiter mà bước escape ở tầng 1 bảo đảm trang không tự thoát ra được. Không tuyệt đối, nhưng hơn hẳn đuổi bắt mẫu câu.
3. **Sự thật phải chấp nhận: không tồn tại phòng thủ kín cho prompt injection.** Vì thế lớp quyết định không phải lọc-xác-suất mà là **chặn-trần-thiệt-hại**: confirm gate cho hành động phá huỷ, origin allowlist, rate limit, chặn password. Sanitizer giảm xác suất; capability gate chặn trần. Câu thiết kế đúng là: *"nếu injection **thành công**, nó làm được tối đa những gì?"* — và trả lời bằng danh sách hành động agent được phép, không phải bằng bộ lọc.

**Câu 4 — bạn không lo quá mức; bạn đang lo *nhầm đơn vị*.** Ngưỡng hợp lý cho dự án cá nhân giai đoạn này là một phép thử hai vế: việc bảo mật nào **(rẻ ∧ đóng lỗ đang mở hôm nay)** thì làm ngay — token, chốt `toAgentText()`; việc nào **(đắt ∨ bảo vệ người chưa tồn tại)** thì để M4 — allowlist UI, elicitation, rate limit, settings. Theo thước đó, M4 nguyên khối bây giờ là quá sớm thật, nhưng hai việc kia không phải "đầu tư bảo mật" — chúng là vệ sinh, như khoá cửa nhà trước khi đi ngủ.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình, đang thi hành.** Câu trả lời **sửa mô hình đe doạ của tôi**, không chỉ sửa thứ tự việc — đó là phần đắt giá nhất ở đây.

Tôi viết "bất kỳ *tiến trình local* nào cũng nối được vào hub" và tự trấn an bằng "chưa demo cho ai". Sự thật: **bất kỳ *trang web* nào** cũng mở được WS tới `127.0.0.1` — handshake WS không bị CORS chặn. Nghĩa là ranh giới "chưa ai dùng" đã bị vượt **từ ngày đầu**, mỗi lần chủ dự án lướt web trong lúc server chạy. Lập luận "rủi ro thực tế bằng 0" của tôi không sai vì thiếu thận trọng — nó sai vì **đếm nhầm ai là kẻ nối được**.

- **M1.5 mới**, ưu tiên 0, chèn trước M2: token pairing + `toAgentText()`.
- **Thêm một việc ngoài câu trả lời**: chặn origin `http(s)://` ở handshake. Trang web không giả mạo được header `Origin`, còn SW của extension thì không gửi origin web — bộ lọc này chặn đúng *lớp* tấn công vừa được chỉ ra, trong khi token *xác thực* danh tính. Rẻ cả hai, làm cả hai.
- Phần còn lại (allowlist, confirm gate, rate limit) **giữ nguyên M4**, đúng phép thử hai vế: chúng bảo vệ người dùng chưa tồn tại.
- Nghiệm thu M4 viết lại theo câu 3: từ *"lọc được injection"* sang ***"nếu injection thành công, nó làm được tối đa những gì?"*** — trả lời bằng danh sách hành động được phép, không bằng bộ lọc. Sanitizer giảm xác suất, capability gate chặn trần; nhầm hai thứ này là tự ru ngủ.
- Phép thử hai vế **(rẻ ∧ đóng lỗ đang mở)** vs **(đắt ∨ bảo vệ người chưa tồn tại)** giữ lại làm thước phân loại cho mọi việc bảo mật phát sinh sau này.

---

### R03 — Chèn M3.5 "Validator & vòng phần thưởng" — đúng chỗ chưa?

**Mức:** **chặn** · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Đây là chỗ tôi lệch nhiều nhất khỏi kiến trúc gốc, dựa trên chẩn đoán ở [`consult/Q06`](consult/Q06-ranh-gioi-chuan-declarative.md): nguyên nhân tử vong số một của chuẩn declarative là *không có phần thưởng tức thì cho người khai*, và extension chính là "rich snippet" của dự án này.

Nhưng tôi cũng ý thức được một điều: Live MCP **chưa có người dùng nào**. Tối ưu cho adoption khi chưa ai biết tới có thể là tối ưu quá sớm — cổ điển. Có thể thứ đúng là làm cho sản phẩm mạnh đã (M2/M3), rồi mới lo chuyện người ta có dùng được không.

**Câu hỏi**

1. M3.5 đặt sau M3 có đúng không, hay nên sớm hơn/muộn hơn?
2. Với một chuẩn **chưa có người dùng nào**, thứ tự đúng là "làm sản phẩm mạnh trước" hay "làm vòng phần thưởng trước"? Có mẫu nào từ các chuẩn đã thành công không?
3. Giữa **lint trong extension** và **CLI `npx livemcp-validate <url>`** (kiến trúc §9 nhắc cái sau), cái nào đáng làm trước? Trực giác của tôi là lint trong extension, vì nó ở đúng nơi dev đang nhìn — nhưng CLI thì cắm được vào CI.
4. Tiêu chí nghiệm thu tôi đặt là *"dev lạ làm form chạy được trong dưới 15 phút"*. Con số đó có hợp lý không, và có cách nào đo nó mà không cần tuyển người thật?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Chèn M3.5 là quyết định đúng — đây là chỗ lệch khỏi kiến trúc gốc mà tôi ủng hộ mạnh nhất trong cả lộ trình.** Các câu dưới chỉ tinh chỉnh vị trí và cách làm.

**Câu 1 — sau M3 là đúng, với một chỉnh: đừng dồn lint thành một cục.** Nhiều rule lint sinh ra tự nhiên như *công cụ gỡ lỗi của chính bạn* trong M2/M3 — "`livemcp-wait` trỏ selector không tồn tại" chính là thứ bạn sẽ thèm có khi debug cơ chế đợi ở M2. Vậy: mỗi milestone viết rule nó cần cho chính nó; M3.5 là nơi **đóng gói** chúng thành trải nghiệm dev (panel, nút thử-ngay, tài liệu), không phải nơi bắt đầu viết chúng. Cách này M3.5 co lại còn đúng phần giá trị riêng: vòng phần thưởng.

**Câu 2 — thứ tự đúng là: consumer chạy được trước, phần thưởng ngay sau, cả hai xong trước khi mời ai.** Nhìn các chuẩn sống: schema.org ra mắt khi *bên tiêu thụ* (Google) đã hoạt động và phần thưởng đổi được ngay — không hề có giai đoạn "chuẩn mạnh nhưng chưa ai được thưởng". MCP cũng vậy: spec + SDK + client chạy được cùng ngày. Bài học ngược chiều: phần thưởng chỉ có nghĩa khi consumer đủ mạnh để trao nó — dev khai đúng chuẩn mà agent vẫn vấp (vì thiếu M2/M3) là **phản-phần-thưởng**, tệ hơn không có gì, vì họ không quay lại (xem R06 câu 2). Nên M2 → M3 → M3.5 không phải nhượng bộ mà là đúng thứ tự nhân quả. Còn nỗi lo "tối ưu adoption quá sớm" của bạn đúng ở nghĩa khác: M3.5 không nhắm "nhiều dev" — nó chỉ cần đủ tốt cho **một dev thật đầu tiên**. R06 câu 3 và câu này là một.

**Câu 3 — lint trong extension trước; CLI khi có người thật cần CI.** Đồng ý với trực giác của bạn, thêm hai lý do kỹ thuật: *(i)* CLI muốn trung thực phải dựng browser thật và **tái dùng đúng scanner của extension** — tức nó là bài toán đóng gói headless-Chrome-plus-extension, làm bây giờ là trả chi phí hạ tầng cho khách hàng chưa tồn tại; *(ii)* làm CLI rẻ bằng cách parse HTML tĩnh thì **nói dối** — nó sẽ pass những trang mà scanner thật fail (DOM động, shadow root), vi phạm N2. Chờ một adopter thật hỏi "cắm CI thế nào" rồi làm CLI bằng cách driver-hoá extension, không viết lại logic. Một điều kiện cho lint-trong-extension: panel phải chạy được **không cần server** (chỉ extension + trang), để bước thử đầu tiên của dev không đòi dựng cả hệ.

**Câu 4 — 15 phút là mục tiêu đúng cỡ, và đo được trước khi có người thật, theo ba bậc:**

1. *Tự đo có kỷ luật:* profile Chrome sạch, làm theo tài liệu **đúng từng chữ**, ghi lại mọi chỗ phải dùng "kiến thức ngầm" mới qua được — mỗi chỗ đó là vài phút của người lạ.
2. *Dev-lạ nhân tạo:* đưa **chỉ tài liệu** (không repo, không chat sử) cho một agent LLM chưa từng thấy code, bảo nó khai báo một form mẫu. Chỗ agent hiểu sai tài liệu trùng đáng ngạc nhiên với chỗ người thật sẽ hiểu sai — rẻ, lặp lại được mỗi lần sửa docs.
3. *Người thật, nhưng chỉ cần một:* một người lạ tìm ra phần lớn chỗ kẹt; ba người là điểm chi phí/hiệu quả tốt. Tiêu chí "đo trên người thật" của bạn giữ nguyên — chỉ cần biết rằng N=1 đã là một phép đo hợp lệ, đừng đợi "tuyển được nhóm test" mới bắt đầu.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình.** M3.5 giữ nguyên vị trí sau M3, nhưng **co lại** và đổi bản chất.

- **Lint không còn là việc của riêng M3.5.** Mỗi milestone viết rule nó cần cho chính nó; M3.5 chỉ *đóng gói*. Điều này giải luôn một mâu thuẫn tôi chưa nhận ra: rule "`livemcp-wait` trỏ selector không tồn tại" là công cụ gỡ lỗi tôi sẽ **cần ở M2**, mà lại đang xếp vào milestone sau — tức là tự bắt mình debug tay việc mà công cụ làm được.
- Thêm **điều kiện bắt buộc**: panel chạy được **không cần server**. Bước thử đầu tiên của dev không được đòi dựng cả hệ — thứ này quyết định con số 15 phút nhiều hơn cả chất lượng tài liệu.
- **CLI validator hoãn có điều kiện**, chờ adopter thật hỏi "cắm CI thế nào". Lý do (ii) là thứ tôi đã suýt làm sai: CLI parse HTML tĩnh cho rẻ sẽ **pass những trang mà scanner thật fail** — một validator nói dối còn tệ hơn không có validator (N2).
- Nghiệm thu 15 phút giữ nguyên, thêm **ba bậc đo**. Bậc 2 (đưa *chỉ tài liệu* cho một agent LLM chưa thấy repo) là thứ tôi làm được ngay và lặp lại được sau mỗi lần sửa docs.
- Ghi lại câu chỉnh quan trọng nhất ở câu 2: **phần thưởng chỉ có nghĩa khi consumer đủ mạnh để trao nó.** Dev khai đúng chuẩn mà agent vẫn vấp là *phản-phần-thưởng* — tệ hơn không có gì, vì họ không quay lại. Vậy M2 → M3 → M3.5 không phải nhượng bộ mà là đúng thứ tự nhân quả. Và nỗi lo "tối ưu adoption quá sớm" của tôi được trả lời gọn: M3.5 không nhắm "nhiều dev", nó chỉ cần đủ tốt cho **một dev thật đầu tiên**.

---

### R04 — Con ong 🐝: làm sớm hay để cuối?

**Mức:** tham-khảo · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Con ong là ý tưởng riêng của chủ dự án, có trong `project-ideal.md` từ đầu: bay tới vị trí tương tác, chân trái/phải theo click, kim ở miệng nhấp khi gõ. Kiến trúc xếp nó ở M5.

Tôi xếp nó ưu tiên 4 (sau bảo mật) vì nó không mở khoá năng lực nào. Nhưng tôi ngờ rằng mình đang đánh giá thấp nó: theo N4, thứ khiến người ta *thấy* sản phẩm hoạt động chính là thứ khiến chuẩn lan ra. Con ong làm cho một thứ vô hình (agent đang thao tác) trở thành hữu hình — và đó có thể là toàn bộ giá trị của nó.

**Câu hỏi**

1. Ở vị trí ưu tiên 4 là hợp lý, hay nên kéo lên cùng M3.5 như một phần của vòng phần thưởng?
2. Có rủi ro nào khi làm hiệu ứng thị giác *trước* khi luồng chức năng ổn định không — kiểu animation che mất lỗi thật, hoặc làm chậm chẩn đoán?
3. Kiến trúc ghi *"SW chờ content script báo ong đã tới nơi rồi mới dispatch"*. Điều đó thêm một chặng bất đồng bộ vào đúng đường thi hành — chỗ đã tốn nhiều công gỡ. Có nên tách hẳn: **ong chạy song song, không bao giờ nằm trên đường thi hành**, chấp nhận hiệu ứng lệch một nhịp so với hành động?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — giữ ưu tiên 4, vì N4 không đòi con ong.** Tách nhu cầu cho đúng vai: vòng phần thưởng cần dev *thấy agent đang thao tác trang của họ* — nhu cầu đó được đáp ứng bằng một **highlight/pulse** quanh phần tử đang tác động: một overlay vài chục dòng, làm ngay trong M3.5 với một phần mười chi phí con ong. Con ong là thứ khác: nó là *cá tính sản phẩm* — thứ người ta chụp màn hình và kể lại cho nhau. Cả hai đều có giá trị, nhưng đừng để N4 đứng ra bảo lãnh cho con ong: **phần thưởng cần thấy được, không cần đáng yêu.** Pulse ở M3.5, ong ở M5 — và khi đến lúc quảng bá, con ong sẽ là ngôi sao, đúng lúc sản phẩm đã đáng tin để được quảng bá.

**Câu 2 — có, hai rủi ro cụ thể:** *(i)* animation thêm nhiễu thời gian vào E2E (screenshot lệch, timing dao động) — con ong phải có cờ tắt và **mặc định tắt trong E2E**; *(ii)* hiệu ứng đẹp che lỗi thật: người nhìn thấy ong bay tới đúng chỗ và *tin* rằng hành động đã trúng, trong khi click trượt vẫn im lặng như cũ. Con ong không thay được ba tầng tự kiểm đang có — đừng để nó làm mềm kỷ luật đó.

**Câu 3 — tách hẳn, dứt khoát, và đáng nâng thành invariant.** "SW chờ ong tới nơi rồi mới dispatch" đặt một chặng nhắn tin bất đồng bộ *và một failure mode mới* vào đúng con đường đã tốn nhiều học phí nhất của dự án. Đảo nguyên tắc lại: **ong quan sát hành động; hành động không bao giờ đợi ong.** Fire-and-forget; lệch một nhịp là cái giá đúng. Nếu về sau muốn khớp nhịp cho đẹp mắt, làm bằng một delay hằng số vài trăm ms phía dispatch — một con số, không phải một round-trip. Đề nghị sửa luôn câu tương ứng ở kiến trúc §5.5 khi đến M5, ghi rõ đây là đảo ngược có chủ đích.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình.** Con ong giữ ưu tiên 4, nhưng lý do giữ đã đổi hẳn.

- Tôi nghi mình *đánh giá thấp* con ong. Câu trả lời cho thấy tôi **gán nhầm vai**: nhu cầu N4 là "dev **thấy** agent đang thao tác", và nhu cầu đó được đáp ứng bằng một **pulse/highlight vài chục dòng** ở M3.5 — một phần mười chi phí. Con ong phục vụ nhu cầu khác: *cá tính sản phẩm*. Câu chốt đáng nhớ: **phần thưởng cần thấy được, không cần đáng yêu.**
- Pulse thêm vào M3.5 hạng mục 3; con ong ở lại M5.
- **Invariant mới, ghi thành chữ trong M5**: *ong quan sát hành động; hành động không bao giờ đợi ong.* Kiến trúc §5.5 hiện đang ghi ngược lại → thêm vào bảng nợ kỹ thuật, sửa khi đến M5. Đây là lần thứ hai một câu nghe hợp lý trong kiến trúc gốc hoá ra đặt thêm failure mode lên đúng đường thi hành (lần một là §2.2) — trùng hợp này tự nó là một dữ kiện.
- Rủi ro "hiệu ứng đẹp che lỗi thật" chưa từng có trong bảng rủi ro của tôi và đúng là thứ tôi sẽ mắc: thấy ong bay tới đúng chỗ rồi *tin* rằng hành động đã trúng. Ghi thành ràng buộc: con ong không thay được ba tầng tự kiểm, và **mặc định tắt trong E2E**.

---

### R05 — Khi nào đóng băng spec v1.0?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Spec đang mang số `1.0` và trang demo khai `<meta name="livemcp" content="1.0">`. Nhưng nó vẫn đang đổi: riêng tuần này đã thêm §9.5 (hai yêu cầu conformance) sau khi hỏi chuyên gia. Nếu có người áp dụng rồi mới đổi tiếp thì breaking change rất đắt; nhưng đóng băng sớm thì khoá luôn những sai lầm chưa kịp phát hiện.

**Câu hỏi**

1. Nên đóng băng v1.0 ở mốc nào — sau M3? sau M4 (đủ an toàn để người khác dùng)? hay sau khi có N trang thật áp dụng?
2. Có nên đánh số spec tách khỏi số phiên bản sản phẩm không? Hiện chúng đang lẫn.
3. Cơ chế tương thích ngược nào đáng dựng **từ bây giờ** để sau này đổi spec không phá trang cũ — `<meta name="livemcp" content="1.0">` đã đủ chưa, hay cần thêm gì?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — đừng đóng băng theo milestone; đóng băng theo bằng chứng bên ngoài.** Milestone đo *sản phẩm của bạn*, còn spec phải đúng cho *trang của người khác* — hai thứ hội tụ theo nhịp khác nhau. Tiêu chí đề xuất, cả hai phải đạt: *(a)* validator M3.5 tồn tại — vì viết rule kiểm chính là bài thử độ chặt của câu chữ spec, chỗ mơ hồ sẽ lộ ra khi cố biến nó thành rule máy chạy được; *(b)* đã có 2–3 trang thật ngoài demo-site áp dụng mà **số thay đổi spec bị ép ra bởi mỗi trang mới giảm về 0** (cùng thước đo với R06 câu 1 — trang mới không ép đổi gì nữa nghĩa là spec đã khớp thực địa). Theo lộ trình hiện tại: sớm nhất là sau M3.5 cộng trang thật đầu tiên. Trước đó, mọi bản đều là draft — và nên nói thẳng như vậy.

**Câu 2 — tách, ngay bây giờ, vì số hiện tại đang phát tín hiệu sai.** Spec mang nhãn `1.0` là lời hứa ổn định mà dự án chưa muốn giữ — bằng chứng là §9.5 vừa thêm tuần này. Đổi nhãn thành `0.x` hoặc `1.0-draft` hôm nay rẻ, để sau khi có người áp dụng mới đổi thì đắt. Sản phẩm (server/extension) đánh semver riêng bình thường. Meta tag chỉ nên khai **major** của spec: `content="1"` — minor không phải thứ trang cần khai, vì trong cùng major mọi thứ phải tương thích (câu 3).

**Câu 3 — meta tag chưa đủ; thứ đáng dựng từ bây giờ là ba quy tắc rẻ, không phải máy móc:**

1. **Quy tắc tiến hoá additive trong một major:** attribute mới luôn optional với default an toàn; đổi nghĩa hay bỏ attribute là việc của major mới. Đây là hợp đồng ràng phía *spec*.
2. **Hợp đồng phía consumer, viết vào spec ngay:** extension gặp attribute `livemcp-*` không biết → bỏ qua, không bao giờ fail; gặp major lạ → nói rõ "trang khai spec v2, extension này hiểu v1" thay vì im lặng (N2). Hai câu này quyết định trang cũ có sống qua các đợt đổi không, và phải nằm trong consumer **trước khi** tồn tại bất kỳ "trang cũ" nào — tức là bây giờ.
3. **Kênh di trú = validator:** thứ gì deprecated thì validator cảnh báo trước một chặng dài rồi mới bỏ hẳn ở major sau.

Đừng dựng cơ chế negotiation cho một v2 giả định — với chuẩn chưa có người dùng, ba quy tắc trên là toàn bộ phần tương thích ngược đáng trả tiền.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình, đang thi hành.** Thêm mục 3.4 và đưa hai việc rẻ vào M1.5.

- **Hạ nhãn spec xuống draft ngay** — `1.0` đang phát tín hiệu sai: nó là lời hứa ổn định mà dự án chưa muốn giữ, và bằng chứng nằm ngay trong lịch sử tuần này (§9.5 vừa thêm). Đổi bây giờ rẻ; đổi sau khi có người áp dụng thì đắt. Meta tag chỉ khai **major**.
- **Hợp đồng phía consumer đưa vào M1.5**, không đợi. Lý do là một điểm về *thời điểm* mà tôi bỏ sót: hai câu "attribute lạ thì bỏ qua / major lạ thì nói to" phải nằm trong extension **trước khi tồn tại bất kỳ trang cũ nào** — tức là bây giờ, khi số trang cũ đúng bằng 0. Muộn một ngày là muộn hẳn một thế hệ trang.
- **Tiêu chí đóng băng không theo milestone mà theo bằng chứng bên ngoài** — mục 3.4, hai điều kiện (a) validator tồn tại, (b) chỉ số ③ về 0. Ý sắc nhất: *viết rule kiểm chính là bài thử độ chặt của câu chữ spec*, nên (a) không phải điều kiện hành chính mà là phép thử thật.
- Câu trả lời khớp với R06 ở đúng một chỗ — chỉ số ③ vừa là thước hội tụ vừa là tiêu chí đóng băng. Ghi chéo ở cả hai mục để sau này không ai đo hai lần.

---

### R06 — Đo thế nào để biết chuẩn đang sống?

**Mức:** quan-trọng · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Lộ trình này toàn tiêu chí kỹ thuật ("agent nhận được tool mới", "sanitizer chặn được injection"). Nhưng không tiêu chí nào trả lời được câu quan trọng nhất: *chuẩn này có đang đi đúng hướng không?* Không có thước đo thì rất dễ làm xong tám milestone rồi mới phát hiện chẳng ai cần.

**Câu hỏi**

1. Với một chuẩn declarative giai đoạn sớm, **hai hoặc ba** chỉ số nào đáng theo dõi? Tôi đoán: số trang thật áp dụng, tỉ lệ tác vụ agent hoàn thành không cần người can thiệp, thời gian dev từ lúc đọc tài liệu tới lúc chạy được.
2. Có tín hiệu **sớm** nào cho biết chuẩn đang chết mà người trong cuộc thường bỏ qua không?
3. Nên có "trang thật đầu tiên ngoài demo-site" ở milestone nào? Tôi ngờ rằng càng để lâu càng dễ thiết kế chuẩn quanh chính demo của mình — một dạng overfit.

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — ba chỉ số, chỉnh lại một trong ba phỏng đoán của bạn:**

1. **Tỉ lệ agent hoàn thành tác vụ đầu-cuối không cần người can thiệp**, trên một bộ kịch bản cố định (đặt bàn, thêm giỏ, form nhiều bước) — thước "consumer đủ mạnh chưa". Lưới E2E hiện tại là mầm của nó.
2. **Time-to-first-success của dev lạ** (con số 15 phút ở R03) — thước "phần thưởng có đổi được không".
3. **Số thay đổi spec bị ép ra bởi mỗi trang thật mới** — thước hội tụ, thay cho "số trang áp dụng" mà bạn phỏng đoán. Trang mới thứ N mà không ép đổi gì nghĩa là chuẩn đang khớp thực địa; số này không giảm nghĩa là spec đang overfit demo. Nó kiêm luôn tiêu chí đóng băng của R05. Còn "số trang áp dụng" ở giai đoạn này sẽ là 0 hoặc là số bạn tự tạo — cả hai đều không mang thông tin; để dành nó cho giai đoạn sau.

**Câu 2 — tín hiệu chết sớm mà người trong cuộc hay đọc nhầm. Điểm chung của chúng: đều là *sự im lặng*, và người trong cuộc đọc im lặng thành "chưa ai biết tới thôi":**

- Mọi câu hỏi và issue đều do chính tác giả đặt — chưa ai va vào chuẩn đủ mạnh để vấp.
- Tích hợp nào cũng cần tác giả ngồi cạnh mới xong — chuẩn đang thở bằng hô hấp nhân tạo.
- Người thử một lần **không quay lại** — im lặng sau lần đầu là tín hiệu mạnh hơn mọi lời chê.
- Consumer tiềm năng chọn *tự suy luận lại từ DOM* thay vì đọc khai báo — thị trường đang nói phần khai báo không đáng công viết.

Đây là N2 của chính bạn áp lên sản phẩm: hỏng phải ồn ào. Hãy dựng ống nghe ngay từ đầu — một kênh feedback, một issue template "tôi kẹt ở bước này" — vì không có ống nghe thì mọi cái chết đều im lặng.

**Câu 3 — sớm hơn bạn định: ngay sau M2, trước khi viết tài liệu M3.5.** Nghi ngờ overfit của bạn đúng, và nó compound theo tuần. Cách làm rẻ, không cần tuyển ai: lấy một app mã nguồn mở có form thật (booking, todo, admin bất kỳ), tự khai báo nó **trong vai bên thứ ba** — luật chơi là chỉ được sửa template của app, không được sửa spec cho vừa tay. Mỗi lần bạn muốn "nới spec một tí cho xong" chính là chỗ dev thật sẽ bỏ cuộc — ghi lại thành backlog. Trang này sau đó dùng lại ba lần: bộ E2E thứ hai, ví dụ trong tài liệu M3.5, và điểm đo cho chỉ số 3 ở câu 1.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình.** Thêm mục 3.3 (ba chỉ số + tín hiệu chết sớm) và **M2.5 — Chạm thực địa**.

- **Bỏ "số trang áp dụng"** khỏi danh sách chỉ số. Lý do bác bỏ đúng và khó chịu: ở giai đoạn này con số đó bằng 0 hoặc bằng số **tự mình tạo ra** — cả hai đều không mang thông tin, mà một chỉ số không mang thông tin thì tệ hơn không đo, vì nó tạo cảm giác đang đo. Thay bằng ③ *số thay đổi spec bị ép ra bởi mỗi trang thật mới*.
- **M2.5 mới, ngay sau M2.** Điều làm tôi đổi ý không phải "nên có trang thật" mà là **luật chơi**: chỉ sửa template app, không sửa spec cho vừa tay, và mỗi lần muốn nới spec thì *ghi lại thay vì nới*. Không có luật đó thì "chạm thực địa" tự biến thành một buổi uốn spec cho khớp app — vẫn overfit, chỉ đổi đối tượng.
- Danh sách tín hiệu chết sớm đưa vào mục 3.3 nguyên văn. Điểm chung của chúng — *đều là sự im lặng, và người trong cuộc đọc im lặng thành "chưa ai biết tới thôi"* — là N2 áp lên sản phẩm chứ không phải lên mã. Kèm việc phải làm: **dựng ống nghe từ đầu** (kênh feedback, issue template "tôi kẹt ở bước này").
- Tín hiệu thứ tư — *consumer tiềm năng chọn tự suy luận lại từ DOM* — chính là N5 hiện hình. Hai câu trả lời R06 và R07 gặp nhau ở đúng điểm này.

---

### R07 — Rủi ro lớn nhất mà lộ trình này chưa nhìn thấy?

**Mức:** tham-khảo · **Hỏi:** 2026-08-02 · **Trạng thái:** 🔧 đang áp dụng

**Bối cảnh.** Bảng rủi ro ở kiến trúc §9 liệt kê: prompt injection, banner debugger, MV3 SW bị kill, web khai sai, race seq, đụng tên tool. Bốn ngày qua cho thấy rủi ro thật lại đến từ chỗ **không có trong bảng**: một quyết định kiến trúc đã chốt và viết thành tài liệu (§2.2 "toạ độ là ngôn ngữ chung") hoá ra sai — nó đúng về mặt gọn mã nên nghe rất thuyết phục, và vì thế sống sót qua M0 rồi mới cắn ở M1.

Đó là loại rủi ro tôi không tự thấy được, vì nếu thấy thì đã không viết vào tài liệu.

**Câu hỏi**

1. Nhìn từ ngoài vào lộ trình này và kiến trúc hiện tại, **rủi ro lớn nhất mà chúng tôi chưa gọi tên** là gì?
2. Có giả định nào trong `project-ideal.md` mà anh/chị thấy đáng nghi không? Cụ thể là luận điểm nền: *"con người hoàn thành được luồng công việc mà không cần gọi JavaScript thì agent cũng phải làm được như vậy"* — nó có chỗ nào hổng không?
3. Câu mở: nếu chỉ được đổi **một** điều trong lộ trình này, anh/chị đổi gì?

#### ▸ Trả lời

**Fable — 2026-08-02**

**Câu 1 — rủi ro lớn nhất chưa được gọi tên: đối thủ thật của Live MCP không phải Imperative API, mà là "không cần chuẩn nào cả".** Toàn bộ lộ trình đang đấu trận "declarative có thay được imperative không" — và đấu tốt. Nhưng cửa tử nằm ở trận khác: agent thị giác (computer-use) đang tiến rất nhanh, và nó **không đòi trang hợp tác**. Live MCP là chuẩn hai phía: giá trị phía agent bằng 0 khi chưa trang nào khai, giá trị phía trang bằng 0 khi chưa agent nào dùng. Nếu đến lúc vượt được khe hai-phía đó mà vision agent đã "đủ tốt, đủ rẻ", câu dev sẽ hỏi là: *"sao tôi phải khai attribute khi agent tự nhìn được trang?"*

Lối ra không phải chạy đua độ phủ với vision — là đứng ở chỗ vision không đứng được: **tính tất định** (cùng input, cùng kết quả, không "nhìn nhầm"), **chi phí và tốc độ** (không đốt token cho ảnh màn hình mỗi bước), và **khả năng kiểm toán** (tool khai báo = hợp đồng; confirm gate = phanh — thứ một doanh nghiệp có thể phê duyệt). Ba chỉ số ở R06 và cách kể chuyện sản phẩm nên xoay quanh đúng ba chữ đó, và tệp khách đầu tiên nên là nơi *độ tin cậy thắng độ phủ*: công cụ nội bộ doanh nghiệp, sản phẩm muốn tự agent-hoá cho người dùng của chính mình.

**Câu 2 — luận điểm nền có hai chỗ hổng thật và một điểm tự-mâu-thuẫn đáng ghi ra giấy:**

1. *"Con người làm được không cần JS"* bỏ qua việc con người mang theo một **kênh hồi phục** mà agent không có: mắt. Người điền sai thì *nhìn thấy* và tự sửa; agent chỉ có declarative làm giác quan. Chỗ trang truyền tín hiệu thuần thị giác — lỗi validation chỉ đổi màu viền, trạng thái chỉ hiện bằng icon — là điểm mù đúng nghĩa. Spec đã trả lời một phần bằng `livemcp-state`/`livemcp-result`, nhưng nên phát biểu thẳng thành điều kiện: *mọi tín hiệu người dùng cần thấy để ra quyết định phải tồn tại dạng text/attribute* — đó là **tiền đề** để luận điểm nền đứng vững, không phải hệ quả của nó.
2. Có những tương tác con người làm không cần JS của trang nhưng khó cho đường bàn phím: contenteditable/rich-text (IME, định dạng), drag-and-drop thật, slider tuỳ chế. Chưa cần giải; cần một dòng "ngoài phạm vi v1" tường minh trong spec — ranh giới khai ra là quyết định, không khai là lỗ hổng chờ người dùng phát hiện (N2).
3. Điểm tự-mâu-thuẫn: `livemcp-state` — xương sống cơ chế đợi — chính là loại attribute *phải đồng bộ runtime*, hình dạng rot số một theo bài học ARIA ở Q06, và nó trượt phép thử N3 (dev quên cập nhật, trang vẫn chạy bình thường). Không có nghĩa là bỏ nó; nghĩa là waiter phải coi state là *tối ưu hoá* còn DOM-lắng là *đường tin cậy*, và validator M3.5 phải lint state-rot ở ưu tiên cao nhất. Kỳ vọng đúng: ngoài thực địa, state rot sẽ là **chuyện thường**, không phải ngoại lệ.

**Câu 3 — một điều duy nhất: kéo "chạm thực địa" lên trước M3.5** — một trang thật không do mình thiết kế, ngay sau M2, như mô tả ở R06 câu 3. Chọn nó thay vì mọi đề xuất khác vì nó là thuốc cho đúng loại rủi ro bạn vừa mô tả trong Bối cảnh: những quyết định nghe thuyết phục và sống sót chỉ vì chưa gặp thứ gì đủ lạ để phản bác. Demo-site không bao giờ phản bác bạn — nó do chính bạn thiết kế để chuẩn chạy đẹp. Trang của người khác thì có, và càng gặp sớm thì mỗi lần bị phản bác càng rẻ.

#### ▸ Ghi nhận & áp dụng

**2026-08-02 · đã sửa lộ trình.** Đây là câu trả lời đổi nhiều thứ nhất, dù mức chỉ là *tham-khảo*.

- **N5 mới** — *đối thủ không phải Imperative API mà là "không cần chuẩn nào cả"*. Cả lộ trình v1.0 của tôi đang đấu trận "declarative có thay được imperative không" và đấu tốt; nhưng cửa tử nằm ở trận khác. Live MCP là chuẩn **hai phía** (trang chưa khai → agent vô giá trị; agent chưa có → khai báo vô giá trị), nên nếu vượt được khe đó đúng lúc vision agent đã "đủ tốt, đủ rẻ" thì câu dev hỏi sẽ là *"sao tôi phải khai attribute?"*. Lối ra không phải đua độ phủ: **tất định · rẻ và nhanh · kiểm toán được**. Ba chữ này giờ ràng cả mục 3.3 lẫn cách kể chuyện sản phẩm, và ràng cả việc chọn tệp khách đầu tiên — nơi *độ tin cậy thắng độ phủ*.
- **N6 mới** — *agent không có mắt là **tiền đề**, không phải hệ quả*. Luận điểm nền của `project-ideal.md` bỏ sót kênh hồi phục bằng mắt: người điền sai thì nhìn thấy và tự sửa. `livemcp-state`/`livemcp-result` mới trả lời một phần; phát biểu đúng phải là điều kiện *mọi tín hiệu người dùng cần thấy để ra quyết định phải tồn tại dạng text/attribute*. Sẽ viết vào spec ở M1.5.
- **Ranh giới "ngoài phạm vi v1"** (contenteditable/rich-text, drag-and-drop thật, slider tuỳ chế) → bảng nợ kỹ thuật, khai ngay ở M1.5. Chưa cần giải; nhưng *ranh giới khai ra là quyết định, không khai là lỗ hổng chờ người dùng phát hiện*.
- **Điểm tự-mâu-thuẫn tôi đã không nhìn ra:** `livemcp-state` — xương sống cơ chế đợi của M2 — **trượt chính phép thử N3** của tôi (dev quên cập nhật, trang vẫn chạy bình thường), và là hình dạng rot số một theo bài học ARIA ở Q06. Không bỏ nó, nhưng M2 phải thiết kế theo: **state là tối ưu hoá, DOM lắng là đường tin cậy**; validator M3.5 lint state-rot ở ưu tiên cao nhất. Kỳ vọng đúng là state rot sẽ là *chuyện thường*, không phải ngoại lệ. Đã ghi vào hạng mục 3 của M2 — nếu không có câu này, tôi sẽ dựng waiter tin state trước rồi mới phát hiện ra ở thực địa.
- **M2.5** ra đời từ câu 3 (trùng R06 câu 3) — xem ghi nhận ở R06.

---

### R08 — Ba phát biểu kiến trúc đã phải sửa sau khi va thực tế. Có cách bắt sớm không?

**Mức:** quan-trọng · **Hỏi:** 2026-08-03 · **Trạng thái:** ⏳ chờ

**Bối cảnh.** Tính tới nay, **ba** phát biểu trong `livemcp-architecture.md` đã phải sửa sau khi hiện thực chạm vào thực tế. Cả ba đều nghe rất hợp lý lúc viết, và cả ba đều sai theo cùng một kiểu:

| | Phát biểu gốc | Vì sao sai | Phát hiện lúc |
|---|---|---|---|
| §2.2 | *"Toạ độ là ngôn ngữ chung của mọi hành động"* | mỗi phép đo `scrollIntoView` làm hỏng toạ độ đo trước | nghiệm thu M1, sau khi đã sống qua cả M0 |
| §5.5 | *"SW chờ content script báo ong đã tới nơi rồi mới dispatch"* | đặt thêm một failure mode lên đúng đường thi hành | chuyên gia chỉ ra ở [R04], chưa kịp cắn |
| §6.2 | *"`seq` tăng dần theo tab"* | `seq` sống trong content script — chết và đếm lại từ 0 mỗi lần điều hướng, nên delta trễ của trang cũ luôn thắng | lúc hiện thực M2, 03/08 |

Kiểu chung: **một bất biến được phát biểu ở tầng ý niệm, nhưng thứ hiện thực nó lại sống ở một tầng có vòng đời khác.** "Tăng dần theo tab" giả định bộ đếm sống theo tab, trong khi nó sống theo *lần load trang*. "Toạ độ là ngôn ngữ chung" giả định toạ độ ổn định, trong khi phép đo tự làm nó đổi.

Điều làm tôi không yên: §5.5 chỉ được phát hiện vì có người ngoài đọc lại. §2.2 và §6.2 thì phải đợi mã chạy mới lộ. Không có cơ chế nào đang bắt lớp lỗi này — nó chỉ được bắt bởi may mắn hoặc bởi thời gian.

**Câu hỏi**

1. Có thực hành nào **rẻ** bắt sớm lớp lỗi này không? Ý tôi là rẻ thật — dự án một người, không dựng nổi quy trình review nhiều vòng.
2. Cụ thể hơn: có nên yêu cầu **mỗi phát biểu bất biến trong tài liệu kiến trúc phải kèm một trong hai thứ** — một ca kiểm chạy được, hoặc một nhãn *"giả định chưa kiểm"*? Cái giá là tài liệu rườm hơn và viết chậm hơn; cái được là không còn phát biểu nào trông chắc chắn hơn thực tế của nó.
3. Hay đây là chi phí bình thường không đáng chống, và tiền nên dồn vào chỗ khác — ví dụ đúng M2.5 (chạm thực địa) mà [R07] đã chọn?

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
