import { describe, expect, it } from 'vitest';
import { bearerFrom, verifyHttpRequest } from './guard.js';

/**
 * Cửa vào duy nhất giữa internet và hàng đợi câu hỏi của người dùng.
 *
 * Đây là chỗ đáng viết test nhất trong cả A3, và lý do không phải là "code khó":
 * nó hỏng theo kiểu **trông vẫn chạy đúng**. Một lỗ ở đây không làm gãy tính
 * năng nào — claude.ai vẫn nối được, widget vẫn trả lời — nên không có triệu
 * chứng nào để ai đó tình cờ nhận ra. Thứ duy nhất bắt được nó là một bài test
 * cố tình gõ cửa sai cách.
 */

const TOKEN = 'token-that-is-secret';
const opts = { token: TOKEN, allowedHosts: ['127.0.0.1:8788'] };
const auth = `Bearer ${TOKEN}`;

describe('bearerFrom', () => {
  it('đọc được token bất kể cách viết hoa thường của lược đồ', () => {
    expect(bearerFrom('Bearer abc')).toBe('abc');
    expect(bearerFrom('bearer abc')).toBe('abc');
    expect(bearerFrom('BEARER  abc  ')).toBe('abc');
  });

  it('trả null khi không phải bearer', () => {
    expect(bearerFrom(undefined)).toBeNull();
    expect(bearerFrom('Basic abc')).toBeNull();
    expect(bearerFrom('Bearer')).toBeNull();
    expect(bearerFrom('Bearer   ')).toBeNull();
  });
});

describe('verifyHttpRequest — token', () => {
  it('cho qua khi token đúng', () => {
    const v = verifyHttpRequest({ headers: { host: '127.0.0.1:8788', authorization: auth } }, opts);
    expect(v.ok).toBe(true);
  });

  it('401 khi thiếu Authorization', () => {
    const v = verifyHttpRequest({ headers: { host: '127.0.0.1:8788' } }, opts);
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it('401 khi token sai', () => {
    const v = verifyHttpRequest(
      { headers: { host: '127.0.0.1:8788', authorization: 'Bearer sai-roi' } },
      opts,
    );
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it('token dài bằng nhau nhưng khác nội dung vẫn bị chặn', () => {
    const v = verifyHttpRequest(
      {
        headers: { host: '127.0.0.1:8788', authorization: `Bearer ${'x'.repeat(TOKEN.length)}` },
      },
      opts,
    );
    expect(v).toMatchObject({ ok: false, status: 401 });
  });

  it('token null = tắt xác thực có chủ đích (Cloudflare Access lo)', () => {
    const v = verifyHttpRequest(
      { headers: { host: '127.0.0.1:8788' } },
      { token: null, allowedHosts: ['127.0.0.1:8788'] },
    );
    expect(v.ok).toBe(true);
  });
});

describe('verifyHttpRequest — Origin chặn trình duyệt', () => {
  /**
   * Lớp này chặn kịch bản drive-by: một trang web bất kỳ gọi vào endpoint. Trang
   * web không đặt được header `Origin` tuỳ ý, nên sự CÓ MẶT của nó đã đủ để kết
   * luận yêu cầu đến từ trình duyệt — mà không client MCP hợp lệ nào của hệ này
   * chạy trong trình duyệt cả.
   */
  it('403 với mọi Origin, kể cả khi token đúng', () => {
    const v = verifyHttpRequest(
      { headers: { host: '127.0.0.1:8788', origin: 'https://ke-tan-cong.example', authorization: auth } },
      opts,
    );
    expect(v).toMatchObject({ ok: false, status: 403 });
  });

  it('Origin bị xét TRƯỚC token — không rò rỉ chuyện token đúng hay sai', () => {
    const v = verifyHttpRequest(
      { headers: { host: '127.0.0.1:8788', origin: 'https://x.example', authorization: 'Bearer sai' } },
      opts,
    );
    expect(v).toMatchObject({ ok: false, status: 403 });
  });
});

describe('verifyHttpRequest — Host chặn DNS rebinding', () => {
  it('421 khi Host không nằm trong danh sách trắng', () => {
    const v = verifyHttpRequest(
      { headers: { host: 'ten-mien-cua-ke-tan-cong.example', authorization: auth } },
      opts,
    );
    expect(v).toMatchObject({ ok: false, status: 421 });
  });

  it('421 khi thiếu hẳn Host', () => {
    const v = verifyHttpRequest({ headers: { authorization: auth } }, opts);
    expect(v).toMatchObject({ ok: false, status: 421 });
  });

  it('hostname tunnel đã khai thì cho qua', () => {
    const v = verifyHttpRequest(
      { headers: { host: 'mcp.vidu.com', authorization: auth } },
      { token: TOKEN, allowedHosts: ['127.0.0.1:8788', 'mcp.vidu.com'] },
    );
    expect(v.ok).toBe(true);
  });

  it('so khớp Host không phân biệt hoa thường', () => {
    const v = verifyHttpRequest(
      { headers: { host: 'MCP.ViDu.com', authorization: auth } },
      { token: TOKEN, allowedHosts: ['mcp.vidu.com'] },
    );
    expect(v.ok).toBe(true);
  });

  it('danh sách rỗng = tắt kiểm Host có chủ đích', () => {
    const v = verifyHttpRequest(
      { headers: { host: 'bat-ky.example', authorization: auth } },
      { token: TOKEN, allowedHosts: [] },
    );
    expect(v.ok).toBe(true);
  });
});
