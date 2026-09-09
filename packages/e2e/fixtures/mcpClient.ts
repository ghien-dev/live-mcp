import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { E2E_TOKEN } from './ports.mjs';

/**
 * Agent giả: nói MCP qua stdio với Local Server thật.
 *
 * Đây là điểm mấu chốt của kiến trúc lưới E2E — **Playwright chỉ dựng rạp và
 * quan sát, không bao giờ diễn.** Mọi thao tác đi qua đúng đường sản phẩm:
 * agent giả → MCP stdio → server → WebSocket → extension → CDP → DOM. Nếu để
 * Playwright click/gõ hộ thì bài test không còn kiểm sản phẩm nữa — nó kiểm
 * Playwright.
 *
 * Hệ quả phụ có lợi: vì Playwright không gửi lệnh `Input` nào, nó không giẫm
 * chân `chrome.debugger` của extension, bất kể multi-client CDP có kẽ hở gì.
 */

interface Rpc {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpAgent {
  private proc!: ChildProcessWithoutNullStreams;
  private readonly serverEntry: string;
  private readonly wsPort: number;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private notifyWaiters: Array<{ method: string; resolve: () => void }> = [];
  /** stderr của server, giữ lại để khi test đỏ còn biết server nói gì. */
  readonly serverLog: string[] = [];
  private running = false;

  constructor(serverEntry: string, wsPort: number) {
    this.serverEntry = serverEntry;
    this.wsPort = wsPort;
    this.spawnServer();
  }

  private spawnServer(): void {
    this.running = true;
    this.proc = spawn(
      process.execPath,
      [this.serverEntry, '--stdio', '--ws-port', String(this.wsPort)],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Token cố định của lưới (M1.5). Qua env chứ không qua file người dùng:
        // chạy test không được đụng vào `~/.livemcp/token` của người thật.
        env: { ...process.env, LIVEMCP_TOKEN: E2E_TOKEN },
      },
    );

    createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: this.proc.stderr }).on('line', (line) => {
      this.serverLog.push(line);
    });
  }

  /**
   * Giết server rồi dựng lại trên cùng cổng — mô phỏng đúng việc người dùng khởi
   * động lại agent/Claude Code trong khi Chrome vẫn mở nguyên.
   *
   * Giữ nguyên danh tính đối tượng để fixture không phải thay agent giữa chừng.
   */
  async restart(): Promise<void> {
    this.stopServer();
    await new Promise((r) => setTimeout(r, 500));
    await this.startServer();
  }

  /**
   * Giết server nhưng GIỮ đối tượng agent.
   *
   * Tách khỏi `restart()` vì có bài test cần đúng cái khoảng ở giữa: quãng thời
   * gian server đã tắt mà trình duyệt vẫn mở. Đó là lúc extension phải nói cho
   * người dùng biết mình đang nói vào khoảng không — và trước bản vá, đó đúng là
   * lúc nó im lặng.
   */
  stopServer(): void {
    this.proc.kill();
    this.running = false;
    for (const slot of this.pending.values()) slot.reject(new Error('server đã bị tắt'));
    this.pending.clear();
    this.nextId = 1;
  }

  /** Dựng lại trên cùng cổng, như thể người dùng bật server lên lại. */
  async startServer(): Promise<void> {
    this.spawnServer();
    await this.initialize();
  }

  /**
   * Server có đang chạy không.
   *
   * Để `finally` của bài test dựng lại server mà không dựng chồng: một bài cố ý
   * tắt server và đỏ giữa chừng sẽ để server nằm chết, kéo mọi bài sau đỏ theo
   * vì lý do không liên quan — che mất lỗi thật.
   */
  get alive(): boolean {
    return this.running;
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: Rpc;
    try {
      msg = JSON.parse(line) as Rpc;
    } catch {
      return; // không phải JSON-RPC (log lạc sang stdout) — bỏ qua
    }

    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const slot = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else slot.resolve(msg.result);
      return;
    }

    if (msg.method) {
      // Notification (vd notifications/tools/list_changed) — đánh thức ai đang đợi.
      const still: typeof this.notifyWaiters = [];
      for (const w of this.notifyWaiters) {
        if (w.method === msg.method) w.resolve();
        else still.push(w);
      }
      this.notifyWaiters = still;
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP "${method}" không phản hồi sau 60s`));
      }, 60_000);
    });
  }

  private notify(method: string, params?: unknown): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'livemcp-e2e', version: '0.1.0' },
    });
    this.notify('notifications/initialized');
  }

  async listTools(): Promise<ToolInfo[]> {
    const res = (await this.send('tools/list')) as { tools: ToolInfo[] };
    return res.tools ?? [];
  }

  /** Chỉ tên tool — dạng dùng nhiều nhất khi assert "có / không có". */
  async toolNames(): Promise<string[]> {
    return (await this.listTools()).map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const res = (await this.send('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (res.content ?? [])
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    return { text, isError: res.isError === true };
  }

  /**
   * Đợi tới khi một tool xuất hiện trong `tools/list`.
   *
   * Trang được extension phát hiện qua chuỗi bất đồng bộ (content script quét →
   * SW → WS → server), nên sau khi mở trang phải đợi thật chứ không sleep bừa.
   */
  async waitForTool(name: string, timeoutMs = 20_000): Promise<ToolInfo> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tools = await this.listTools();
      const found = tools.find((t) => t.name === name);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `Không thấy tool "${name}" sau ${timeoutMs}ms. ` +
            `Đang có: [${tools.map((t) => t.name).join(', ')}]. ` +
            `Server log:\n${this.serverLog.slice(-15).join('\n')}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Đợi tool BIẾN MẤT — dùng cho ca tab đóng / trang rời đi. */
  async waitForToolGone(name: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tools = await this.listTools();
      if (!tools.some((t) => t.name === name)) return;
      if (Date.now() > deadline) throw new Error(`Tool "${name}" vẫn còn sau ${timeoutMs}ms.`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async close(): Promise<void> {
    this.running = false;
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 100));
  }
}
