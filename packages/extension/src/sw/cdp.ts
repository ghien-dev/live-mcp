/**
 * Điều khiển trang bằng Chrome DevTools Protocol.
 *
 * Đây là quyết định kiến trúc số 1 (docs/livemcp-architecture.md §2.1): sự kiện
 * tạo bằng `dispatchEvent` có `isTrusted: false`; chỉ CDP mới cho hành vi "y như
 * con người". Đánh đổi: Chrome hiện banner "đang debug" — coi đó là tính năng
 * minh bạch, user luôn biết agent đang điều khiển.
 */

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

// TODO(M1): typeText qua Input.insertText + Input.dispatchKeyEvent cho submit-key.
// TODO(M3): hover / scroll (mouseWheel) / press / drag.
