# Live MCP

Cầu nối cho AI agent điều khiển trang web **thuần declarative** — agent hành động
bằng chuột và bàn phím thật (trusted events qua CDP), không gọi JavaScript của trang.

- Đặc tả cho web developer: [`docs/livemcp-declarative-spec.md`](docs/livemcp-declarative-spec.md)
- Kiến trúc hệ thống: [`docs/livemcp-architecture.md`](docs/livemcp-architecture.md)

## Trạng thái

**M0 — walking skeleton.** Toàn tuyến `agent → MCP → server → WebSocket → extension → CDP → DOM`
đã thông với một tool `click` duy nhất. Các milestone tiếp theo (form/type, cơ chế đợi,
tool tham số hoá, policy, con ong 🐝, canvas) xem mục "Lộ trình" trong kế hoạch dự án.

| Package | Vai trò |
|---|---|
| `packages/protocol` | Hợp đồng trung tâm: `ToolDecl` + message WebSocket (server ↔ extension dùng chung) |
| `packages/server` | Local Server: MCP stdio, WS hub `127.0.0.1:8787`, registry tool động |
| `packages/extension` | Chrome MV3: content script quét declarative, service worker thi hành qua CDP |
| `packages/demo-site` | Trang demo đạt chuẩn, kiêm test bed |

## Chạy thử

```bash
npm install
npm run build
```

**1. Demo site**

```bash
npm run dev:site        # http://localhost:5180
```

**2. Local Server** — chạy độc lập để xem log, hoặc để agent tự spawn (bước 4).

```bash
npm run dev:server
```

**3. Extension** — `chrome://extensions` → bật *Developer mode* → *Load unpacked* →
chọn `packages/extension/dist`. Mở `http://localhost:5180`, mở DevTools Console,
phải thấy:

```
[Live MCP] "LiveMCP Demo" — phát hiện 1 tool declarative.
```

Log của server phải thấy `site_announce` + `snapshot ... tools=1`.

**4. Đấu nối agent**

```bash
claude mcp add livemcp -- node D:/vibeBoss/webmcp/LiveMCP/packages/server/dist/index.js --stdio
```

Rồi yêu cầu agent: *"gọi tool livemcp_list_sites"* → *"gọi livemcp_demo__say_hello"*.
Nút trên trang phải thực sự bị bấm, Chrome hiện banner "đang debug", và ô kết quả
ghi **sự kiện thật (trusted)** — đó là bằng chứng CDP hoạt động đúng.

> Banner *"Live MCP is debugging this browser"* là **cố ý**, không phải lỗi: không có
> cách hợp lệ nào tắt nó, và nó cho user biết agent đang điều khiển trình duyệt.

## Test

```bash
npm test
```

Chỉ test những vùng logic thuần dễ hỏng (định tuyến tên tool, chuyển đổi schema).
Phần tương tác browser kiểm bằng demo-site thủ công theo tiêu chí nghiệm thu từng milestone.
