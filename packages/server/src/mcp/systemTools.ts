import type { SessionStore } from '../store/sessions.js';
import type { McpToolShape } from '../parser/tools.js';
import { qualifyToolName } from '@livemcp/protocol';

/**
 * Tool hệ thống do server tự expose, không đến từ trang web
 * (docs/livemcp-architecture.md §6.4). Tên có tiền tố `livemcp_` để không đụng
 * namespace của site.
 */

export const SYSTEM_TOOL_PREFIX = 'livemcp_';

export const systemToolShapes: McpToolShape[] = [
  {
    name: 'livemcp_list_sites',
    description:
      'Liệt kê các trang web chuẩn Live MCP đang mở trong trình duyệt, kèm mô tả và số tool. ' +
      'Gọi tool này trước khi làm gì khác nếu chưa biết đang có site nào.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'livemcp_get_tools',
    description:
      'Trả về danh sách tool hiện có của một site (tự làm mới hiểu biết sau khi trang thay đổi).',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: 'Tên app, namespace, hoặc một phần URL của site. Bỏ trống = mọi site.',
        },
      },
    },
  },
];

const SYSTEM_TOOL_NAMES = new Set(systemToolShapes.map((t) => t.name));

/**
 * So khớp tên CHÍNH XÁC, không dùng tiền tố: một site tên "LiveMCP Demo" sinh ra
 * namespace `livemcp_demo`, nên `livemcp_demo__say_hello` cũng bắt đầu bằng
 * `livemcp_` — kiểm bằng prefix sẽ nuốt nhầm tool của site.
 */
export function isSystemTool(name: string): boolean {
  return SYSTEM_TOOL_NAMES.has(name);
}

export function callSystemTool(
  name: string,
  args: Record<string, unknown>,
  store: SessionStore,
): string {
  switch (name) {
    case 'livemcp_list_sites': {
      const sites = store.list();
      if (sites.length === 0) {
        return 'Chưa có trang chuẩn Live MCP nào đang mở. Hãy mở một trang có <meta name="livemcp"> trong Chrome (extension Live MCP phải đang bật).';
      }
      return sites
        .map(
          (s) =>
            `• ${s.app} (namespace: ${s.namespace}, tab ${s.tabId})\n` +
            `  URL: ${s.url}\n` +
            `  Mô tả: ${s.description}\n` +
            `  Tool: ${s.tools.size} · Resource: ${s.resources.size}`,
        )
        .join('\n\n');
    }

    case 'livemcp_get_tools': {
      const hint = typeof args.site === 'string' ? args.site : '';
      const sites = hint ? [store.resolveSite(hint)].filter(Boolean) : store.list();
      if (sites.length === 0) {
        return hint
          ? `Không tìm thấy site khớp "${hint}". Dùng livemcp_list_sites để xem site đang mở.`
          : 'Chưa có site nào đang mở.';
      }
      return sites
        .map((s) => {
          const site = s!;
          const tools = [...site.tools.values()].map(
            (t) =>
              `  - ${qualifyToolName(site.namespace, t.name)}` +
              `${t.available ? '' : ' (không khả dụng)'}: ${t.description}`,
          );
          const resources = [...site.resources.values()].map(
            (r) => `  - ${qualifyToolName(site.namespace, `read_${r.name}`)}: ${r.description}`,
          );
          return (
            `${site.app} (${site.namespace}):\n` +
            (tools.length ? `${tools.join('\n')}\n` : '  (chưa có tool nào)\n') +
            (resources.length ? `${resources.join('\n')}` : '')
          );
        })
        .join('\n\n');
    }

    default:
      return `Tool hệ thống không tồn tại: ${name}`;
  }
}
