import {
  LIVEMCP_WS_HOST,
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
    this.closed = false;

    const socket = new WebSocket(`ws://${LIVEMCP_WS_HOST}:${__LIVEMCP_WS_PORT__}`);
    this.socket = socket;

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

    socket.onclose = () => {
      this.socket = null;
      if (this.closed) return;
      console.info(`[Live MCP] mất kết nối server, thử lại sau ${this.backoff}ms`);
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
    this.socket?.close();
    this.socket = null;
  }
}
