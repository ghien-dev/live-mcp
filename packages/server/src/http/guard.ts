import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Cổng vào của MCP Streamable HTTP — bản song sinh với `bridge/handshake.ts`.
 *
 * VÌ SAO CẦN, và vì sao nó KHÁC cửa WS: cửa này mở ra internet qua tunnel. Ở WS
 * hub, mối lo là một trang web bất kỳ mở `ws://127.0.0.1:8787`. Ở đây mối lo lớn
 * hơn hẳn — ai biết URL tunnel là đọc được **mọi câu hỏi trên mọi trang bạn
 * duyệt**, và tệ hơn, **bơm được câu trả lời giả** vào widget của bạn. Kênh này
 * hai chiều, nên rò rỉ không phải là hậu quả duy nhất.
 *
 * BA LỚP, vai khác nhau — cố ý không gộp:
 *   • Origin  → chặn trình duyệt. Không có client MCP hợp lệ nào của hệ này chạy
 *     trong trang web, nên sự CÓ MẶT của header `Origin` đã là dấu hiệu sai chỗ.
 *     Trang web không đặt được header này tuỳ ý → kẻ tấn công qua trình duyệt
 *     không lách được.
 *   • Host    → chặn DNS rebinding: kẻ tấn công trỏ tên miền của họ về 127.0.0.1
 *     rồi cho trang của họ gọi vào. Origin bắt phần lớn ca này, Host bịt phần còn lại.
 *   • Bearer  → XÁC THỰC. Chặn mọi thứ đến từ internet qua tunnel.
 *
 * Module thuần logic, không đụng socket — để unit test chạy được không cần mạng.
 */

export interface HttpRequestInfo {
  headers: {
    authorization?: string;
    origin?: string;
    host?: string;
  };
}

export interface GuardOptions {
  /**
   * Token bearer bắt buộc. `null` = TẮT xác thực ở tầng này, dành cho trường hợp
   * hạ tầng đã lo (Cloudflare Access). Phải là một lựa chọn tường minh của người
   * dùng, không bao giờ là mặc định.
   */
  token: string | null;
  /**
   * Giá trị header `Host` được chấp nhận. Rỗng = tắt kiểm (không khuyến khích).
   * Sau tunnel, Host là hostname công khai — phải khai bằng `--http-allow-host`.
   */
  allowedHosts: string[];
}

export type HttpVerdict =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * So sánh thời gian hằng định. Băm trước để hai chuỗi luôn cùng độ dài —
 * `timingSafeEqual` ném lỗi khi lệch độ dài, và bắt lỗi đó lại chính là làm rò
 * rỉ độ dài token.
 */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Tách `Bearer <token>`; chấp nhận mọi cách viết hoa thường của lược đồ. */
export function bearerFrom(authorization?: string): string | null {
  if (!authorization) return null;
  const m = /^bearer\s+(.+)$/i.exec(authorization.trim());
  return m?.[1]?.trim() || null;
}

export function verifyHttpRequest(info: HttpRequestInfo, opts: GuardOptions): HttpVerdict {
  const { origin, host } = info.headers;

  if (origin) {
    return {
      ok: false,
      status: 403,
      message:
        `Từ chối yêu cầu mang header Origin "${origin}". ` +
        'Endpoint này chỉ dành cho client MCP (claude.ai, Claude Code) — ' +
        'không có client hợp lệ nào chạy trong trang web.',
    };
  }

  // Danh sách trắng chứ không phải danh sách đen: một Host lạ trong tương lai sẽ
  // bị từ chối và có người biết, thay vì lọt vào im lặng (nguyên tắc N2).
  if (opts.allowedHosts.length > 0) {
    const seen = (host ?? '').toLowerCase();
    if (!opts.allowedHosts.some((h) => h.toLowerCase() === seen)) {
      return {
        ok: false,
        status: 421,
        message:
          `Từ chối yêu cầu với Host "${host ?? '(trống)'}". ` +
          `Host được phép: ${opts.allowedHosts.join(', ')}. ` +
          'Chạy qua tunnel thì phải khai hostname công khai bằng --http-allow-host.',
      };
    }
  }

  if (opts.token === null) return { ok: true };

  const bearer = bearerFrom(info.headers.authorization);
  if (!bearer) {
    return {
      ok: false,
      status: 401,
      message:
        'Thiếu header Authorization: Bearer <token>. ' +
        'Token HTTP được server in ra lúc khởi động và lưu tại ~/.livemcp/http-token.',
    };
  }
  if (!secretEquals(bearer, opts.token)) {
    return { ok: false, status: 401, message: 'Token HTTP không khớp.' };
  }

  return { ok: true };
}
