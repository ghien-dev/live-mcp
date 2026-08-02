# Lưới E2E

```bash
npm run e2e:setup     # một lần: tải Chromium cho Playwright
npm run test:e2e      # chạy toàn bộ lưới
```

Một lệnh, không setup tay. Nếu bạn thấy mình phải bật server hay build gì bằng
tay trước khi chạy được, đó là **lỗi của lưới** — sửa `prepare.mjs`.

```bash
npm run test:e2e -- --project=chromium          # bỏ ma trận locale, ~45s
npm run test:e2e -- tests/02-fail-path.spec.ts  # một file
E2E_HEADED=1 npm run test:e2e                   # xem tận mắt
npx playwright show-trace test-results/…/trace.zip
```

## Vì sao lưới này tồn tại

Lỗi đau nhất của dự án — toạ độ, layout, focus — sống **trong** browser. Mọi
test với DOM giả đều mù trước chúng, vì DOM giả chính là kẻ nói dối
`getBoundingClientRect`: jsdom trả về toàn số 0, nên test xanh trong khi sản
phẩm hỏng. Đó là loại test tệ hơn không có test.

Browser chính là layout engine. Thuê nó, đừng giả nó.

Lưới này **không** thay unit test. Phân tầng:

| Tầng | Bắt gì | Ở đâu |
|---|---|---|
| Unit (vitest) | logic thuần nhiều nhánh: schema, định tuyến, thứ tự segment, bảng phím | `packages/*/src/**/*.test.ts` |
| E2E (Playwright) | layout, focus thật, CDP thật, locale thật, vòng đời MV3 | ở đây |

## Nguyên tắc kiến trúc: Playwright dựng rạp, **không** diễn

```
McpAgent (agent giả)  →  MCP stdio  →  server  →  WS  →  extension  →  CDP  →  DOM
                                                                                ↑
                                              Playwright chỉ đọc để assert ─────┘
```

Playwright khởi động Chrome có extension, phục vụ trang, và đọc DOM. Nó **không
click, không gõ, không dispatch một sự kiện `Input` nào**. Mọi thao tác đi qua
đúng đường sản phẩm.

Nếu để Playwright thao tác hộ thì bài test không còn kiểm sản phẩm nữa — nó kiểm
Playwright. Vai thụ động này cũng khiến nó không giẫm chân `chrome.debugger` của
extension, dù cả hai đều nói CDP.

## Các ca

| File | Bắt lớp lỗi nào |
|---|---|
| `00-smoke` | trục xương sống nối được không; extension và Playwright cùng dùng CDP có đụng nhau không |
| `01-fill-form` | mọi loại ô vào đúng giá trị; **không sự kiện tương tác nào untrusted** |
| `02-fail-path` | cách hệ thống *từ chối*: phần tử bị che, option `disabled`, giá trị không tồn tại |
| `03-locale` | thứ tự segment ngày trên `en-US` (MDY), `de-DE` (DMY), `ja` (YMD) |
| `04-lifecycle` | server restart → tự nối lại; đóng tab → tool biến mất; SW còn sống |
| `05-gaps` | những chỗ **chưa** hỗ trợ, ghi bằng `test.fixme` |

Khẳng định đáng giá nhất trong `01` là một khẳng định **âm**: sau khi điền xong,
không tồn tại sự kiện tương tác nào có `isTrusted === false`. Nó bắt được cái
ngày ai đó thêm một `dispatchEvent` "chỉ lần này thôi" — đúng loại xói mòn triết
lý mà không review bằng mắt nào thấy.

`05-gaps` dùng `test.fixme`: bài *nên* xanh nhưng hiện đỏ vì tính năng chưa có.
Playwright sẽ **đỏ ngược lại nếu nó bất ngờ xanh**, nên ngày ai đó làm xong tính
năng, lưới tự nhắc gỡ `fixme`. Ghi ở đây thay vì trong file TODO vì người ta đọc
kết quả test, còn file TODO thì không.

## Cổng riêng, không giành với bản dev

| | dev | E2E |
|---|---|---|
| WS | 8787 | **8799** |
| site | 5180 | **5199** |
| extension | `dist/` | **`dist-e2e/`** |

Cổng WS được nướng vào lúc build (`build.mjs --ws-port`). Nhờ vậy lưới chạy được
trong khi bạn vẫn đang gỡ lỗi trên Chrome thật — không phải tắt gì bằng tay.

## Ghi chú cho người sửa lưới

- **Đóng tab sau mỗi bài** (fixture `booking`/`edgeCases` tự làm). Mỗi tab mở là
  một namespace tool sống; để tồn đọng thì bài sau có thể bị định tuyến sang tab
  cũ — hành động rơi vào một trang còn assertion đọc trang khác, và bài đỏ vì lý
  do không liên quan gì tới sản phẩm. Đây là lỗi thật đã mắc khi dựng lưới.
- **Đừng bật/tắt server dùng chung trong `test.afterAll`** — nó chạy theo *từng
  file spec*, nên file thứ hai sẽ mất server. Dùng `webServer` của config.
- `workers: 1` là cố ý: `chrome.debugger` là tài nguyên độc quyền theo profile.
