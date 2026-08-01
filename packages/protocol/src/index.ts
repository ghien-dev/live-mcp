/**
 * @livemcp/protocol — hợp đồng trung tâm giữa Local Server và Chrome Extension.
 *
 * Mọi thay đổi về ToolDecl hoặc message WebSocket phải đi qua file này; TypeScript
 * sẽ bắt lệch pha giữa hai bên ngay lúc build (xem docs/livemcp-architecture.md §7).
 */

export const PROTOCOL_VERSION = '1.0';
export const SPEC_VERSION = '1.0';

/** WS hub của Local Server. Chỉ bind 127.0.0.1 (docs/livemcp-architecture.md §6.3.1). */
export const LIVEMCP_WS_PORT = 8787;
export const LIVEMCP_WS_HOST = '127.0.0.1';

/** Ping keepalive giữ MV3 service worker sống (§2.3). Phải < 30s. */
export const KEEPALIVE_INTERVAL_MS = 20_000;

/** Timeout đợi mặc định khi phần tử không khai báo livemcp-wait-timeout (spec §3.1). */
export const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

/** Trần độ dài text đọc từ trang, tránh phá context window của agent (§5.4). */
export const MAX_RESULT_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Khai báo declarative (content script sinh ra từ DOM)
// ---------------------------------------------------------------------------

/** Hành động vật lý mà agent thi hành, theo spec §3.1 `livemcp-action`. */
export type LiveMcpAction =
  | 'click'
  | 'click-right'
  | 'dblclick'
  | 'type'
  | 'select'
  | 'hover'
  | 'scroll'
  | 'press'
  | 'drag';

/** Trạng thái vùng theo hợp đồng `livemcp-state` (spec §7.1). */
export type LiveMcpState = 'idle' | 'busy' | 'ready' | 'error';

/**
 * Một tham số của tool tham số hoá, gộp từ các `livemcp-arg` cùng `livemcp-name`
 * (spec §5.3). Ví dụ `livemcp-arg="item: iPhone 17"` trên nhiều nút → một arg
 * `{ name: 'item', values: ['iPhone 17', 'Galaxy S26'] }`.
 */
export interface ArgDecl {
  name: string;
  /** Tập giá trị hiện có trong DOM → trở thành `enum` trong JSON Schema. */
  values: string[];
}

/**
 * Sự thật DOM thuần của một field trong form. Content script KHÔNG tự dịch sang
 * JSON Schema — việc đó thuộc `server/parser` (xem kế hoạch, tinh chỉnh #1).
 */
export interface FieldDecl {
  name: string;
  /** `type` của input, hoặc 'select' / 'textarea' / 'radio-group'. */
  htmlType: string;
  description?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  pattern?: string;
  maxLength?: number;
  /** Với select / radio-group: các giá trị chọn được. */
  options?: string[];
}

/** Một tool do trang web khai báo, đã chuẩn hoá bởi content script (§3.3). */
export interface ToolDecl {
  /** `livemcp-name` hoặc `toolname` — duy nhất trong một tab tại một thời điểm. */
  name: string;
  description: string;
  kind: 'element' | 'form';
  action: LiveMcpAction;
  /** Gộp từ `livemcp-arg` của các phần tử cùng name. */
  args?: ArgDecl[];
  /** Chỉ với kind='form'. */
  fields?: FieldDecl[];
  /** Với action='press': `livemcp-key`, ví dụ 'Escape', 'Ctrl+S'. */
  key?: string;
  /** Với action='type': `livemcp-submit-key`, ví dụ 'Enter'. */
  submitKey?: string;
  /** CSS selector phải xuất hiện sau hành động (`livemcp-wait`). */
  wait?: string;
  /** CSS selector phải biến mất sau hành động (`livemcp-wait-gone`). */
  waitGone?: string;
  waitTimeout?: number;
  /** CSS selector vùng chứa kết quả text (`livemcp-result`). */
  resultSelector?: string;
  /** Câu mô tả hậu quả từ `livemcp-confirm`; có giá trị → server chặn chờ duyệt. */
  confirm?: string;
  /** `livemcp-group` — gom tool cùng workflow. */
  group?: string;
  /** `livemcp-navigate` — hành động này chuyển trang, đừng chờ nhầm selector. */
  navigate?: boolean;
  /** false khi phần tử disabled/hidden; tool vẫn hiện nhưng agent không gọi được. */
  available: boolean;
  /** Lý do không khả dụng, để server giải thích cho agent. */
  unavailableReason?: string;
}

/** Vùng dữ liệu chỉ-đọc `livemcp-resource` → tool `read_*` (spec §6). */
export interface ResourceDecl {
  name: string;
  description: string;
  /** 'json' khi có <script type="application/livemcp+json">, ngược lại theo thẻ. */
  format: 'json' | 'table' | 'list' | 'text';
}

// ---------------------------------------------------------------------------
// Extension → Server
// ---------------------------------------------------------------------------

/** Tab load trang có meta livemcp — khai sinh session. */
export interface SiteAnnounceMsg {
  type: 'site_announce';
  tabId: number;
  url: string;
  app: string;
  description: string;
  specVersion: string;
}

/** Snapshot toàn bộ declarative sau lần quét đầu (và sau navigation). */
export interface DeclarativeSnapshotMsg {
  type: 'declarative_snapshot';
  tabId: number;
  seq: number;
  tools: ToolDecl[];
  resources: ResourceDecl[];
}

/** Thay đổi tăng dần từ MutationObserver (debounce 150ms). */
export interface DeclarativeDeltaMsg {
  type: 'declarative_delta';
  tabId: number;
  seq: number;
  added: ToolDecl[];
  removed: string[];
  changed: ToolDecl[];
}

export type ActionStatus = 'ok' | 'timeout' | 'error' | 'navigated';

/** Kết quả thi hành một action. */
export interface ActionResultMsg {
  type: 'action_result';
  tabId: number;
  actionId: string;
  status: ActionStatus;
  /** Text đọc từ vùng `livemcp-result`, hoặc nội dung resource. */
  resultText?: string;
  /** Dữ liệu có cấu trúc khi vùng đọc là JSON nhúng / table. */
  structured?: unknown;
  /** Tool xuất hiện nhờ chính hành động này — agent "nhìn thấy" hệ quả ngay. */
  newTools?: string[];
  /** Tool biến mất sau hành động. */
  goneTools?: string[];
  /** Với status='timeout': snapshot livemcp-state của vùng đang đợi. */
  stateSnapshot?: string;
  /** Với status='navigated': url mới. */
  url?: string;
  error?: string;
  durationMs?: number;
}

/** Tab đóng / rời trang. */
export interface SiteGoneMsg {
  type: 'site_gone';
  tabId: number;
}

export interface PongMsg {
  type: 'pong';
}

export type ExtensionToServerMsg =
  | SiteAnnounceMsg
  | DeclarativeSnapshotMsg
  | DeclarativeDeltaMsg
  | ActionResultMsg
  | SiteGoneMsg
  | PongMsg;

// ---------------------------------------------------------------------------
// Server → Extension
// ---------------------------------------------------------------------------

/** Lệnh thi hành tool. `args` đã được server validate theo inputSchema. */
export interface ExecuteActionMsg {
  type: 'execute_action';
  tabId: number;
  actionId: string;
  tool: string;
  args: Record<string, unknown>;
  /** Với tool kind='form': map field → value. */
  formFill: Record<string, unknown> | null;
}

/** Đọc resource `read_*`. */
export interface ReadResourceMsg {
  type: 'read_resource';
  tabId: number;
  actionId: string;
  resource: string;
}

/** Keepalive giữ MV3 SW sống (§2.3). */
export interface PingMsg {
  type: 'ping';
}

export type ServerToExtensionMsg = ExecuteActionMsg | ReadResourceMsg | PingMsg;

// ---------------------------------------------------------------------------
// Tiện ích dùng chung
// ---------------------------------------------------------------------------

/**
 * Sinh namespace tool từ tên app (§2.4). `"ShopViet"` → `"shopviet"`.
 * Tool cuối cùng agent thấy: `shopviet__add_to_cart`.
 */
export function slugifyApp(app: string): string {
  const slug = app
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'site';
}

export const NAMESPACE_SEPARATOR = '__';

export function qualifyToolName(namespace: string, toolName: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${toolName}`;
}

/** Tách `shopviet__add_to_cart` → `{ namespace, toolName }`. */
export function parseQualifiedName(
  qualified: string,
): { namespace: string; toolName: string } | null {
  const idx = qualified.indexOf(NAMESPACE_SEPARATOR);
  if (idx <= 0) return null;
  return {
    namespace: qualified.slice(0, idx),
    toolName: qualified.slice(idx + NAMESPACE_SEPARATOR.length),
  };
}
