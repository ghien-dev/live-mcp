/**
 * Giao thức nội bộ giữa Service Worker và Content Script.
 *
 * Khác với `@livemcp/protocol` (hợp đồng SW ↔ Server), các message ở đây không
 * bao giờ ra khỏi extension nên giữ tối giản: SW không biết gì về DOM, content
 * script không biết gì về WebSocket/CDP.
 */
import type { ActionStatus, ResourceDecl, ToolDecl } from '@livemcp/protocol';

export interface PageInfo {
  url: string;
  app: string;
  description: string;
  specVersion: string;
}

export type ContentToSw =
  | {
      type: 'cs_site_ready';
      site: PageInfo;
      seq: number;
      tools: ToolDecl[];
      resources: ResourceDecl[];
    }
  | { type: 'cs_site_gone' };

export type SwToContent =
  | { type: 'sw_ping' }
  /** Yêu cầu content script tìm phần tử và trả về toạ độ tâm trong viewport. */
  | { type: 'sw_resolve_target'; tool: string; args: Record<string, unknown> }
  /** Sau khi CDP đã dispatch xong: đợi trang ổn định rồi đọc kết quả. */
  | { type: 'sw_after_action'; tool: string }
  /** SW vừa hồi sinh — xin lại snapshot (§2.3 stateless-recoverable). */
  | { type: 'sw_request_resync' };

export interface ResolveTargetReply {
  ok: boolean;
  /** Toạ độ tâm phần tử theo viewport, đơn vị CSS pixel — ngôn ngữ chung với CDP (§2.2). */
  x?: number;
  y?: number;
  error?: string;
}

export interface AfterActionReply {
  status: ActionStatus;
  resultText?: string;
  stateSnapshot?: string;
  error?: string;
}
