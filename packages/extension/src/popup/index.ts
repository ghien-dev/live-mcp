import type { PopupStatus, PopupToSw } from '../messages.js';

/**
 * Popup — chỗ duy nhất người dùng phải thao tác tay trong cả sản phẩm (M1.5).
 *
 * Giữ nó tối giản có chủ đích: mỗi bước thêm vào đây là một bước người dùng có
 * thể bỏ dở, mà bỏ dở ở đây nghĩa là extension không nối được server.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send<T>(msg: PopupToSw): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

async function refresh(): Promise<void> {
  const dot = $<HTMLSpanElement>('dot');
  const text = $<HTMLSpanElement>('statusText');

  let status: PopupStatus | undefined;
  try {
    status = await send<PopupStatus>({ type: 'popup_get_status' });
  } catch {
    // Service worker đang ngủ và chưa kịp dậy — không phải lỗi.
  }

  if (!status) {
    dot.className = 'dot';
    text.textContent = 'chưa liên lạc được service worker';
    return;
  }

  if (status.connected) {
    dot.className = 'dot on';
    text.textContent =
      status.siteCount > 0
        ? `đã nối server · ${status.siteCount} trang chuẩn đang mở`
        : 'đã nối server · chưa có trang chuẩn nào mở';
    return;
  }

  dot.className = 'dot off';
  text.textContent = status.hasToken
    ? 'chưa nối được server — server đang chạy chứ?'
    : 'chưa có token — dán token bên dưới';
}

$<HTMLButtonElement>('save').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('token');
  const token = input.value.trim();
  if (!token) return;

  const button = $<HTMLButtonElement>('save');
  button.disabled = true;
  await send({ type: 'popup_set_token', token });
  input.value = '';
  $<HTMLDivElement>('saved').textContent = 'Đã lưu token.';

  // Cho socket một nhịp mở xong rồi mới đọc lại trạng thái.
  setTimeout(() => {
    button.disabled = false;
    void refresh();
  }, 600);
});

// ---------------------------------------------------------------------------
// Widget hỏi trợ lý — công tắc tổng + gỡ các lần tắt theo từng trang
// ---------------------------------------------------------------------------

const GLOBAL_KEY = 'ask_global_enabled';
const ORIGIN_PREFIX = 'ask_enabled:';

async function refreshAsk(): Promise<void> {
  const box = $<HTMLInputElement>('askOn');
  const stored = await chrome.storage.local.get(GLOBAL_KEY);
  box.checked = stored[GLOBAL_KEY] !== false;
}

$<HTMLInputElement>('askOn').addEventListener('change', (e) => {
  void chrome.storage.local.set({ [GLOBAL_KEY]: (e.target as HTMLInputElement).checked });
});

/**
 * "Tắt ở trang này" trong widget là một cánh cửa một chiều nếu không có nút này:
 * widget đã biến mất thì không còn chỗ nào để bật lại nó.
 */
$<HTMLButtonElement>('askReset').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const off = Object.keys(all).filter((k) => k.startsWith(ORIGIN_PREFIX) && all[k] === false);
  if (off.length) await chrome.storage.local.remove(off);
  $<HTMLDivElement>('askSaved').textContent = off.length
    ? `Đã bật lại ở ${off.length} trang.`
    : 'Không có trang nào đang tắt riêng.';
});

void refresh();
void refreshAsk();
