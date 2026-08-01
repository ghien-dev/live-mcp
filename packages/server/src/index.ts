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
import { log } from './log.js';

/** Extension mất kết nối → giữ tool list thêm 30s cho MV3 SW hồi sinh (§6.2). */
const DISCONNECT_GRACE_MS = 30_000;

function parseArgs(argv: string[]) {
  const wsPortIdx = argv.indexOf('--ws-port');
  return {
    http: argv.includes('--http'),
    wsPort: wsPortIdx >= 0 ? Number(argv[wsPortIdx + 1]) : LIVEMCP_WS_PORT,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.http) {
    log.error('Transport Streamable HTTP chưa được hiện thực (M7). Hiện chỉ hỗ trợ --stdio.');
    process.exit(1);
  }

  const store = new SessionStore();

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
  });

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
  log.error('server không khởi động được:', err);
  process.exit(1);
});
