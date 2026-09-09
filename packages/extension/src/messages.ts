/**
 * Giao thức nội bộ giữa Service Worker và Content Script.
 *
 * Khác với `@livemcp/protocol` (hợp đồng SW ↔ Server), các message ở đây không
 * bao giờ ra khỏi extension nên giữ tối giản.
 *
 * Mô hình: **content script lập kế hoạch, service worker thi hành**. Content
 * script biết DOM (toạ độ, thứ tự field, giá trị hiện tại) nhưng không có quyền
 * CDP; SW có quyền CDP nhưng không được biết gì về DOM. `ActionStep` là ranh
 * giới giữa hai bên.
 */
import type { ActionStatus, ResourceDecl, ToolDecl } from '@livemcp/protocol';

export interface PageInfo {
  /**
   * Danh tính của lần load trang này. Sinh mới mỗi khi content script khởi
   * động, nên nó phân biệt được "trang mới" với "trang cũ nói vọng lại" — thứ
   * mà `seq` không làm được vì `seq` reset theo mỗi lần load (xem PageId ở
   * @livemcp/protocol).
   */
  pageId: string;
  url: string;
  app: string;
  description: string;
  specVersion: string;
}

/**
 * Một bước thao tác vật lý. Toạ độ luôn theo viewport, đơn vị CSS pixel —
 * ngôn ngữ chung của hành động (docs/livemcp-architecture.md §2.2).
 */
export type ActionStep =
  | { kind: 'click'; x: number; y: number; button?: 'left' | 'right'; clickCount?: number }
  /** Gõ nguyên chuỗi vào phần tử đang focus (nhanh, vẫn là trusted input). */
  | { kind: 'insertText'; text: string }
  /** Bấm lần lượt các phím: 'Tab', 'Enter', 'ArrowLeft', '0'..'9', 'a'... */
  | { kind: 'keys'; keys: string[] }
  /** Ctrl+A — xoá nội dung cũ trước khi gõ đè. */
  | { kind: 'selectAll' }
  /** Nghỉ giữa các bước để trang kịp phản ứng (vd dropdown vừa mở). */
  | { kind: 'wait'; ms: number };

export type ContentToSw =
  | {
      type: 'cs_site_ready';
      site: PageInfo;
      seq: number;
      tools: ToolDecl[];
      resources: ResourceDecl[];
    }
  /**
   * DOM đổi làm TOOL LIST đổi (M2). Content script chỉ gửi khi danh sách thật
   * sự khác — DOM đổi mà tool list y nguyên thì im lặng, nếu không agent sẽ
   * nhận bão `list_changed` từ mọi trang React.
   */
  | {
      type: 'cs_declarative_delta';
      pageId: string;
      seq: number;
      added: ToolDecl[];
      removed: string[];
      changed: ToolDecl[];
    }
  | { type: 'cs_site_gone' };

export type SwToContent =
  /** Lập kế hoạch thao tác cho một tool (tìm phần tử, tính toạ độ, xếp thứ tự field). */
  | { type: 'sw_plan_action'; tool: string; args: Record<string, unknown> }
  /** Sau khi SW thi hành xong plan: đợi trang ổn định, xác minh, đọc kết quả. */
  | { type: 'sw_after_action'; tool: string }
  /** SW vừa hồi sinh — xin lại snapshot (§2.3 stateless-recoverable). */
  | { type: 'sw_request_resync' };

export interface PlanReply {
  ok: boolean;
  steps?: ActionStep[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Popup ↔ Service Worker (M1.5 — token pairing)
// ---------------------------------------------------------------------------

export type PopupToSw =
  | { type: 'popup_get_status' }
  | { type: 'popup_set_token'; token: string };

export interface PopupStatus {
  connected: boolean;
  hasToken: boolean;
  /** Số tab đang mở trang chuẩn Live MCP — giúp phân biệt "chưa nối" với "nối rồi mà chưa có site". */
  siteCount: number;
}

export interface AfterActionReply {
  /**
   * 'retry' = trang chưa đúng ý (vd ô ngày nhận sai thứ tự dd/mm) và content
   * script đã soạn sẵn plan sửa; SW thi hành rồi hỏi lại.
   */
  status: ActionStatus | 'retry';
  steps?: ActionStep[];
  resultText?: string;
  stateSnapshot?: string;
  /** Tool sinh ra do CHÍNH hành động này — agent thấy hệ quả ngay trong một lượt. */
  newTools?: string[];
  goneTools?: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Kênh Ask ↔ Service Worker
// ---------------------------------------------------------------------------

/**
 * Widget trợ lý chạy trong một content script RIÊNG (`ask.js`), không dùng chung
 * bundle với scanner declarative.
 *
 * Tách vì hai thứ có điều kiện sống khác nhau: scanner chỉ có việc trên trang
 * khai báo `<meta name="livemcp">`, còn widget phải có mặt trên mọi trang. Gộp
 * lại thì mỗi lần sửa widget là một lần có nguy cơ làm gãy đường declarative —
 * thứ đang chạy đúng và có lưới E2E bảo vệ.
 */
export type AskContentToSw =
  | {
      type: 'cs_ask_send';
      questionId: string;
      url: string;
      title: string;
      text: string;
      /** Đoạn người dùng CHỦ ĐỘNG bôi đen. Không bao giờ là nội dung trang tự lấy. */
      selection?: string;
    }
  /** Widget vừa dựng lại (mở tab, F5) → xin phần chưa nhận được. */
  | { type: 'cs_ask_hello'; url: string }
  | { type: 'cs_ask_delivered'; questionId: string }
  | { type: 'cs_ask_cancel'; questionId: string };

export type AskSwToContent =
  /** Phím tắt Alt+A — mở panel và kéo theo đoạn đang bôi đen, nếu có. */
  | { type: 'sw_ask_open' }
  /**
   * Trạng thái đường dây tới Local Server.
   *
   * Không có message này thì widget mù: `link.send()` khi chưa nối được **không
   * báo lỗi** — nó xếp câu hỏi vào outbox rồi thử nối lại trong im lặng. Người
   * dùng vì vậy nhìn thấy cùng một vòng xoay cho ba tình huống khác hẳn nhau
   * ("chưa ai trực", "không nối được server", "widget đã chết"), và sau 90 giây
   * còn bị chỉ sang claude.ai đúng lúc lỗi nằm ở máy mình. Đây là N2.
   */
  | { type: 'sw_ask_link'; connected: boolean }
  | { type: 'sw_ask_claimed'; questionId: string }
  | { type: 'sw_ask_answer'; questionId: string; markdown: string }
  | { type: 'sw_ask_followup'; questionId: string; text: string }
  | { type: 'sw_ask_released'; questionId: string };
