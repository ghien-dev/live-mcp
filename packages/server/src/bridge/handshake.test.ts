import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, tokenFromUrl, verifyHandshake } from './handshake.js';

/**
 * Vì sao phần này đáng viết test dù rất ngắn: nếu cổng vào hỏng thì nó hỏng
 * **im lặng** — mọi thứ vẫn chạy đúng như trước, chỉ là ai cũng vào được. Không
 * có test nào ở tầng trên phát hiện được điều đó (nguyên tắc N2).
 */

const TOKEN = 'token-that-only-the-user-has';

describe('verifyHandshake', () => {
  it('cho qua kết nối của extension: không origin web, token đúng', () => {
    expect(
      verifyHandshake({ url: `/?token=${TOKEN}`, origin: 'chrome-extension://abcdef' }, TOKEN),
    ).toEqual({ ok: true });
  });

  it('cho qua khi hoàn toàn không có header origin', () => {
    expect(verifyHandshake({ url: `/?token=${TOKEN}` }, TOKEN)).toEqual({ ok: true });
  });

  it('CHẶN trang web dù đoán đúng token — đây là lớp tấn công drive-by thật', () => {
    const verdict = verifyHandshake(
      { url: `/?token=${TOKEN}`, origin: 'https://trang-doc.example' },
      TOKEN,
    );
    expect(verdict.ok).toBe(false);
  });

  it('CHẶN cả origin http nội bộ — trang localhost khác không phải extension', () => {
    expect(verifyHandshake({ url: `/?token=${TOKEN}`, origin: 'http://localhost:3000' }, TOKEN).ok)
      .toBe(false);
  });

  it('CHẶN khi không kèm token', () => {
    const verdict = verifyHandshake({ url: '/' }, TOKEN);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('token');
  });

  it('CHẶN khi token sai', () => {
    expect(verifyHandshake({ url: '/?token=doan-bua', origin: undefined }, TOKEN).ok).toBe(false);
  });

  it('CHẶN token đúng-tiền-tố nhưng không khớp hoàn toàn', () => {
    expect(verifyHandshake({ url: `/?token=${TOKEN}x` }, TOKEN).ok).toBe(false);
    expect(verifyHandshake({ url: `/?token=${TOKEN.slice(0, -1)}` }, TOKEN).ok).toBe(false);
  });

  it('không sập khi url rác', () => {
    expect(verifyHandshake({ url: '%%%' }, TOKEN).ok).toBe(false);
    expect(verifyHandshake({}, TOKEN).ok).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('chỉ nhận extension hoặc không origin — danh sách trắng, không phải danh sách đen', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('chrome-extension://xyz')).toBe(true);
    expect(isAllowedOrigin('https://a.example')).toBe(false);
    expect(isAllowedOrigin('http://a.example')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin('file://')).toBe(false);
  });
});

describe('tokenFromUrl', () => {
  it('đọc được token và giải mã percent-encoding', () => {
    expect(tokenFromUrl('/?token=abc')).toBe('abc');
    expect(tokenFromUrl('/?token=a%2Bb')).toBe('a+b');
    expect(tokenFromUrl('/?x=1&token=abc')).toBe('abc');
  });

  it('trả null khi thiếu', () => {
    expect(tokenFromUrl('/')).toBeNull();
    expect(tokenFromUrl(undefined)).toBeNull();
  });
});
