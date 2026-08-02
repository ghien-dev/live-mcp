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
import { isValidToolName, scrubStructured, scrubWebText, toAgentText } from './agentText.js';
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
      // Tên tool cũng do trang đặt và đi thẳng vào tools/list. Tên lạ bị loại
      // KÈM LOG — im lặng bỏ tool sẽ khiến tác giả trang ngồi tìm mãi không ra.
      if (!isValidToolName(decl.name)) {
        log.warn(
          `bỏ tool tên không hợp lệ trên ${session.app}: ${JSON.stringify(decl.name.slice(0, 60))}` +
            ' — chỉ nhận chữ, số, gạch dưới và gạch nối.',
        );
        continue;
      }
      tools.push(toolDeclToMcpTool(decl, session.namespace));
    }
    for (const res of session.resources.values()) {
      if (!isValidToolName(res.name)) {
        log.warn(`bỏ resource tên không hợp lệ trên ${session.app}.`);
        continue;
      }
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
    const reason = decl.unavailableReason
      ? scrubWebText(decl.unavailableReason, 200)
      : 'phần tử đang bị vô hiệu hoá hoặc ẩn';
    return textResult(`Tool "${qualified}" hiện không khả dụng: ${reason}.`, true);
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
        `Các giá trị hợp lệ hiện tại: ${scrubWebText(arg.values.join(', '), 800)}`
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

  /** Text do TRANG sinh ra → khối có nhãn nguồn. Text do server sinh ra thì không. */
  const fromPage = (raw: string) => toAgentText(raw, { source: session.app });

  switch (result.status) {
    case 'ok':
      lines.push(
        result.resultText?.trim()
          ? fromPage(result.resultText.trim())
          : 'Hành động đã thực hiện xong.',
      );
      break;
    case 'navigated':
      lines.push(`Trang đã điều hướng tới ${scrubWebText(result.url ?? '(không rõ URL)', 300)}.`);
      if (result.resultText) lines.push(fromPage(result.resultText.trim()));
      break;
    case 'timeout':
      lines.push(
        `⏱ Hết thời gian đợi. ${result.error ?? ''}`.trim(),
        result.stateSnapshot
          ? `Trạng thái vùng đợi lúc này: ${scrubWebText(result.stateSnapshot, 200)}`
          : 'Không đọc được trạng thái vùng đợi.',
        'Bạn có thể thử lại, hoặc gọi livemcp_get_tools để xem trang đang ở đâu.',
      );
      break;
    case 'error':
      // Lời báo lỗi của extension có nhúng mô tả phần tử lấy từ trang → vẫn là
      // text nửa-từ-web, không được miễn kiểm.
      lines.push(`✖ Không thực hiện được: ${scrubWebText(result.error ?? 'lỗi không rõ', 800)}`);
      break;
  }

  const qualifyValid = (names: string[]) =>
    names.filter(isValidToolName).map((t) => `${session.namespace}__${t}`);

  const added = qualifyValid(result.newTools ?? []);
  const gone = qualifyValid(result.goneTools ?? []);
  if (added.length) lines.push(`\nTool mới xuất hiện sau hành động này: ${added.join(', ')}`);
  if (gone.length) lines.push(`Tool không còn nữa: ${gone.join(', ')}`);

  const payload = textResult(lines.join('\n'), result.status === 'error');
  if (result.structured !== undefined) {
    return {
      ...payload,
      structuredContent: scrubStructured(result.structured) as Record<string, unknown>,
    };
  }
  return payload;
}
