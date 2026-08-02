/**
 * Bảng phím cho `Input.dispatchKeyEvent`.
 *
 * CDP cần đủ `key` + `code` + `windowsVirtualKeyCode` thì trang mới nhận được
 * sự kiện giống hệt bàn phím thật; thiếu `code` là nhiều thư viện UI bỏ qua.
 */

export interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  /** Có `text` = phím sinh ký tự (gõ chữ); không có = phím điều khiển. */
  text?: string;
  modifiers: number;
}

/** Bitmask modifier của CDP. */
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/**
 * `key` chỉ khai khi **khác** tên tra cứu.
 *
 * Với hầu hết phím thì tên spec trùng đúng giá trị `KeyboardEvent.key` của DOM
 * ('Enter', 'ArrowLeft', 'PageUp'…), nên để trống là đúng. Ngoại lệ duy nhất là
 * phím cách: spec viết `Space` (đó là `code`), còn `key` của DOM là một dấu
 * cách ' '. Gửi `key: 'Space'` thì trình duyệt **không** coi đó là phím cách —
 * checkbox/radio/button không toggle, và hỏng hoàn toàn im lặng vì sự kiện vẫn
 * được gửi đi, vẫn trusted, chỉ là không kích hoạt gì cả.
 */
const NAMED: Record<string, { key?: string; code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

/**
 * Phân tích tên phím theo spec (`livemcp-key`): 'Enter', 'Escape', 'Ctrl+S',
 * 'ArrowLeft', '5', 'a'.
 */
export function parseKey(spec: string): KeyDef {
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
  const rawKey = parts.pop() ?? spec;

  let modifiers = 0;
  for (const part of parts) {
    modifiers |= MODIFIER_BITS[part.toLowerCase()] ?? 0;
  }

  const named = NAMED[rawKey] ?? NAMED[rawKey.charAt(0).toUpperCase() + rawKey.slice(1)];
  if (named) {
    return {
      key: named.key ?? rawKey,
      code: named.code,
      keyCode: named.keyCode,
      text: named.text,
      modifiers,
    };
  }

  if (/^\d$/.test(rawKey)) {
    return {
      key: rawKey,
      code: `Digit${rawKey}`,
      keyCode: 48 + Number(rawKey),
      text: rawKey,
      modifiers,
    };
  }

  if (/^[a-zA-Z]$/.test(rawKey)) {
    const upper = rawKey.toUpperCase();
    return {
      key: rawKey,
      code: `Key${upper}`,
      keyCode: upper.charCodeAt(0),
      // Phím tắt (có Ctrl/Alt/Meta) không sinh ký tự.
      text: modifiers & (MODIFIER_BITS.ctrl! | MODIFIER_BITS.alt! | MODIFIER_BITS.meta!)
        ? undefined
        : rawKey,
      modifiers,
    };
  }

  // Ký tự đơn khác (dấu câu, ký tự có dấu): gõ như ký tự thường.
  return { key: rawKey, code: '', keyCode: 0, text: rawKey, modifiers };
}
