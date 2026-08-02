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

void refresh();
