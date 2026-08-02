import { createHash, timingSafeEqual } from 'node:crypto';
import { TOKEN_QUERY_PARAM } from '@livemcp/protocol';

/**
 * Cổng vào của WS hub (docs/livemcp-roadmap.md M1.5).
 *
 * VÌ SAO CẦN — mô hình đe doạ dễ bị hiểu nhẹ: bind `127.0.0.1` KHÔNG có nghĩa là
 * "chỉ tiến trình trên máy này nối được". Handshake WebSocket không bị CORS chặn,
 * nên **bất kỳ trang web nào** đang mở trong bất kỳ trình duyệt nào cũng mở được
 * `ws://127.0.0.1:8787` và điều khiển trình duyệt của chính người dùng. Đây là
 * kịch bản drive-by thật, không phải rủi ro tương lai.
 *
 * HAI LỚP, vai khác nhau — cố ý không gộp:
 *   • Origin  → chặn đúng LỚP tấn công trên. Trang web không đặt được header
 *     `Origin` tuỳ ý, nên đây là bộ lọc mà kẻ tấn công qua trình duyệt không lách
 *     được, kể cả khi đoán đúng cổng.
 *   • Token   → XÁC THỰC. Chặn tiến trình local tuỳ ý (không đi qua trình duyệt
 *     nên không bị ràng buộc Origin).
 *
 * Module thuần logic, không đụng socket — để unit test chạy được không cần mạng.
 */

export interface HandshakeInfo {
  /** `req.url` của yêu cầu upgrade, ví dụ `/?token=abc`. */
  url?: string;
  /** `req.headers.origin`; extension service worker gửi `chrome-extension://…`. */
  origin?: string;
}

export type HandshakeVerdict =
  | { ok: true }
  | { ok: false; code: number; reason: string };

/** Mã đóng WebSocket khi từ chối. 1008 = policy violation (RFC 6455). */
export const CLOSE_POLICY_VIOLATION = 1008;

/**
 * Origin được phép: không có origin, hoặc origin của chính extension.
 *
 * Danh sách trắng chứ không phải danh sách đen — thêm một scheme lạ trong tương
 * lai sẽ bị từ chối và có người biết, thay vì lọt vào im lặng (nguyên tắc N2).
 */
export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  return origin.startsWith('chrome-extension://');
}

/** Lấy token từ query string; `req.url` chỉ có phần path nên phải ghép base giả. */
export function tokenFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'ws://localhost').searchParams.get(TOKEN_QUERY_PARAM);
  } catch {
    return null;
  }
}

/**
 * So sánh thời gian hằng định. Băm trước khi so để hai chuỗi luôn cùng độ dài —
 * `timingSafeEqual` ném lỗi khi lệch độ dài, và nếu bắt lỗi đó thì chính việc
 * bắt lỗi lại làm rò rỉ độ dài token.
 */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyHandshake(info: HandshakeInfo, expectedToken: string): HandshakeVerdict {
  if (!isAllowedOrigin(info.origin)) {
    return {
      ok: false,
      code: CLOSE_POLICY_VIOLATION,
      reason: `Từ chối kết nối từ origin "${info.origin}". Chỉ extension Live MCP được nối vào hub.`,
    };
  }

  const token = tokenFromUrl(info.url);
  if (!token) {
    return {
      ok: false,
      code: CLOSE_POLICY_VIOLATION,
      reason: 'Kết nối không kèm token. Hãy dán token của server vào popup extension Live MCP.',
    };
  }
  if (!secretEquals(token, expectedToken)) {
    return {
      ok: false,
      code: CLOSE_POLICY_VIOLATION,
      reason: 'Token không khớp. Mở popup extension và dán lại token mà server in ra lúc khởi động.',
    };
  }

  return { ok: true };
}
