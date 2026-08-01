/**
 * Điều khiển trang bằng Chrome DevTools Protocol.
 *
 * Đây là quyết định kiến trúc số 1 (docs/livemcp-architecture.md §2.1): sự kiện
 * tạo bằng `dispatchEvent` có `isTrusted: false`; chỉ CDP mới cho hành vi "y như
 * con người". Đánh đổi: Chrome hiện banner "đang debug" — coi đó là tính năng
 * minh bạch, user luôn biết agent đang điều khiển.
 */

import { parseKey } from './keys.js';

const attached = new Set<number>();

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) {
    attached.delete(source.tabId);
    console.info(`[Live MCP] debugger đã detach khỏi tab ${source.tabId}`);
  }
});

/** Attach lười: chỉ attach khi thực sự có hành động, detach khi phiên kết thúc. */
export async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached.add(tabId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already attached')) {
      attached.add(tabId);
      return;
    }
    throw err;
  }
}

export async function detach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

function send(tabId: number, method: string, params: object): Promise<unknown> {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

const BUTTON_MASK: Record<'left' | 'right' | 'middle', number> = {
  left: 1,
  right: 2,
  middle: 4,
};

/** Click thật tại toạ độ viewport: di chuột tới, nhấn, nhả. */
export async function click(
  tabId: number,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  clickCount = 1,
): Promise<void> {
  const base = { x, y, modifiers: 0 };

  await send(tabId, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
  });
  await send(tabId, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mousePressed',
    button,
    buttons: BUTTON_MASK[button],
    clickCount,
  });
  await send(tabId, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseReleased',
    button,
    buttons: 0,
    clickCount,
  });
}

/**
 * Gõ nguyên chuỗi vào phần tử đang focus.
 *
 * `Input.insertText` nhanh hơn nhiều so với gõ từng phím và vẫn là input tin cậy
 * (đúng cơ chế Playwright/Puppeteer dùng — §2.1). Nó không sinh keydown/keyup,
 * nên với ô cần bắt phím (autocomplete gõ tới đâu lọc tới đó) ta gõ từng ký tự.
 */
export async function insertText(tabId: number, text: string): Promise<void> {
  if (text === '') return;
  await send(tabId, 'Input.insertText', { text });
}

/** Gõ từng ký tự một — dùng khi trang cần nghe keydown/keyup của từng phím. */
export async function typeChars(tabId: number, text: string, delayMs = 20): Promise<void> {
  for (const ch of text) {
    await pressKey(tabId, ch);
    if (delayMs > 0) await sleep(delayMs);
  }
}

/** Bấm một phím: 'Enter', 'Tab', 'ArrowDown', 'Ctrl+S', '5', 'a'... */
export async function pressKey(tabId: number, spec: string): Promise<void> {
  const def = parseKey(spec);
  const base = {
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers: def.modifiers,
  };

  await send(tabId, 'Input.dispatchKeyEvent', {
    ...base,
    // Có text → 'keyDown' (sinh ký tự); không có → 'rawKeyDown' (chỉ điều khiển).
    type: def.text === undefined ? 'rawKeyDown' : 'keyDown',
    ...(def.text === undefined ? {} : { text: def.text, unmodifiedText: def.text }),
  });
  await send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

/** Ctrl+A để bôi đen nội dung cũ trước khi gõ đè. */
export async function selectAll(tabId: number): Promise<void> {
  const base = {
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: 2, // Ctrl
  };
  await send(tabId, 'Input.dispatchKeyEvent', {
    ...base,
    type: 'rawKeyDown',
    // `commands` để chắc chắn hành vi đúng kể cả khi phím tắt bị trang chiếm.
    commands: ['selectAll'],
  });
  await send(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// TODO(M3): hover / scroll (mouseWheel) / drag.
