#!/usr/bin/env node
/**
 * Live MCP Local Server.
 *
 *   node dist/index.js --stdio        (mặc định — dùng trong config Claude Desktop/Code)
 *   node dist/index.js --ws-port 8787
 *
 * Kiến trúc: docs/livemcp-architecture.md §6.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LIVEMCP_WS_PORT, type ExtensionToServerMsg } from '@livemcp/protocol';
import { ExtensionBridge } from './bridge/hub.js';
import { SessionStore } from './store/sessions.js';
import { AskStore } from './store/ask.js';
import { createMcpServer } from './mcp/server.js';
import { startHttpServer, type RunningHttpServer } from './http/server.js';
import { loadOrCreateHttpToken, loadOrCreateToken } from './store/token.js';
import { log } from './log.js';

/** Extension mất kết nối → giữ tool list thêm 30s cho MV3 SW hồi sinh (§6.2). */
const DISCONNECT_GRACE_MS = 30_000;

/**
 * Nhịp dọn hàng đợi Ask.
 *
 * Cần một nhịp chủ động chứ không dọn lười lúc đọc: khi claim của một phiên hết
 * hạn, phải có ai đó đánh thức `livemcp_ask_wait` đang chặn ở phiên khác. Dọn
 * lười thì câu hỏi nằm im tới lượt gọi tool tiếp theo — mà lượt đó có thể không
 * bao giờ tới, vì mọi phiên đều đang chặn chờ.
 */
const ASK_SWEEP_INTERVAL_MS = 15_000;

/** Cổng mặc định của MCP Streamable HTTP. Tách khỏi 8787 của WS hub. */
const DEFAULT_HTTP_PORT = 8788;

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Cờ lặp lại được: `--http-allow-host a --http-allow-host b`. */
function valuesOf(argv: string[], flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && argv[i + 1]) out.push(argv[i + 1]!);
  });
  return out;
}

function parseArgs(argv: string[]) {
  return {
    /**
     * `--http` BẬT THÊM transport HTTP, không thay thế stdio.
     *
     * Bản đầu coi hai transport là loại trừ nhau, và đó là sai: cả hai đều cần
     * WS hub 8787, mà cổng đó chỉ một tiến trình giữ được. Muốn dùng đồng thời
     * Claude Code và claude.ai thì buộc phải là một tiến trình phục vụ cả hai.
     */
    http: argv.includes('--http'),
    httpPort: Number(valueOf(argv, '--http-port') ?? DEFAULT_HTTP_PORT),
    httpHost: valueOf(argv, '--http-host') ?? '127.0.0.1',
    httpAllowHosts: valuesOf(argv, '--http-allow-host'),
    /** Tắt bearer ở tầng app — chỉ hợp lệ khi hạ tầng đã xác thực (Cloudflare Access). */
    httpNoAuth: argv.includes('--http-no-auth'),
    printToken: argv.includes('--print-token'),
    printHttpToken: argv.includes('--print-http-token'),
    wsPort: Number(valueOf(argv, '--ws-port') ?? LIVEMCP_WS_PORT),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  /**
   * `--print-token` in token rồi thoát, KHÔNG mở WS hub.
   *
   * Có mặt vì một cái bẫy có thật: cách duy nhất để xem token trước đây là chạy
   * server, mà server thì giữ cổng 8787 — nên người dùng vô tình chặn chính
   * instance mà agent sắp spawn, và chỉ nhận về một mã lỗi MCP không giải thích
   * gì. Lấy token không được phép đòi dựng cả hệ.
   */
  if (opts.printToken) {
    process.stdout.write(`${loadOrCreateToken().token}\n`);
    return;
  }

  const store = new SessionStore();
  const askStore = new AskStore();

  const { token, created, source } = loadOrCreateToken();
  if (created) {
    log.info(`đã sinh token pairing mới, lưu tại ${source}`);
  }
  // In ra mỗi lần chạy: người dùng cần dán vào popup extension, và log stdio của
  // MCP server không phải thứ họ mở ra thường xuyên.
  log.info(`token pairing: ${token}`);
  log.info('  → dán token này vào popup extension Live MCP (chỉ cần một lần).');

  let graceTimer: NodeJS.Timeout | null = null;
  const bridge = new ExtensionBridge({
    onMessage(msg: ExtensionToServerMsg) {
      switch (msg.type) {
        case 'site_announce':
          store.announce(msg);
          break;
        case 'declarative_snapshot':
          store.applySnapshot(msg);
          break;
        case 'declarative_delta':
          store.applyDelta(msg);
          break;
        case 'site_gone':
          store.remove(msg.tabId);
          break;

        // --- kênh Ask: chạy trên MỌI trang, không đụng SessionStore ---------
        case 'ask_question':
          askStore.add(msg);
          break;
        case 'ask_delivered':
          askStore.markDelivered(msg.questionId);
          break;
        case 'ask_cancel':
          askStore.cancel(msg.questionId);
          break;
        case 'ask_hello':
          // Widget vừa sống lại sau F5 → giao lại phần nó chưa kịp nhận.
          for (const q of askStore.undeliveredFor(msg.tabId, msg.url)) {
            bridge.sendToTab(q.tabId, {
              type: 'ask_answer',
              tabId: q.tabId,
              questionId: q.id,
              markdown: q.answer ?? '',
            });
          }
          break;
      }
    },
    onAllDisconnected() {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = setTimeout(() => {
        graceTimer = null;
        store.clear();
      }, DISCONNECT_GRACE_MS);
    },
  }, token);

  // Extension kết nối lại trong grace period → huỷ lịch xoá phiên.
  store.onChange(() => {
    if (bridge.connected && graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  });

  // Kênh Ask đẩy ngược xuống widget: đã nhận / trả lời / hỏi lại / trả về hàng đợi.
  askStore.setEmitter((event) => {
    const q = event.question;
    switch (event.type) {
      case 'claimed':
        bridge.sendToTab(q.tabId, { type: 'ask_claimed', tabId: q.tabId, questionId: q.id });
        break;
      case 'answered':
        bridge.sendToTab(q.tabId, {
          type: 'ask_answer',
          tabId: q.tabId,
          questionId: q.id,
          markdown: q.answer ?? '',
        });
        break;
      case 'followup':
        bridge.sendToTab(q.tabId, {
          type: 'ask_followup',
          tabId: q.tabId,
          questionId: q.id,
          text: event.text,
        });
        break;
      case 'released':
        bridge.sendToTab(q.tabId, { type: 'ask_released', tabId: q.tabId, questionId: q.id });
        break;
    }
  });

  const askSweep = setInterval(() => askStore.sweep(), ASK_SWEEP_INTERVAL_MS);
  // Nhịp dọn không được giữ tiến trình sống khi mọi thứ khác đã xong.
  askSweep.unref?.();

  await bridge.start(opts.wsPort);

  const mcp = createMcpServer(store, bridge, askStore);
  await mcp.connect(new StdioServerTransport());
  log.info('MCP stdio sẵn sàng. Đang chờ trang chuẩn Live MCP mở trong Chrome...');

  let http: RunningHttpServer | null = null;
  if (opts.http) {
    http = await startHttp(opts, () => createMcpServer(store, bridge, askStore));
  }

  const shutdown = async () => {
    log.info('đang tắt...');
    clearInterval(askSweep);
    await http?.close().catch(() => {});
    await bridge.stop();
    await mcp.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Dựng transport HTTP và nói to mọi thứ người dùng cần biết để cắm vào claude.ai.
 *
 * Phần lớn mã ở đây là chữ chứ không phải logic, và đó là chủ ý: cấu hình sai ở
 * tầng này hỏng theo kiểu tệ nhất — claude.ai chỉ báo "không kết nối được
 * connector", không nói vì sao, và người dùng không có chỗ nào để nhìn.
 */
async function startHttp(
  opts: ReturnType<typeof parseArgs>,
  factory: () => ReturnType<typeof createMcpServer>,
): Promise<RunningHttpServer> {
  const allowedHosts = [
    `127.0.0.1:${opts.httpPort}`,
    `localhost:${opts.httpPort}`,
    ...opts.httpAllowHosts,
  ];

  let token: string | null = null;
  if (opts.httpNoAuth) {
    // Hỏng ồn ào (N2): một endpoint không xác thực mà im lặng chạy được là kịch
    // bản người dùng KHÔNG BAO GIỜ phát hiện ra cho tới lúc đã muộn.
    log.warn(
      '--http-no-auth: endpoint MCP KHÔNG kiểm bearer token.\n' +
        '  Chỉ dùng khi hạ tầng đã xác thực hộ (Cloudflare Access, mTLS).\n' +
        '  Nếu tunnel của bạn để ngỏ thì bất kỳ ai biết URL cũng đọc được mọi câu hỏi\n' +
        '  trên mọi trang bạn duyệt, và bơm được câu trả lời giả vào widget.',
    );
  } else {
    const http = loadOrCreateHttpToken();
    token = http.token;
    if (http.created) log.info(`đã sinh token HTTP mới, lưu tại ${http.source}`);
    log.info(`token HTTP: ${token}`);
    log.info('  → dán vào connector claude.ai dạng header: Authorization: Bearer <token>');
  }

  if (opts.httpHost !== '127.0.0.1' && opts.httpHost !== 'localhost') {
    log.warn(
      `--http-host ${opts.httpHost}: server lắng nghe NGOÀI loopback.\n` +
        '  Với Cloudflare Tunnel thì không cần — cloudflared nối tới 127.0.0.1 ngay trên máy này.',
    );
  }

  const running = await startHttpServer({
    host: opts.httpHost,
    port: opts.httpPort,
    token,
    allowedHosts,
    createMcpServer: factory,
  });

  log.info(`MCP Streamable HTTP sẵn sàng: http://${opts.httpHost}:${running.port}/mcp`);
  log.info(`  Host được phép: ${allowedHosts.join(', ')}`);
  if (opts.httpAllowHosts.length === 0) {
    log.info(
      '  Chưa khai hostname tunnel. Khi mở tunnel, thêm: --http-allow-host <ten-mien-cua-ban>',
    );
  }
  return running;
}

main().catch((err) => {
  // Cổng bận là ca thường gặp nhất, và trước đây nó chết câm: agent chỉ nhận
  // một mã lỗi MCP trần trụi, còn nguyên nhân thật (một Live MCP server khác
  // đang chạy) thì không ai nói ra. Hỏng ồn ào (N2).
  if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    const port = (err as { port?: number }).port ?? LIVEMCP_WS_PORT;
    log.error(
      `Cổng ${port} đã có tiến trình khác giữ — gần như chắc chắn là một Live MCP ` +
        'server khác đang chạy (ví dụ `npm run dev:server`).\n' +
        '  Mỗi lúc chỉ được MỘT server giữ hub WebSocket, vì extension chỉ nối vào một chỗ.\n' +
        '  → Tắt tiến trình kia, hoặc chạy server này với `--ws-port <cổng khác>`.\n' +
        '  → Chỉ cần xem token thì dùng `--print-token`, lệnh đó không mở cổng nào.',
    );
    process.exit(1);
  }
  log.error('server không khởi động được:', err);
  process.exit(1);
});
