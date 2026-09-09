/**
 * Markdown tối giản → HTML, dùng cho câu trả lời hiện trong widget.
 *
 * Vì sao tự viết thay vì kéo một thư viện: widget được nhồi vào **mọi trang
 * web**, nên mỗi kilobyte và mỗi phụ thuộc đều là thứ người dùng phải trả giá
 * trên từng lần tải trang. Tập cú pháp cần dùng lại rất nhỏ.
 *
 * Quy tắc an toàn duy nhất, và nó không được phép lung lay: **escape TRƯỚC, biến
 * đổi SAU**. Sau `escapeHtml` thì trong chuỗi không còn `<` `>` `&` `"` `'` nào
 * của bản gốc; mọi thẻ xuất hiện về sau đều do chính hàm này sinh ra. Đảo thứ tự
 * là mở cửa XSS trên mọi trang người dùng ghé.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Chỉ ba scheme này được thành liên kết bấm được. `javascript:` không nằm trong đó. */
const SAFE_SCHEME = /^(https?:\/\/|mailto:)/i;

/** Biến đổi trong dòng. Đầu vào ĐÃ escape. */
function inline(escaped: string): string {
  return (
    escaped
      // Code trong dòng đứng trước mọi thứ khác: nội dung bên trong không được
      // hiểu tiếp thành đậm/nghiêng.
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) =>
        SAFE_SCHEME.test(href)
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : whole,
      )
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  );
}

export function renderMarkdown(raw: string): string {
  const lines = escapeHtml(raw).split(/\r?\n/);
  const out: string[] = [];

  let inCode = false;
  let listKind: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listKind) return;
    out.push(`</${listKind}>`);
    listKind = null;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${line}\n`);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      // # → h3: h1/h2 là của trang chủ nhà, widget không tranh cấp bậc với nó.
      const level = Math.min((heading[1] ?? '#').length + 2, 6);
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const want: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      if (listKind !== want) {
        flushList();
        out.push(`<${want}>`);
        listKind = want;
      }
      out.push(`<li>${inline((bullet ?? numbered)?.[1] ?? '')}</li>`);
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  // Khối code không đóng: đóng hộ, đừng để thẻ hở làm vỡ layout widget.
  if (inCode) out.push('</code></pre>');
  flushPara();
  flushList();
  return out.join('');
}
