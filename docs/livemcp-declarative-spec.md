# Chuẩn Live MCP Declarative — Đặc Tả v0.9-draft

> Tài liệu dành cho developer xây dựng **trang web mới** theo chuẩn Live MCP Declarative.
> Đọc xong tài liệu này, bạn phải tự đánh dấu (annotate) được toàn bộ trang web của mình
> để AI Agent điều khiển được 100% qua declarative — không cần viết một dòng JavaScript
> đăng ký tool nào.

> **Đây là bản draft, và nhãn đó là thật.** Chuẩn sẽ còn đổi cho tới khi đạt hai
> điều kiện ở [`livemcp-roadmap.md`](livemcp-roadmap.md) mục 3.4: có validator, và
> có 2–3 trang thật áp dụng mà không ép spec phải đổi thêm. Bản trước mang số
> `1.0` — một lời hứa ổn định mà dự án chưa giữ được, nên đã hạ nhãn.

---

## 1. Triết lý & Phạm vi

### 1.1 Nguyên tắc nền tảng

1. **Thuần declarative.** Trang web chỉ *khai báo* khả năng tương tác bằng HTML attributes. Không có `registerTool()`, không có Imperative API.
2. **Agent tương tác như con người.** Mọi hành động của agent là chuột + bàn phím giả lập (qua Live MCP Extension). Nếu con người làm được workflow không cần gọi JS, agent cũng phải làm được — **với điều kiện ở 1.1.1 dưới đây.**
3. **DOM mới sinh ra từ tương tác — không tự sinh.** Mọi phần tử động (dropdown items, modal, kết quả search...) đều sinh ra *sau một hành động*. Vì vậy agent chỉ cần: **hành động → đợi → đọc declarative mới → hành động tiếp**. Đây là vòng lặp cốt lõi của chuẩn.
4. **Khai báo là hợp đồng.** Attribute `livemcp-*` là hợp đồng giữa trang web và agent: trang web cam kết "sau hành động X, phần tử thỏa selector Y sẽ xuất hiện / trạng thái Z sẽ đổi". Extension và Server chỉ việc thi hành hợp đồng đó.

### 1.1.1 Điều kiện của nguyên tắc 2 — agent không có mắt

Nguyên tắc 2 nghe như một hệ quả hiển nhiên, nhưng nó **không đúng vô điều kiện**, và chỗ hổng nằm ở một thứ con người mang theo mà agent không có: **kênh hồi phục bằng mắt**. Người điền sai ô thì *nhìn thấy* viền đỏ và tự sửa; agent chỉ có declarative làm giác quan. Trang truyền tín hiệu thuần thị giác — lỗi validation chỉ đổi màu viền, trạng thái chỉ hiện bằng icon, tiến trình chỉ là một spinner — là điểm mù đúng nghĩa.

Vì vậy điều kiện phải phát biểu thẳng, và nó là **tiền đề**, không phải khuyến nghị:

> **Mọi tín hiệu mà người dùng cần nhìn thấy để ra quyết định phải tồn tại dưới dạng text hoặc attribute.**

Cụ thể: lỗi validation phải có text lỗi (không chỉ `border: red`); trạng thái xử lý phải có `livemcp-state` hoặc text (không chỉ spinner); kết quả phải có `livemcp-result` (không chỉ một dấu tích xanh). Trang nào không thoả điều kiện này thì nguyên tắc 2 không áp dụng cho nó — và agent sẽ hỏng, đúng như dự đoán, chứ không phải vì chuẩn sai.

### 1.2 Phạm vi

- **Trong phạm vi:** web app xây mới từ đầu theo chuẩn (greenfield), gồm cả app dùng Canvas/WebGL nếu thiết kế theo mục 8.
- **Ngoài phạm vi:** retrofit web có sẵn không kiểm soát được mã nguồn; nội dung cross-origin iframe không theo chuẩn.
- **Ngoài phạm vi ở major hiện tại — ba loại tương tác:** `contenteditable`/rich-text editor (IME, định dạng), drag-and-drop thật, slider tuỳ chế bằng `div`+`pointerdown`. Con người làm được chúng không cần JS của trang, nhưng đường bàn phím chưa phủ được. Khai ranh giới ra đây là **quyết định có ý thức**; giấu nó đi thì nó trở thành lỗ hổng chờ người dùng đầu tiên phát hiện. Cần một trong ba? Hãy cung cấp thêm một đường thao tác bằng bàn phím cho cùng chức năng — đó cũng là điều accessibility đòi hỏi.

- **Không thuộc phạm vi spec — kênh Ask.** Bản cài đặt tham chiếu (extension Live MCP) còn kèm một widget "hỏi trợ lý" chạy trên *mọi* trang, kể cả trang không khai báo gì. Nó **không dùng attribute nào của chuẩn này** và không đòi trang hợp tác, nên nó không phải một phần của spec — ghi ra đây để người đọc không đi tìm mục nói về nó. Kiến trúc: [`livemcp-architecture.md`](livemcp-architecture.md) §2.6.

### 1.3 Quan hệ với Chrome WebMCP

Chuẩn Live MCP **tương thích ngược** với WebMCP Declarative gốc (`toolname`, `tooldescription`, `toolparamdescription` trên `<form>`): Extension đọc được cả hai. Phần mở rộng `livemcp-*` phủ mọi phần tử tương tác ngoài form và bổ sung ngữ nghĩa *đợi / kết quả / trạng thái* mà WebMCP gốc không có.

---

## 2. Khai báo cấp trang (Page-level)

Mọi trang theo chuẩn **bắt buộc** có meta khai báo để Extension nhận diện ngay khi load:

```html
<head>
  <meta name="livemcp" content="0">
  <meta name="livemcp-app" content="BookMyTable">
  <meta name="livemcp-description"
        content="Ứng dụng đặt bàn nhà hàng. Cho phép tìm nhà hàng, xem menu, đặt bàn, hủy bàn.">
</head>
```

| Meta | Bắt buộc | Ý nghĩa |
|---|---|---|
| `livemcp` | ✅ | **Major** của chuẩn trang tuân theo. Không có meta này → Extension bỏ qua trang. |
| `livemcp-app` | ✅ | Tên app, dùng làm prefix định danh MCP server (`livemcp:bookmytable`). |
| `livemcp-description` | ✅ | Mô tả tổng quan để agent hiểu ngữ cảnh trước khi thấy tool nào. |

### 2.1 Vì sao chỉ khai major

Trong cùng một major, mọi thứ **bắt buộc** tương thích — nên minor không phải thứ trang cần khai, và bắt khai sẽ tạo ra một con số phải bảo trì mà không đổi lấy gì.

Ba quy tắc tiến hoá đi kèm, ràng cả hai phía:

1. **Phía chuẩn — additive trong một major.** Attribute mới luôn optional và có default an toàn. Đổi nghĩa hay bỏ một attribute là việc của major mới.
2. **Phía consumer (Extension) — hai cam kết.** Gặp attribute `livemcp-*` không biết → **bỏ qua, không bao giờ fail**. Gặp major lạ → **nói rõ** ("trang khai spec v2, extension này hiểu v0") thay vì im lặng quét bằng luật sai.
3. **Kênh di trú là validator.** Thứ gì bị deprecated sẽ được validator cảnh báo trước một chặng dài, rồi mới bỏ ở major sau.

---

## 3. Bộ thuộc tính cốt lõi (Core Attributes)

### 3.1 Bảng tổng hợp

| Attribute | Gắn trên | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `livemcp-name` | Phần tử tương tác | ✅ | Định danh tool, duy nhất tại một thời điểm trong trang. `snake_case`. |
| `livemcp-description` | Phần tử tương tác | ✅ | Mô tả cho AI. Viết như viết cho người mới dùng app. |
| `livemcp-action` | Phần tử tương tác | ✅ | Hành động vật lý: `click` \| `click-right` \| `dblclick` \| `type` \| `select` \| `hover` \| `scroll` \| `press` \| `drag`. |
| `livemcp-wait` | Phần tử tương tác | ❌ | CSS selector mà agent phải **đợi xuất hiện** sau hành động. |
| `livemcp-wait-gone` | Phần tử tương tác | ❌ | CSS selector phải **biến mất** sau hành động (vd: spinner). |
| `livemcp-wait-timeout` | Phần tử tương tác | ❌ | Timeout đợi, ms. Mặc định `5000`. |
| `livemcp-result` | Phần tử tương tác | ❌ | CSS selector vùng chứa **kết quả text** trả về cho agent sau khi đợi xong. |
| `livemcp-submit-key` | `input`/`textarea` | ❌ | Phím gửi sau khi type: `Enter`, `Tab`... |
| `livemcp-key` | Phần tử `action="press"` | ✅ với `press` | Phím cần bấm: `ArrowLeft`, `Escape`, `Ctrl+S`... |
| `livemcp-confirm` | Phần tử tương tác | ❌ | Đánh dấu hành động **phá hủy/không đảo ngược** (xóa, thanh toán). Server sẽ yêu cầu agent xác nhận với user trước khi thi hành. Giá trị là câu mô tả hậu quả. |
| `livemcp-group` | Phần tử hoặc container | ❌ | Gom các tool cùng workflow, giúp agent hiểu quan hệ. |
| `livemcp-state` | Container | ❌ | Trạng thái vùng: `idle` \| `busy` \| `ready` \| `error`. Trang web **tự cập nhật** attribute này; Extension dùng nó làm tín hiệu đợi tin cậy nhất. |
| `livemcp-resource` | Vùng dữ liệu | ❌ | Khai báo vùng **chỉ-đọc** thành tool `read_*` (xem mục 6). |
| `livemcp-ignore` | Bất kỳ | ❌ | Loại phần tử và con cháu khỏi mọi quét declarative. |

### 3.2 Quy tắc định danh & vòng đời tool

- `livemcp-name` phải duy nhất **tại một thời điểm**. Phần tử bị remove khỏi DOM → tool tự động biến mất khỏi danh sách (Extension phát hiện qua MutationObserver, Server bắn `notifications/tools/list_changed`).
- Với danh sách lặp (nhiều sản phẩm cùng nút "Thêm vào giỏ"), **không** đặt name khác nhau cho từng item. Dùng **tool tham số hóa** (mục 5.3).
- Phần tử có `disabled` hoặc `hidden` (hoặc tổ tiên `hidden`) → tool tồn tại nhưng ở trạng thái *unavailable*; Server báo cho agent biết kèm lý do, agent không gọi được.

### 3.3 Viết `livemcp-description` cho tốt

Mô tả là thứ agent "nhìn thấy" duy nhất. Quy tắc:

- Nói rõ **hậu quả**: "Mở dropdown chọn danh mục; sau khi mở, danh sách danh mục sẽ xuất hiện" thay vì "Nút danh mục".
- Nói rõ **điều kiện tiên quyết** nếu có: "Chỉ dùng được sau khi đã chọn ngày".
- Với `livemcp-wait`, mô tả nên nói agent sẽ nhận được gì sau khi đợi.

---

## 4. Khai báo Form (tương thích WebMCP gốc + mở rộng)

Form là đơn vị tool tự nhiên nhất: nhiều input → một hành động submit → một kết quả.

```html
<form toolname="book_table"
      tooldescription="Đặt bàn nhà hàng. Trả về mã đặt bàn nếu thành công."
      livemcp-wait="#booking-result[livemcp-state='ready']"
      livemcp-result="#booking-result"
      livemcp-wait-timeout="10000">

  <label for="guests">Số khách</label>
  <input type="number" name="guests" min="1" max="20" required
         toolparamdescription="Số lượng khách, từ 1 đến 20">

  <label for="date">Ngày</label>
  <input type="date" name="date" required
         toolparamdescription="Ngày đặt bàn, định dạng YYYY-MM-DD">

  <label for="area">Khu vực</label>
  <select name="area" toolparamdescription="Khu vực ngồi mong muốn">
    <option value="indoor">Trong nhà</option>
    <option value="outdoor">Ngoài trời</option>
  </select>

  <button type="submit">Đặt bàn</button>
</form>

<!-- Vùng kết quả: trang web đổi livemcp-state khi xử lý xong -->
<div id="booking-result" livemcp-state="idle"></div>
```

Server sinh ra MCP tool tương ứng:

```json
{
  "name": "book_table",
  "description": "Đặt bàn nhà hàng. Trả về mã đặt bàn nếu thành công.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "guests": { "type": "integer", "minimum": 1, "maximum": 20,
                  "description": "Số lượng khách, từ 1 đến 20" },
      "date":   { "type": "string", "format": "date",
                  "description": "Ngày đặt bàn, định dạng YYYY-MM-DD" },
      "area":   { "type": "string", "enum": ["indoor", "outdoor"],
                  "description": "Khu vực ngồi mong muốn" }
    },
    "required": ["guests", "date"]
  }
}
```

**Luồng thi hành** khi agent gọi `book_table`:
1. Extension điền từng field bằng gõ phím giả lập (con ong 🐝 bay tới từng ô).
2. Click nút submit.
3. Đợi `#booking-result` đạt `livemcp-state="ready"` (hoặc `error`), tối đa 10s.
4. Đọc text trong `#booking-result` trả về agent.

**Quy tắc chuyển đổi schema tự động** (Extension/Server thực hiện, dev chỉ cần viết HTML chuẩn):

| HTML | JSON Schema |
|---|---|
| `type="number"` / `type="range"` | `integer`/`number` + `minimum`/`maximum` từ `min`/`max` |
| `type="date"`, `type="time"`, `type="email"`, `type="url"` | `string` + `format` tương ứng |
| `<select>` | `string` + `enum` từ các `<option value>` |
| `type="checkbox"` | `boolean` |
| `type="radio"` cùng `name` | `string` + `enum` |
| `required` | vào mảng `required` |
| `pattern` | `pattern` |
| `maxlength` | `maxLength` |

> **Nguyên tắc vàng:** viết HTML form đúng ngữ nghĩa (đúng `type`, có `min/max/required/pattern`) là đã có 80% schema chất lượng. Đây là lý do chuẩn ép dùng HTML semantic.

---

## 5. Khai báo phần tử ngoài form (Mở rộng Live MCP)

### 5.1 Nút hành động đơn

```html
<button livemcp-action="click"
        livemcp-name="open_cart"
        livemcp-description="Mở giỏ hàng. Sau khi mở, panel giỏ hàng với danh sách sản phẩm sẽ xuất hiện."
        livemcp-wait="#cart-panel"
        livemcp-result="#cart-panel">
  🛒 Giỏ hàng
</button>
```

Hành động phá hủy phải có `livemcp-confirm`:

```html
<button livemcp-action="click"
        livemcp-name="delete_account"
        livemcp-description="Xóa vĩnh viễn tài khoản người dùng"
        livemcp-confirm="Xóa vĩnh viễn tài khoản và toàn bộ dữ liệu, không thể khôi phục">
  Xóa tài khoản
</button>
```

### 5.2 Dropdown & DOM động — mẫu chuẩn "hành động → đợi → tool mới"

Đây là mẫu quan trọng nhất của chuẩn, thay thế hoàn toàn nhu cầu Imperative:

```html
<!-- Bước 1: trigger. Cam kết: sau click, các item có [livemcp-name] sẽ xuất hiện trong #cat-menu -->
<div livemcp-action="click"
     livemcp-name="open_category_menu"
     livemcp-description="Mở menu danh mục. Sau khi mở, mỗi danh mục là một tool mới dạng click."
     livemcp-wait="#cat-menu [livemcp-name]"
     livemcp-group="category_flow">
  Danh mục ▾
</div>

<div id="cat-menu"></div>
```

Khi user (hoặc agent) click, app render các item **đã kèm declarative**:

```html
<div id="cat-menu">
  <div livemcp-action="click" livemcp-name="pick_category_electronics"
       livemcp-description="Chọn danh mục Điện tử, trang sẽ lọc sản phẩm theo danh mục này"
       livemcp-wait="#product-grid[livemcp-state='ready']"
       livemcp-group="category_flow">Điện tử</div>
  <div livemcp-action="click" livemcp-name="pick_category_fashion"
       livemcp-description="Chọn danh mục Thời trang"
       livemcp-wait="#product-grid[livemcp-state='ready']"
       livemcp-group="category_flow">Thời trang</div>
</div>
```

Trình tự phía hệ thống:
1. Agent gọi `open_category_menu` → Extension click → đợi selector `#cat-menu [livemcp-name]`.
2. MutationObserver thấy declarative mới → gửi về Server → Server cập nhật tool list → **kết quả trả về cho agent kèm danh sách tool mới xuất hiện**.
3. Agent gọi tiếp `pick_category_electronics`.

> **Hợp đồng của dev:** phần tử động *phải* được render kèm đầy đủ `livemcp-*` ngay tại thời điểm gắn vào DOM. Với React/Vue/Svelte, chỉ cần đặt attribute trong template component — framework nào cũng làm được tự nhiên.

### 5.3 Danh sách lặp — tool tham số hóa với `livemcp-arg`

Đừng sinh 50 tool cho 50 sản phẩm. Khai báo **một** tool đại diện, tham số hóa bằng `livemcp-arg`:

```html
<ul id="product-grid" livemcp-state="ready">
  <li>
    <span class="p-name">iPhone 17</span>
    <button livemcp-action="click"
            livemcp-name="add_to_cart"
            livemcp-description="Thêm sản phẩm vào giỏ. Tham số item = tên sản phẩm."
            livemcp-arg="item: iPhone 17"
            livemcp-wait="#cart-badge[livemcp-state='ready']"
            livemcp-result="#cart-badge">Thêm vào giỏ</button>
  </li>
  <li>
    <span class="p-name">Galaxy S26</span>
    <button livemcp-action="click"
            livemcp-name="add_to_cart"
            livemcp-arg="item: Galaxy S26"
            livemcp-wait="#cart-badge[livemcp-state='ready']"
            livemcp-result="#cart-badge">Thêm vào giỏ</button>
  </li>
</ul>
```

Quy tắc gộp: các phần tử **cùng `livemcp-name`** được Server gộp thành một tool duy nhất, có `inputSchema` chứa param `item` kiểu `enum` gồm mọi giá trị `livemcp-arg` hiện có. Agent gọi `add_to_cart{item: "iPhone 17"}` → Extension tìm đúng phần tử mang arg đó và click.

Cú pháp `livemcp-arg`: `tên_param: giá trị`. Nhiều param phân tách bằng `;` — ví dụ `livemcp-arg="item: iPhone 17; variant: 256GB"`.

### 5.4 Input tự do ngoài form

```html
<input livemcp-action="type"
       livemcp-name="search_products"
       livemcp-description="Ô tìm kiếm sản phẩm. Gõ từ khóa rồi Enter, kết quả hiện trong lưới sản phẩm."
       livemcp-submit-key="Enter"
       livemcp-wait="#product-grid[livemcp-state='ready']"
       livemcp-result="#product-grid"
       placeholder="Tìm sản phẩm...">
```

Tool sinh ra có một param `text` (string, required). Extension: focus → gõ từng ký tự → bấm `Enter` → đợi → đọc kết quả.

### 5.5 Phím tắt / điều khiển bàn phím

```html
<div livemcp-action="press"
     livemcp-key="Escape"
     livemcp-name="close_modal"
     livemcp-description="Đóng hộp thoại đang mở"
     livemcp-wait-gone=".modal"></div>
```

### 5.6 Scroll & phân trang vô hạn

```html
<div id="feed"
     livemcp-action="scroll"
     livemcp-name="load_more_posts"
     livemcp-description="Cuộn xuống cuối danh sách để tải thêm bài viết"
     livemcp-wait="#feed > article:last-child[livemcp-fresh]"
     livemcp-state="ready">
  <article>...</article>
</div>
```

Quy ước: app đánh dấu batch mới bằng attribute tạm `livemcp-fresh` (tự gỡ sau 1 giây hoặc sau lần quét kế tiếp) để Extension phân biệt nội dung mới với nội dung cũ.

### 5.7 Drag & drop (khai báo trước, greenfield thiết kế được)

```html
<div class="kanban-card"
     livemcp-action="drag"
     livemcp-name="move_task"
     livemcp-arg="task: Viết báo cáo"
     livemcp-description="Kéo thẻ công việc sang cột khác. Param target nhận tên cột đích."
     livemcp-drop-targets="[livemcp-dropzone]"
     livemcp-wait="[livemcp-state='ready']">
  Viết báo cáo
</div>

<div class="kanban-col" livemcp-dropzone="Đang làm">...</div>
<div class="kanban-col" livemcp-dropzone="Hoàn thành">...</div>
```

Tool `move_task` có 2 param: `task` (enum từ các arg) và `target` (enum từ các `livemcp-dropzone`). Extension giả lập chuỗi mousedown → mousemove → mouseup (hoặc CDP drag events).

---

## 6. Vùng dữ liệu chỉ-đọc — `livemcp-resource`

Agent không chỉ hành động, còn cần **đọc**. Khai báo vùng dữ liệu:

```html
<table livemcp-resource="cart_items"
       livemcp-description="Danh sách sản phẩm hiện có trong giỏ hàng, gồm tên, số lượng, giá">
  <tr><td>iPhone 17</td><td>1</td><td>25.000.000₫</td></tr>
</table>
```

Server tự sinh tool `read_cart_items` (không param) trả về nội dung text/cấu trúc của vùng đó tại thời điểm gọi. Quy tắc trích xuất: `table` → mảng hàng/cột; `ul/ol` → mảng; còn lại → innerText đã làm sạch.

Muốn cấu trúc chính xác hơn, nhúng JSON song song (tùy chọn nhưng khuyến khích với dữ liệu phức tạp):

```html
<script type="application/livemcp+json" livemcp-resource="cart_items">
  {"items": [{"name": "iPhone 17", "qty": 1, "price": 25000000}]}
</script>
```

Có cả hai → JSON thắng. Đây vẫn là declarative: chỉ là dữ liệu nhúng, không có code chạy.

---

## 7. Hợp đồng trạng thái & cơ chế đợi

### 7.1 `livemcp-state` — tín hiệu đợi hạng nhất

Trang web cam kết cập nhật `livemcp-state` trên container mỗi khi bắt đầu/kết thúc xử lý bất đồng bộ:

```
idle  → chưa có gì
busy  → đang xử lý (đang fetch, đang render)
ready → xử lý xong, dữ liệu/kết quả đã ổn định
error → thất bại; text bên trong mô tả lỗi
```

```html
<div id="search-results" livemcp-state="busy">Đang tìm...</div>
<!-- sau khi fetch xong -->
<div id="search-results" livemcp-state="ready">120 kết quả...</div>
```

Với SPA, việc set attribute này chỉ là một dòng trong state management (vd React: `<div livemcp-state={loading ? 'busy' : 'ready'}>`) — chi phí gần bằng 0 khi thiết kế từ đầu.

### 7.2 Thứ tự ưu tiên tín hiệu đợi của Extension

1. `livemcp-wait` selector xuất hiện **và** không nằm trong vùng `livemcp-state="busy"`.
2. `livemcp-wait-gone` selector biến mất.
3. Không khai báo wait → đợi DOM "lắng" (không mutation liên quan declarative trong 500ms).
4. Quá `livemcp-wait-timeout` → trả lỗi timeout cho agent kèm snapshot trạng thái hiện tại (agent tự quyết định thử lại hay đổi hướng).

### 7.3 Điều hướng đa trang (MPA)

Click gây chuyển trang là hợp lệ: Extension phát hiện navigation, đợi trang mới load, quét declarative của trang mới, và kết quả trả cho agent là "đã điều hướng tới {url}, danh sách tool mới: [...]". Khai báo gợi ý:

```html
<a href="/checkout"
   livemcp-action="click"
   livemcp-name="go_checkout"
   livemcp-description="Chuyển tới trang thanh toán"
   livemcp-navigate>Thanh toán</a>
```

`livemcp-navigate` báo trước cho Extension rằng hành động này chuyển trang (tránh chờ nhầm selector).

---

## 8. Canvas / WebGL trong dự án xây mới

Kết luận nghiên cứu cũ ("Canvas không thể declarative → ngoài scope") chỉ đúng với web **có sẵn**. Khi phát triển từ đầu, có 3 mẫu thiết kế đưa Live MCP vào, xếp theo độ ưu tiên:

### 8.1 Mẫu A — DOM Overlay (khuyến nghị mặc định)

**Nguyên tắc: canvas chỉ để VẼ, còn TƯƠNG TÁC đặt trên các phần tử DOM trong suốt phủ lên canvas.** Mọi vùng bấm được có một phần tử DOM thật, vị trí đồng bộ với hình vẽ:

```html
<div class="chart-wrap" style="position:relative">
  <canvas id="sales-chart" width="800" height="400"></canvas>

  <!-- Overlay trong suốt, đồng bộ vị trí với cột đã vẽ -->
  <div class="hit" style="position:absolute; left:120px; top:80px; width:40px; height:220px"
       livemcp-action="click"
       livemcp-name="select_chart_bar"
       livemcp-arg="month: Tháng 3"
       livemcp-description="Chọn cột doanh thu của một tháng để xem chi tiết"
       livemcp-wait="#bar-detail[livemcp-state='ready']"
       livemcp-result="#bar-detail"></div>
  <!-- ... một hit-div cho mỗi cột ... -->
</div>
<div id="bar-detail" livemcp-state="idle"></div>
```

- App vốn đã biết tọa độ từng hình (nó vừa vẽ chúng) → sinh overlay chỉ là render thêm một lớp div từ cùng dữ liệu. Khi pan/zoom, cập nhật overlay cùng frame vẽ.
- **Lợi ích kép:** overlay chính là nơi gắn ARIA → app đồng thời đạt accessibility. Con người, screen reader và agent dùng chung một lớp tương tác.
- Extension không cần biết gì về canvas — với nó đây là các phần tử DOM bình thường.

### 8.2 Mẫu B — Semantic Region Map (khi overlay quá tốn: hàng vạn đối tượng, game engine)

Canvas giữ toàn quyền xử lý sự kiện; app xuất bản **bản đồ vùng** ẩn mô tả các vùng tương tác bằng tọa độ:

```html
<canvas id="board" width="1200" height="800"></canvas>

<div hidden livemcp-canvas-map="#board">
  <div livemcp-region="140,220,80,80"
       livemcp-action="click"
       livemcp-name="select_unit"
       livemcp-arg="unit: Quân xe A1"
       livemcp-description="Chọn quân cờ trên bàn"></div>
  <div livemcp-region="600,400,80,80"
       livemcp-action="click"
       livemcp-name="select_unit"
       livemcp-arg="unit: Quân mã B2"></div>
</div>
```

- `livemcp-region="x,y,w,h"` tính theo hệ tọa độ canvas; Extension quy đổi sang tọa độ màn hình (dựa `getBoundingClientRect` + tỉ lệ scale) rồi dispatch mouse event **thẳng vào canvas** tại đúng điểm — đúng như con người click.
- App cập nhật map mỗi khi thế giới thay đổi (thêm/xóa/di chuyển đối tượng). Nếu dùng engine (PixiJS, Phaser, Three.js), viết một adapter nhỏ duyệt scene graph các đối tượng đánh dấu interactive và render map — viết một lần, dùng cho cả app.
- Chỉ cần xuất bản các vùng **đang nhìn thấy** (viewport hiện tại), không phải cả thế giới.

### 8.3 Mẫu C — State Projection + Keyboard (game/editor điều khiển bằng phím)

Khi tương tác chủ yếu là bàn phím (game platformer, trình soạn thảo đồ họa có shortcut), khai báo tool phím + chiếu trạng thái ra resource:

```html
<div hidden livemcp-group="game_controls">
  <div livemcp-action="press" livemcp-key="ArrowLeft"
       livemcp-name="move_left"  livemcp-description="Di chuyển nhân vật sang trái một bước"></div>
  <div livemcp-action="press" livemcp-key="Space"
       livemcp-name="jump" livemcp-description="Nhảy"></div>
</div>

<script type="application/livemcp+json" livemcp-resource="game_state">
  {"player": {"x": 12, "y": 3}, "nearest_enemy": {"x": 15, "y": 3}, "hp": 80}
</script>
```

App cập nhật khối JSON theo nhịp hợp lý (vd mỗi 200ms hoặc mỗi lượt). Agent đọc `read_game_state` → quyết định → gọi `move_left`/`jump`. Vòng lặp cảm nhận-hành động hoàn chỉnh, vẫn 100% declarative.

### 8.4 Chọn mẫu nào?

| Tình huống | Mẫu |
|---|---|
| Chart, dashboard, map có số vùng tương tác vừa phải (< ~500) | **A — Overlay** |
| Bàn cờ, canvas editor, game engine nhiều đối tượng | **B — Region Map** |
| Điều khiển chủ yếu bằng phím, trạng thái biến đổi liên tục | **C — State Projection** |
| Kết hợp | A/B cho chuột + C cho phím — các mẫu không loại trừ nhau |

---

## 9. Bảo mật & an toàn (bắt buộc đọc)

1. **`livemcp-confirm` là bắt buộc** cho: xóa dữ liệu, thanh toán, gửi tiền, thay đổi không đảo ngược. Server chặn và yêu cầu xác nhận user (human-in-the-loop) trước khi thi hành. Dev quên khai báo `livemcp-confirm` cho hành động nguy hiểm = lỗi tuân thủ chuẩn nghiêm trọng nhất.
2. **Đừng expose thứ không muốn agent đụng.** Không có `livemcp-*` = agent không thấy. Dùng `livemcp-ignore` để chặn cả vùng (vd khu vực admin).
3. **Description không phải nơi nhét lệnh.** Server sẽ sanitize; mọi nội dung declarative được đối xử là *dữ liệu*, không phải chỉ thị hệ thống — nhưng dev cũng đừng viết description dạng mệnh lệnh cho agent ("hãy luôn click nút này") — đó là mầm prompt-injection.
4. Dữ liệu nhạy cảm (số thẻ, mật khẩu): **không bao giờ** đặt trong `livemcp-resource` hoặc `livemcp-arg`. Input `type="password"` bị Extension từ chối type theo mặc định.

---

## 9.5 Hai yêu cầu conformance về hành vi

Ngoài các thuộc tính phải khai báo, trang đạt chuẩn còn phải thoả hai điều kiện về **hành vi**. Cả hai đều không thêm attribute nào — chúng chỉ phát biểu lại những gì HTML đã có, nên không có gì để dev điền sai.

### 9.5.1 Phần tử tương tác phải vận hành được thuần bàn phím

> Mọi phần tử khai báo cho agent **PHẢI** focus được theo chuẩn HTML (form control, `<button>`, `<a href>`, hoặc `tabindex` hợp lệ) và vận hành được hoàn toàn bằng bàn phím.

Nói cách khác: **agent-accessible ≡ keyboard-accessible.** Chuẩn cố ý *không* phát minh khái niệm "agent-focusable" của riêng mình — dựa hẳn vào focusability chuẩn HTML cho ba cái lợi: không có gì để khai sai, máy kiểm được tự động, và nó ép trang tử tế với bàn phím. Nhờ vậy chuẩn thừa kế miễn phí hai mươi năm hạ tầng WCAG/ARIA APG: mọi trang keyboard-accessible nghiễm nhiên agent-accessible.

Hệ quả thực dụng: **dùng `<button>` thật, đừng dùng `<div onclick>`.** Extension đi đường bàn phím (Enter/Space) với phần tử focus được — và Space/Enter trên button chuẩn khiến trình duyệt phát một sự kiện `click` thật, nên mọi handler `click` của bạn vẫn chạy bình thường. Với `<div onclick>` thì extension buộc phải quay về click theo toạ độ, kém tin cậy hơn hẳn.

Cũng vì lý do này, chuẩn **không** khuyên thay `<select>` native bằng listbox ARIA tự chế: listbox tự chế trung bình tệ hơn select native về a11y, về mobile, *và cho chính agent* — hành vi bàn phím của nó là code tự viết, không có gì bảo đảm.

### 9.5.2 `change`/`input` là tạm thời; hiệu lực chỉ ở hành động commit tường minh

> Trang **PHẢI** coi `change`/`input` của một control là *thay đổi tạm thời*. Mọi tác dụng thật (gọi API, tạo đơn, trừ tiền) chỉ được xảy ra ở một **hành động commit tường minh** — submit form, bấm nút.

Lý do: extension điều khiển `<select>` bằng mũi tên đúng như một người dùng bàn phím, nên đi từ option 1 tới option 8 sẽ phát bảy sự kiện `change`. Đây **chính xác** là chuỗi sự kiện một người dùng bàn phím thật tạo ra — trang nào bắn API không debounce theo từng `change` của select thì đã hỏng với người dùng bàn phím từ trước khi agent tồn tại.

Yêu cầu này thay cho một attribute kiểu `livemcp-commit-key`: nhu cầu thật đằng sau nó ("khi nào thay đổi có hiệu lực") đã có sẵn ngữ nghĩa HTML chuẩn — form + nút submit.

*(Lọc/preview theo `change` thì vẫn tốt và được khuyến khích — điều bị cấm là **tác dụng không đảo ngược** gắn vào `change`.)*

---

## 10. Checklist tuân thủ chuẩn cho developer

Trang của bạn đạt chuẩn Live MCP Declarative khi:

- [ ] Có đủ 3 meta cấp trang (`livemcp`, `livemcp-app`, `livemcp-description`).
- [ ] Mọi phần tử tương tác dành cho user đều có `livemcp-name` + `livemcp-description` + `livemcp-action` (hoặc nằm trong form có `toolname`).
- [ ] **Mọi phần tử khai báo đều focus được và vận hành được thuần bàn phím** (§9.5.1) — thử ngay: rút chuột ra, dùng Tab + Enter/Space/mũi tên làm hết workflow.
- [ ] **Không hành động không đảo ngược nào gắn vào `change`/`input`** (§9.5.2) — chỉ ở submit hoặc nút bấm.
- [ ] Mọi hành động bất đồng bộ có `livemcp-wait`/`livemcp-wait-gone` **và** vùng đích có `livemcp-state` được app cập nhật đúng.
- [ ] Mọi DOM sinh động được render **kèm sẵn** declarative attributes ngay khi gắn vào cây.
- [ ] Danh sách lặp dùng tool tham số hóa (`livemcp-arg`), không sinh name trùng logic.
- [ ] Hành động phá hủy có `livemcp-confirm`.
- [ ] Dữ liệu agent cần đọc có `livemcp-resource` (kèm JSON nhúng nếu phức tạp).
- [ ] Canvas/WebGL (nếu có) áp dụng mẫu A/B/C mục 8.
- [ ] Test thủ công: tự hỏi *"nếu tôi chỉ được nhìn danh sách tool + description, không nhìn màn hình, tôi có hoàn thành được mọi workflow chính không?"* — nếu không, còn thiếu khai báo.

---

## 11. Ví dụ tổng hợp — trang bán hàng mini đạt chuẩn

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="livemcp" content="0">
  <meta name="livemcp-app" content="ShopViet">
  <meta name="livemcp-description" content="Cửa hàng điện tử: tìm kiếm, xem, thêm giỏ, thanh toán.">
  <title>ShopViet</title>
</head>
<body>

  <!-- Tìm kiếm -->
  <input livemcp-action="type" livemcp-name="search_products"
         livemcp-description="Tìm sản phẩm theo từ khóa, Enter để tìm, kết quả hiện ở lưới sản phẩm"
         livemcp-submit-key="Enter"
         livemcp-wait="#grid[livemcp-state='ready']"
         livemcp-result="#grid"
         placeholder="Tìm kiếm...">

  <!-- Lưới sản phẩm (render động, mỗi item kèm declarative) -->
  <ul id="grid" livemcp-state="ready"
      livemcp-resource="visible_products"
      livemcp-description="Danh sách sản phẩm đang hiển thị">
    <li>
      <h3>iPhone 17 — 25.000.000₫</h3>
      <button livemcp-action="click" livemcp-name="add_to_cart"
              livemcp-arg="item: iPhone 17"
              livemcp-description="Thêm sản phẩm vào giỏ hàng"
              livemcp-wait="#cart-count[livemcp-state='ready']"
              livemcp-result="#cart-count">Thêm vào giỏ</button>
    </li>
  </ul>

  <span id="cart-count" livemcp-state="idle"
        livemcp-resource="cart_summary"
        livemcp-description="Số sản phẩm trong giỏ">0 sản phẩm</span>

  <!-- Thanh toán: chuyển trang -->
  <a href="/checkout" livemcp-action="click" livemcp-name="go_checkout"
     livemcp-description="Tới trang thanh toán để hoàn tất đơn hàng"
     livemcp-navigate>Thanh toán</a>

</body>
</html>
```

Tool list mà agent nhìn thấy từ trang này: `search_products(text)`, `add_to_cart(item)`, `go_checkout()`, `read_visible_products()`, `read_cart_summary()` — đủ để hoàn thành trọn luồng mua hàng, không một dòng JS đăng ký tool.

---

*Đặc tả v0.9-draft — biên soạn cho dự án Live MCP, 31/07/2026; hạ nhãn khỏi `1.0` ngày 02/08/2026 (xem `livemcp-roadmap.md` R05).*
