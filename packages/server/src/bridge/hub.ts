import { WebSocketServer, type WebSocket } from 'ws';
import {
  ACTION_SLACK_MS,
  KEEPALIVE_INTERVAL_MS,
  LIVEMCP_WS_HOST,
  LIVEMCP_WS_PORT,
  type ActionResultMsg,
  type ExecuteActionMsg,
  type ExtensionToServerMsg,
  type ReadResourceMsg,
  type ServerToExtensionMsg,
} from '@livemcp/protocol';
import { log } from '../log.js';
import { verifyHandshake } from './handshake.js';

export interface BridgeHandlers {
  onMessage(msg: ExtensionToServerMsg): void;
  /** Không còn extension nào kết nối. */
  onAllDisconnected(): void;
}


/**
 * WebSocket hub nói chuyện với Chrome Extension (docs/livemcp-architecture.md §3).
 * Chỉ bind 127.0.0.1 — không bao giờ mở ra mạng ngoài (§6.3.1).
 */
export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();
  /** tabId → socket đang phụ trách tab đó. */
  private readonly tabSockets = new Map<number, WebSocket>();
  private readonly pending = new Map<
    string,
    { resolve: (r: ActionResultMsg) => void; timer: NodeJS.Timeout }
  >();
  private keepalive: NodeJS.Timeout | null = null;
  private actionCounter = 0;

  constructor(
    private readonly handlers: BridgeHandlers,
    /** Token pairing bắt buộc; xem bridge/handshake.ts để biết vì sao. */
    private readonly token: string,
  ) {}

  start(port = LIVEMCP_WS_PORT): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: LIVEMCP_WS_HOST, port });
      this.wss = wss;

      wss.on('listening', () => {
        log.info(`bridge lắng nghe ws://${LIVEMCP_WS_HOST}:${port}`);
        resolve();
      });
      wss.on('error', (err) => {
        log.error('bridge lỗi:', err);
        reject(err);
      });
      wss.on('connection', (socket, req) => {
        const verdict = verifyHandshake(
          { url: req.url, origin: req.headers.origin },
          this.token,
        );
        if (!verdict.ok) {
          // Hỏng ồn ào (N2): từ chối im lặng thì người dùng ngồi chờ một
          // extension không bao giờ nối được mà không biết vì sao.
          log.warn(`từ chối kết nối: ${verdict.reason}`);
          socket.close(verdict.code, verdict.reason.slice(0, 120));
          return;
        }
        this.handleConnection(socket, req.socket.remoteAddress);
      });

      // Ping đều đặn giữ MV3 service worker sống (§2.3).
      this.keepalive = setInterval(() => {
        for (const socket of this.sockets) this.send(socket, { type: 'ping' });
      }, KEEPALIVE_INTERVAL_MS);
    });
  }

  private handleConnection(socket: WebSocket, remote?: string): void {
    log.info(`extension đã kết nối (${remote ?? 'unknown'})`);
    this.sockets.add(socket);

    socket.on('message', (raw) => {
      let msg: ExtensionToServerMsg;
      try {
        msg = JSON.parse(String(raw)) as ExtensionToServerMsg;
      } catch {
        log.warn('message không phải JSON hợp lệ — bỏ qua');
        return;
      }
      this.route(socket, msg);
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      for (const [tabId, s] of this.tabSockets) {
        if (s === socket) this.tabSockets.delete(tabId);
      }
      log.info('extension ngắt kết nối');
      if (this.sockets.size === 0) this.handlers.onAllDisconnected();
    });

    socket.on('error', (err) => log.warn('socket lỗi:', err));
  }

  private route(socket: WebSocket, msg: ExtensionToServerMsg): void {
    if (msg.type === 'pong') return;

    if ('tabId' in msg) this.tabSockets.set(msg.tabId, socket);

    if (msg.type === 'action_result') {
      const entry = this.pending.get(msg.actionId);
      if (!entry) {
        log.warn(`action_result cho actionId lạ ${msg.actionId} — có thể đã timeout`);
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(msg.actionId);
      entry.resolve(msg);
      return;
    }

    this.handlers.onMessage(msg);
  }

  get connected(): boolean {
    return this.sockets.size > 0;
  }

  private send(socket: WebSocket, msg: ServerToExtensionMsg): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  private nextActionId(): string {
    this.actionCounter += 1;
    return `a-${this.actionCounter}`;
  }

  /**
   * Gửi lệnh cho extension và đợi `action_result` tương ứng.
   * Server KHÔNG bao giờ tự retry (tránh double-click "Thanh toán" — §4.4).
   */
  private dispatch(
    tabId: number,
    build: (actionId: string) => ServerToExtensionMsg,
    timeoutMs: number,
  ): Promise<ActionResultMsg> {
    const socket = this.tabSockets.get(tabId) ?? [...this.sockets][0];
    if (!socket) {
      return Promise.resolve({
        type: 'action_result',
        tabId,
        actionId: 'n/a',
        status: 'error',
        error: 'Extension chưa kết nối. Hãy kiểm tra Live MCP extension đã bật trong Chrome.',
      });
    }

    const actionId = this.nextActionId();
    return new Promise<ActionResultMsg>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(actionId);
        resolve({
          type: 'action_result',
          tabId,
          actionId,
          status: 'timeout',
          error: `Extension không phản hồi sau ${timeoutMs}ms.`,
        });
      }, timeoutMs);

      this.pending.set(actionId, { resolve, timer });
      this.send(socket, build(actionId));
    });
  }

  executeAction(
    tabId: number,
    tool: string,
    args: Record<string, unknown>,
    formFill: Record<string, unknown> | null,
    waitTimeoutMs: number,
  ): Promise<ActionResultMsg> {
    return this.dispatch(
      tabId,
      (actionId): ExecuteActionMsg => ({
        type: 'execute_action',
        tabId,
        actionId,
        tool,
        args,
        formFill,
        waitTimeoutMs,
      }),
      waitTimeoutMs + ACTION_SLACK_MS,
    );
  }

  readResource(tabId: number, resource: string, timeoutMs = 5_000): Promise<ActionResultMsg> {
    return this.dispatch(
      tabId,
      (actionId): ReadResourceMsg => ({ type: 'read_resource', tabId, actionId, resource }),
      timeoutMs,
    );
  }

  async stop(): Promise<void> {
    if (this.keepalive) clearInterval(this.keepalive);
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const socket of this.sockets) socket.close();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve());
  }
}
