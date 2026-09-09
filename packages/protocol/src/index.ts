/**
 * @livemcp/protocol — hợp đồng trung tâm giữa Local Server và Chrome Extension.
 *
 * Mọi thay đổi về ToolDecl hoặc message WebSocket phải đi qua file này; TypeScript
 * sẽ bắt lệch pha giữa hai bên ngay lúc build (xem docs/livemcp-architecture.md §7).
 */

export const PROTOCOL_VERSION = '1.0';

/**
 * Phiên bản chuẩn declarative. **Đang là draft, cố ý.**
 *
 * Nhãn `1.0` trước đây phát tín hiệu sai: nó là lời hứa ổn định mà dự án chưa
 * muốn giữ — bằng chứng là §9.5 được thêm vào spec sau khi đã mang số 1.0.
 * Đổi nhãn bây giờ rẻ; đổi sau khi có trang thật áp dụng thì đắt
 * (docs/livemcp-roadmap.md R05).
 */
export const SPEC_VERSION = '0.9-draft';

/**
 * Major mà extension này hiểu. Trang chỉ khai major trong `<meta name="livemcp">`
 * — trong cùng một major, mọi thứ phải tương thích (quy tắc tiến hoá additive),
 * nên minor không phải thứ trang cần khai.
 */
export const SPEC_MAJOR = 0;

/**
 * Đọc major từ nhãn spec của trang. Chấp nhận `"0"`, `"0.9-draft"`, `"1.0"`.
 * Trả `null` khi không đọc được số — gọi là "không rõ", không đoán bừa.
 */
export function specMajorOf(raw: string): number | null {
  const m = /^\s*v?(\d+)/.exec(raw);
  if (!m) return null;
  return Number(m[1]);
}

/** WS hub của Local Server. Chỉ bind 127.0.0.1 (docs/livemcp-architecture.md §6.3.1). */
export const LIVEMCP_WS_PORT = 8787;
export const LIVEMCP_WS_HOST = '127.0.0.1';

/**
 * Tên query param mang token pairing trong URL WebSocket.
 *
 * Vì sao token nằm ở URL chứ không ở header: WebSocket từ trình duyệt không đặt
 * được header tuỳ ý. URL này chỉ đi tới 127.0.0.1 nên không rời khỏi máy.
 */
export const TOKEN_QUERY_PARAM = 'token';

/** Ping keepalive giữ MV3 service worker sống (§2.3). Phải < 30s. */
export const KEEPALIVE_INTERVAL_MS = 20_000;

/** Timeout đợi mặc định khi phần tử không khai báo livemcp-wait-timeout (spec §3.1). */
export const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

/**
 * Thời gian cộng thêm vào `waitTimeout` để extension kịp làm phần việc của nó
 * ngoài khâu đợi: lập kế hoạch, gắn debugger, và phát từng sự kiện chuột/phím.
 *
 * Không phải con số cho có. Một form 6 ô sinh ~60 sự kiện input, mỗi sự kiện là
 * một vòng CDP; trên tab bị che khuất renderer bị giáng ưu tiên nên mỗi vòng có
 * thể mất ~180ms — tức riêng khâu gõ đã hơn 10 giây. Server và extension phải
 * dùng CHUNG hằng số này, nếu không bên nào bỏ cuộc trước sẽ nuốt mất lời báo
 * lỗi của bên kia.
 */
export const ACTION_SLACK_MS = 20_000;

/** Trần độ dài text đọc từ trang, tránh phá context window của agent (§5.4). */
export const MAX_RESULT_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Kênh Ask — hằng số
// ---------------------------------------------------------------------------

/**
 * Trần thời gian `livemcp_ask_wait` được phép chặn.
 *
 * 55s là con số nhắm dưới timeout tool-call của claude.ai (~60s). Vượt trần thì
 * client bỏ cuộc trước server, và agent nhận về một lỗi transport không nói gì
 * thay vì "chưa có câu hỏi nào" — mất luôn khả năng lặp vòng.
 */
export const ASK_MAX_WAIT_MS = 55_000;
export const ASK_DEFAULT_WAIT_MS = 50_000;

/**
 * Câu hỏi đã claim mà không được trả lời trong khoảng này thì quay về `pending`.
 *
 * Có TTL vì phiên Claude web có thể biến mất giữa chừng (đóng tab, hết context,
 * đổi hội thoại) mà không ai báo. Không có TTL thì câu hỏi bị khoá vĩnh viễn ở
 * trạng thái "đang xử lý" và người dùng ngồi chờ một thứ không còn tồn tại.
 */
export const ASK_CLAIM_TTL_MS = 180_000;

/** Giữ câu hỏi đã giao thêm khoảng này rồi mới dọn (đủ cho widget resync sau F5). */
export const ASK_RETENTION_MS = 600_000;

/** Trần số câu hỏi giữ trong bộ nhớ; quá thì bỏ cái cũ nhất đã giao xong. */
export const ASK_MAX_QUESTIONS = 200;

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

/**
 * Danh tính của MỘT LẦN LOAD TRANG trong một tab.
 *
 * Vì sao `seq` một mình không đủ (sửa giả định ở kiến trúc §6.2): `seq` là bộ
 * đếm sống trong content script, mà content script **chết theo mỗi lần điều
 * hướng** — trang mới bắt đầu đếm lại từ 0. Nên một delta đến trễ từ trang CŨ
 * (seq=7) vẫn lớn hơn seq của trang MỚI (seq=1) và sẽ được áp nhầm, đúng cái
 * race mà §6.2 định chống. `pageId` sinh mới mỗi lần load nên phân biệt được
 * "cũ hơn" với "của trang khác" — hai chuyện `seq` không tách nổi.
 */
export type PageId = string;

/** Tab load trang có meta livemcp — khai sinh session. */
export interface SiteAnnounceMsg {
  type: 'site_announce';
  tabId: number;
  pageId: PageId;
  url: string;
  app: string;
  description: string;
  specVersion: string;
}

/** Snapshot toàn bộ declarative sau lần quét đầu (và sau navigation). */
export interface DeclarativeSnapshotMsg {
  type: 'declarative_snapshot';
  tabId: number;
  pageId: PageId;
  seq: number;
  tools: ToolDecl[];
  resources: ResourceDecl[];
}

/** Thay đổi tăng dần từ MutationObserver (debounce 150ms). */
export interface DeclarativeDeltaMsg {
  type: 'declarative_delta';
  tabId: number;
  pageId: PageId;
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

/**
 * Vòng đời một câu hỏi (kênh Ask).
 *
 * `answered` tách khỏi "đã giao": agent trả lời xong không có nghĩa widget đã
 * nhận được. Tab có thể đang F5 đúng lúc đó. Cờ `delivered` riêng là thứ giữ cho
 * câu trả lời sống sót qua một lần tải lại trang.
 */
export type AskStatus = 'pending' | 'claimed' | 'answered';

/** Người dùng gửi một câu hỏi từ widget trên trang bất kỳ. */
export interface AskQuestionMsg {
  type: 'ask_question';
  tabId: number;
  questionId: string;
  url: string;
  title: string;
  /** Câu hỏi người dùng gõ. */
  text: string;
  /** Đoạn người dùng CHỦ ĐỘNG bôi đen. Không bao giờ là nội dung trang tự lấy. */
  selection?: string;
  ts: number;
}

/**
 * Widget vừa khởi động (mở panel, hoặc content script sống lại sau F5) → xin
 * phần chưa giao. Không có message này thì mọi câu trả lời về đúng lúc trang
 * đang tải lại đều rơi mất, và người dùng không có cách nào biết.
 */
export interface AskHelloMsg {
  type: 'ask_hello';
  tabId: number;
  url: string;
}

/** Widget xác nhận đã hiển thị câu trả lời — server mới được dọn. */
export interface AskDeliveredMsg {
  type: 'ask_delivered';
  tabId: number;
  questionId: string;
}

/** Người dùng rút lại câu hỏi trước khi có ai trả lời. */
export interface AskCancelMsg {
  type: 'ask_cancel';
  tabId: number;
  questionId: string;
}

export type ExtensionToServerMsg =
  | SiteAnnounceMsg
  | DeclarativeSnapshotMsg
  | DeclarativeDeltaMsg
  | ActionResultMsg
  | SiteGoneMsg
  | AskQuestionMsg
  | AskHelloMsg
  | AskDeliveredMsg
  | AskCancelMsg
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
  /**
   * Ngân sách đợi (ms) mà server dành cho hành động này. Extension phải tự bỏ
   * cuộc trước khi server hết kiên nhẫn, để lời báo lỗi còn kịp về tới agent.
   */
  waitTimeoutMs: number;
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

/**
 * Một phiên agent đã nhận câu hỏi này.
 *
 * Nấc trạng thái rẻ nhất mà đổi cảm giác chờ nhiều nhất: người dùng biết có
 * người đang xử lý, khác hẳn với việc nhìn một vòng xoay không biết còn ai
 * ở đầu bên kia không.
 */
export interface AskClaimedMsg {
  type: 'ask_claimed';
  tabId: number;
  questionId: string;
}

/** Câu trả lời cuối cùng. Widget phải hồi `ask_delivered`. */
export interface AskAnswerMsg {
  type: 'ask_answer';
  tabId: number;
  questionId: string;
  markdown: string;
}

/** Agent hỏi ngược người dùng khi câu hỏi thiếu ngữ cảnh. */
export interface AskFollowupMsg {
  type: 'ask_followup';
  tabId: number;
  questionId: string;
  text: string;
}

/** Câu hỏi hết hạn claim và quay lại hàng đợi — widget lùi trạng thái tương ứng. */
export interface AskReleasedMsg {
  type: 'ask_released';
  tabId: number;
  questionId: string;
}

export type ServerToExtensionMsg =
  | ExecuteActionMsg
  | ReadResourceMsg
  | AskClaimedMsg
  | AskAnswerMsg
  | AskFollowupMsg
  | AskReleasedMsg
  | PingMsg;

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
