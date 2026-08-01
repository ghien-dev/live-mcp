import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  parseQualifiedName,
  type ActionResultMsg,
  type ToolDecl,
} from '@livemcp/protocol';
import type { ExtensionBridge } from '../bridge/hub.js';
import type { SessionStore, SiteSession } from '../store/sessions.js';
import { resourceDeclToMcpTool, toolDeclToMcpTool, type McpToolShape } from '../parser/tools.js';
import { callSystemTool, isSystemTool, systemToolShapes } from './systemTools.js';
import { log } from '../log.js';

/** Gộp nhiều thay đổi declarative liên tiếp thành một thông báo cho agent. */
const LIST_CHANGED_DEBOUNCE_MS = 100;

export function createMcpServer(store: SessionStore, bridge: ExtensionBridge): Server {
  const server = new Server(
    { name: 'livemcp', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } },
  );

  // --- tools/list: luôn dựng lại từ trạng thái phiên hiện tại --------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: collectTools(store),
  }));

  // --- tools/call ---------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    if (isSystemTool(name)) {
      return textResult(callSystemTool(name, args, store));
    }
    return callSiteTool(name, args, store, bridge);
  });

  // --- notifications/tools/list_changed ------------------------------------
  let debounce: NodeJS.Timeout | null = null;
  store.onChange(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      server.sendToolListChanged().catch((err: unknown) => {
        // Client chưa kết nối hoặc không hỗ trợ — không phải lỗi chí mạng.
        log.warn('không gửi được tools/list_changed:', err);
      });
    }, LIST_CHANGED_DEBOUNCE_MS);
  });

  return server;
}

function collectTools(store: SessionStore): McpToolShape[] {
  const tools: McpToolShape[] = [...systemToolShapes];
  for (const session of store.list()) {
    for (const decl of session.tools.values()) {
      tools.push(toolDeclToMcpTool(decl, session.namespace));
    }
    for (const res of session.resources.values()) {
      tools.push(resourceDeclToMcpTool(res, session.namespace));
    }
  }
  return tools;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

async function callSiteTool(
  qualified: string,
  args: Record<string, unknown>,
  store: SessionStore,
  bridge: ExtensionBridge,
) {
  const parsed = parseQualifiedName(qualified);
  if (!parsed) {
    return textResult(`Tên tool không hợp lệ: ${qualified}`, true);
  }

  const session = store.findByNamespace(parsed.namespace);
  if (!session) {
    return textResult(
      `Site "${parsed.namespace}" không còn mở. Dùng livemcp_list_sites để xem site hiện có.`,
      true,
    );
  }

  // Resource `read_*` không phải hành động — đọc thẳng, không giả lập chuột.
  if (parsed.toolName.startsWith('read_')) {
    const resourceName = parsed.toolName.slice('read_'.length);
    if (session.resources.has(resourceName)) {
      const result = await bridge.readResource(session.tabId, resourceName);
      return formatActionResult(result, session);
    }
  }

  const decl = session.tools.get(parsed.toolName);
  if (!decl) {
    return textResult(
      `Tool "${parsed.toolName}" không còn tồn tại trên ${session.app}. ` +
        `Trang có thể đã thay đổi — gọi livemcp_get_tools để xem danh sách mới.`,
      true,
    );
  }
  if (!decl.available) {
    return textResult(
      `Tool "${qualified}" hiện không khả dụng: ` +
        `${decl.unavailableReason ?? 'phần tử đang bị vô hiệu hoá hoặc ẩn'}.`,
      true,
    );
  }

  const validationError = validateArgs(decl, args);
  if (validationError) return textResult(validationError, true);

  // TODO(M4): confirm gate — decl.confirm phải chặn ở đây, chờ user duyệt.

  const waitTimeout = decl.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS;
  const formFill = decl.kind === 'form' ? args : null;
  const result = await bridge.executeAction(
    session.tabId,
    decl.name,
    args,
    formFill,
    waitTimeout,
  );
  return formatActionResult(result, session);
}

function validateArgs(decl: ToolDecl, args: Record<string, unknown>): string | null {
  for (const arg of decl.args ?? []) {
    const value = args[arg.name];
    if (value === undefined) return `Thiếu tham số bắt buộc "${arg.name}".`;
    if (!arg.values.includes(String(value))) {
      return (
        `Giá trị "${String(value)}" không có trên trang cho tham số "${arg.name}". ` +
        `Các giá trị hợp lệ hiện tại: ${arg.values.join(', ')}`
      );
    }
  }
  if (decl.kind === 'element' && decl.action === 'type' && typeof args.text !== 'string') {
    return 'Thiếu tham số bắt buộc "text" (nội dung cần gõ).';
  }

  // Form: thiếu field bắt buộc thì báo ngay, đừng để agent điền dở rồi submit hỏng.
  if (decl.kind === 'form') {
    const missing = (decl.fields ?? [])
      .filter((f) => f.required && (args[f.name] === undefined || args[f.name] === ''))
      .map((f) => f.name);
    if (missing.length > 0) {
      return `Thiếu tham số bắt buộc: ${missing.join(', ')}.`;
    }
  }
  return null;
}

/**
 * Kết quả trả agent luôn gồm 3 phần (docs/livemcp-architecture.md §4.3):
 * text kết quả, trạng thái, và danh sách tool mới/mất — để agent "nhìn thấy"
 * hệ quả hành động của mình mà không cần hỏi lại.
 */
function formatActionResult(result: ActionResultMsg, session: SiteSession) {
  const lines: string[] = [];

  switch (result.status) {
    case 'ok':
      lines.push(result.resultText?.trim() || 'Hành động đã thực hiện xong.');
      break;
    case 'navigated':
      lines.push(`Trang đã điều hướng tới ${result.url ?? '(không rõ URL)'}.`);
      if (result.resultText) lines.push(result.resultText.trim());
      break;
    case 'timeout':
      lines.push(
        `⏱ Hết thời gian đợi. ${result.error ?? ''}`.trim(),
        result.stateSnapshot
          ? `Trạng thái vùng đợi lúc này: ${result.stateSnapshot}`
          : 'Không đọc được trạng thái vùng đợi.',
        'Bạn có thể thử lại, hoặc gọi livemcp_get_tools để xem trang đang ở đâu.',
      );
      break;
    case 'error':
      lines.push(`✖ Không thực hiện được: ${result.error ?? 'lỗi không rõ'}`);
      break;
  }

  if (result.newTools?.length) {
    lines.push(
      `\nTool mới xuất hiện sau hành động này: ` +
        result.newTools.map((t) => `${session.namespace}__${t}`).join(', '),
    );
  }
  if (result.goneTools?.length) {
    lines.push(
      `Tool không còn nữa: ` + result.goneTools.map((t) => `${session.namespace}__${t}`).join(', '),
    );
  }

  const payload = textResult(lines.join('\n'), result.status === 'error');
  if (result.structured !== undefined) {
    return { ...payload, structuredContent: result.structured as Record<string, unknown> };
  }
  return payload;
}
