import {
  LIVEMCP_WS_HOST,
  TOKEN_QUERY_PARAM,
  type ExtensionToServerMsg,
  type ServerToExtensionMsg,
} from '@livemcp/protocol';

/**
 * Cổng WS, nướng vào lúc build (`build.mjs --ws-port`). Mặc định là
 * `LIVEMCP_WS_PORT` của protocol; lưới E2E build một bản riêng ở cổng khác để
 * chạy song song với server dev mà không phải tắt gì bằng tay.
 */
declare const __LIVEMCP_WS_PORT__: number;

/**
 * Token nướng vào lúc build (`build.mjs --token`). Chuỗi rỗng = chế độ bình
 * thường: đọc token người dùng đã dán ở popup. Lưới E2E nướng token cố định để
 * dựng stack riêng không cần thao tác tay.
 */
declare const __LIVEMCP_TOKEN__: string;

/** Khoá lưu token trong `chrome.storage.local`. */
export const TOKEN_STORAGE_KEY = 'livemcp_token';

/** Mã đóng WS khi server từ chối (policy violation) — xem server bridge/handshake.ts. */
const CLOSE_POLICY_VIOLATION = 1008;

async function readToken(): Promise<string> {
  if (__LIVEMCP_TOKEN__) return __LIVEMCP_TOKEN__;
  try {
    const stored = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    return String(stored[TOKEN_STORAGE_KEY] ?? '');
  } catch {
    return '';
  }
}

/**
 * WebSocket client tới Local Server.
 *
 * Từ Chrome 116+, mọi hoạt động WebSocket reset timer của MV3 service worker →
 * ping 20s từ server là đủ giữ SW sống suốt phiên (§2.3). Nếu SW vẫn bị kill,
 * lớp trên phải tự resync khi dậy lại.
 */

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

/** Trần hàng đợi gửi đi khi chưa nối được server — đủ cho một trang rất lớn. */
const OUTBOX_LIMIT = 200;

export class ServerLink {
  private socket: WebSocket | null = null;
  private backoff = RECONNECT_MIN_MS;
  private closed = false;
  /** Đang trong khoảng đọc token (bất đồng bộ) và chưa kịp tạo socket. */
  private connecting = false;
  /**
   * MV3 SW thức dậy vì content script gửi message, nhưng WS phải mất vài chục ms
   * mới mở xong — không có hàng đợi thì `site_announce` đầu tiên rơi mất.
   */
  private outbox: ExtensionToServerMsg[] = [];

  constructor(
    private readonly onMessage: (msg: ServerToExtensionMsg) => void,
    private readonly onOpen: () => void,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    // Đọc token là bất đồng bộ, nên khoảng giữa hai lần gọi connect() có thể mở
    // hai socket nếu không có cờ này — `this.socket` lúc đó vẫn còn null.
    if (this.connecting) return;
    this.connecting = true;
    this.closed = false;
    void this.openSocket();
  }

  private async openSocket(): Promise<void> {
    const token = await readToken();
    if (this.closed) {
      this.connecting = false;
      return;
    }
    if (!token) {
      this.connecting = false;
      console.warn(
        '[Live MCP] chưa có token pairing. Mở popup extension và dán token mà Local Server ' +
          'in ra lúc khởi động. (Không có token thì server từ chối kết nối — đó là chủ ý.)',
      );
      // Không quay vòng gấp: người dùng phải thao tác tay thì mới có token.
      setTimeout(() => !this.closed && this.connect(), RECONNECT_MAX_MS);
      return;
    }

    const url =
      `ws://${LIVEMCP_WS_HOST}:${__LIVEMCP_WS_PORT__}` +
      `/?${TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.connecting = false;

    socket.onopen = () => {
      console.info('[Live MCP] đã kết nối Local Server');
      this.backoff = RECONNECT_MIN_MS;
      const queued = this.outbox;
      this.outbox = [];
      for (const msg of queued) socket.send(JSON.stringify(msg));
      this.onOpen();
    };

    socket.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as ServerToExtensionMsg);
      } catch {
        console.warn('[Live MCP] message không hợp lệ từ server');
      }
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (this.closed) return;

      if (event.code === CLOSE_POLICY_VIOLATION) {
        // Hỏng ồn ào (N2): đây không phải sự cố mạng mà là từ chối có chủ đích.
        // Không có dòng này thì người dùng chỉ thấy extension "im lặng không nối
        // được" và sẽ đi tìm nhầm chỗ.
        console.error(
          `[Live MCP] server TỪ CHỐI kết nối: ${event.reason || 'không rõ lý do'}\n` +
            '  → Mở popup extension, dán lại token mà Local Server in ra lúc khởi động.',
        );
        this.backoff = RECONNECT_MAX_MS;
      } else {
        console.info(`[Live MCP] mất kết nối server, thử lại sau ${this.backoff}ms`);
      }

      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    };

    socket.onerror = () => {
      // onclose sẽ được gọi ngay sau đó — xử lý reconnect ở đó cho gọn.
    };
  }

  send(msg: ExtensionToServerMsg): void {
    if (this.connected) {
      this.socket!.send(JSON.stringify(msg));
      return;
    }
    if (this.outbox.length >= OUTBOX_LIMIT) this.outbox.shift();
    this.outbox.push(msg);
    this.connect();
  }

  close(): void {
    this.closed = true;
    this.connecting = false;
    this.socket?.close();
    this.socket = null;
  }

  /** Người dùng vừa dán token ở popup → thử lại ngay, đừng bắt họ chờ backoff. */
  retryNow(): void {
    this.backoff = RECONNECT_MIN_MS;
    this.socket?.close();
    this.socket = null;
    this.connect();
  }
}
