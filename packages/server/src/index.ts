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
import { createMcpServer } from './mcp/server.js';
import { loadOrCreateToken } from './store/token.js';
import { log } from './log.js';

/** Extension mất kết nối → giữ tool list thêm 30s cho MV3 SW hồi sinh (§6.2). */
const DISCONNECT_GRACE_MS = 30_000;

function parseArgs(argv: string[]) {
  const wsPortIdx = argv.indexOf('--ws-port');
  return {
    http: argv.includes('--http'),
    printToken: argv.includes('--print-token'),
    wsPort: wsPortIdx >= 0 ? Number(argv[wsPortIdx + 1]) : LIVEMCP_WS_PORT,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.http) {
    log.error('Transport Streamable HTTP chưa được hiện thực (M7). Hiện chỉ hỗ trợ --stdio.');
    process.exit(1);
  }

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

  await bridge.start(opts.wsPort);

  const mcp = createMcpServer(store, bridge);
  await mcp.connect(new StdioServerTransport());
  log.info('MCP stdio sẵn sàng. Đang chờ trang chuẩn Live MCP mở trong Chrome...');

  const shutdown = async () => {
    log.info('đang tắt...');
    await bridge.stop();
    await mcp.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
