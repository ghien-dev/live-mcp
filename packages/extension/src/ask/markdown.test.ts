import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

/**
 * Widget được nhồi vào MỌI trang web, và câu trả lời đi thẳng vào `innerHTML`.
 * Một lỗ escape ở đây không phải lỗi hiển thị — nó là XSS trên mọi trang người
 * dùng ghé. Đây là lý do duy nhất phần render này có test, còn phần giao diện
 * thì không.
 */

describe('renderMarkdown — escape trước, biến đổi sau', () => {
  it('không để thẻ HTML thô lọt qua', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('không để thẻ lọt qua ngay cả khi nằm trong khối code', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script');
  });

  it('chặn liên kết javascript:, giữ nguyên chữ', () => {
    const html = renderMarkdown('[bấm đi](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('bấm đi');
  });

  it('cho phép http/https/mailto', () => {
    expect(renderMarkdown('[x](https://vd.com)')).toContain('<a href="https://vd.com"');
    expect(renderMarkdown('[x](mailto:a@b.com)')).toContain('<a href="mailto:a@b.com"');
  });

  it('nhãn liên kết cũng đã escape', () => {
    const html = renderMarkdown('[<b>đậm</b>](https://vd.com)');
    expect(html).not.toContain('<b>');
  });

  it('dựng được đậm, nghiêng, code, danh sách, tiêu đề', () => {
    expect(renderMarkdown('**đậm**')).toContain('<strong>đậm</strong>');
    expect(renderMarkdown('*nghiêng*')).toContain('<em>nghiêng</em>');
    expect(renderMarkdown('`mã`')).toContain('<code>mã</code>');
    expect(renderMarkdown('- một\n- hai')).toContain('<ul><li>một</li><li>hai</li></ul>');
    expect(renderMarkdown('1. một')).toContain('<ol><li>một</li></ol>');
    expect(renderMarkdown('# tiêu đề')).toContain('<h3>tiêu đề</h3>');
  });

  it('khối code không đóng vẫn được đóng hộ, không để thẻ hở', () => {
    const html = renderMarkdown('```\nxin chào');
    expect(html.endsWith('</code></pre>')).toBe(true);
  });
});
