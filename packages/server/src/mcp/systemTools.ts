import type { SessionStore } from '../store/sessions.js';
import type { McpToolShape } from '../parser/tools.js';
import { DEFAULT_WAIT_TIMEOUT_MS, qualifyToolName } from '@livemcp/protocol';
import { scrubWebText } from './agentText.js';

/**
 * Trần cứng cho `livemcp_wait`.
 *
 * Có trần vì agent tự đặt tham số này, và một `timeoutMs` viết nhầm thành
 * 600000 sẽ treo cả phiên làm việc mà không ai hiểu vì sao. Trần do server đặt
 * là thứ agent không tự nới được.
 */
const MAX_WAIT_MS = 60_000;

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
  {
    name: 'livemcp_wait',
    description:
      'Đợi một tool xuất hiện (hoặc biến mất) sau khi trang tự thay đổi. ' +
      'Chỉ cần dùng khi trang đổi vì lý do KHÁC hành động của bạn — ví dụ dữ liệu ' +
      'tự tải xong, hoặc một hành động trước đó có hiệu ứng chậm. Sau mỗi hành động ' +
      'bình thường, tool mới đã được báo ngay trong kết quả nên KHÔNG cần gọi tool này.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description:
            'Tên tool cần đợi, đầy đủ cả namespace (ví dụ "shopviet__add_to_cart").',
        },
        gone: {
          type: 'boolean',
          description: 'true = đợi tool BIẾN MẤT thay vì xuất hiện. Mặc định false.',
        },
        timeoutMs: {
          type: 'number',
          description: `Trần thời gian đợi, ms. Mặc định ${DEFAULT_WAIT_TIMEOUT_MS}, tối đa ${MAX_WAIT_MS}.`,
        },
      },
      required: ['tool'],
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

/**
 * Đợi một tool xuất hiện / biến mất khỏi danh sách.
 *
 * Nghe `store.onChange` thay vì polling: mọi thay đổi tool list đều đã đi qua
 * đó rồi (delta từ extension → store → `tools/list_changed`), nên polling chỉ
 * là thêm một nguồn sự thật thứ hai chạy lệch nhịp với nguồn thứ nhất.
 */
function waitForTool(
  store: SessionStore,
  qualified: string,
  gone: boolean,
  timeoutMs: number,
): Promise<string> {
  const has = () =>
    store.list().some((s) => {
      for (const t of s.tools.keys()) {
        if (qualifyToolName(s.namespace, t) === qualified) return true;
      }
      for (const r of s.resources.keys()) {
        if (qualifyToolName(s.namespace, `read_${r}`) === qualified) return true;
      }
      return false;
    });

  const satisfied = () => (gone ? !has() : has());
  const verb = gone ? 'biến mất' : 'xuất hiện';

  if (satisfied()) {
    return Promise.resolve(`Tool "${qualified}" đã ${verb} rồi (không phải đợi).`);
  }

  return new Promise<string>((resolve) => {
    let finished = false;

    const finish = (message: string) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(message);
    };

    const timer = setTimeout(
      () =>
        finish(
          `Quá ${timeoutMs}ms mà tool "${qualified}" vẫn chưa ${verb}. ` +
            'Có thể trang chưa phản ứng, hoặc tên tool không đúng — ' +
            'gọi livemcp_get_tools để xem danh sách hiện tại.',
        ),
      timeoutMs,
    );

    const unsubscribe = store.onChange(() => {
      if (satisfied()) finish(`Tool "${qualified}" đã ${verb}.`);
    });
  });
}

export function callSystemTool(
  name: string,
  args: Record<string, unknown>,
  store: SessionStore,
): string | Promise<string> {
  switch (name) {
    case 'livemcp_list_sites': {
      const sites = store.list();
      if (sites.length === 0) {
        return 'Chưa có trang chuẩn Live MCP nào đang mở. Hãy mở một trang có <meta name="livemcp"> trong Chrome (extension Live MCP phải đang bật).';
      }
      // `app`, `url`, `description` đến từ meta tag của trang → phải qua một cửa.
      return sites
        .map(
          (s) =>
            `• ${scrubWebText(s.app, 120)} (namespace: ${s.namespace}, tab ${s.tabId})\n` +
            `  URL: ${scrubWebText(s.url, 300)}\n` +
            `  Mô tả: ${scrubWebText(s.description, 600)}\n` +
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
              `${t.available ? '' : ' (không khả dụng)'}: ${scrubWebText(t.description, 600)}`,
          );
          const resources = [...site.resources.values()].map(
            (r) =>
              `  - ${qualifyToolName(site.namespace, `read_${r.name}`)}: ` +
              scrubWebText(r.description, 600),
          );
          return (
            `${scrubWebText(site.app, 120)} (${site.namespace}):\n` +
            (tools.length ? `${tools.join('\n')}\n` : '  (chưa có tool nào)\n') +
            (resources.length ? `${resources.join('\n')}` : '')
          );
        })
        .join('\n\n');
    }

    case 'livemcp_wait': {
      const tool = typeof args.tool === 'string' ? args.tool.trim() : '';
      if (!tool) return 'Thiếu tham số bắt buộc "tool" (tên tool cần đợi).';

      const raw = typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_WAIT_TIMEOUT_MS;
      const timeoutMs = Math.min(Math.max(raw, 100), MAX_WAIT_MS);
      return waitForTool(store, tool, args.gone === true, timeoutMs);
    }

    default:
      return `Tool hệ thống không tồn tại: ${name}`;
  }
}
