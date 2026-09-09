import type { AskContentToSw, AskSwToContent } from '../messages.js';
import { renderMarkdown } from './markdown.js';
import { WIDGET_CSS } from './styles.js';

/**
 * Widget "Hỏi trợ lý" — content script chạy trên MỌI trang.
 *
 * Nguyên tắc không được phá:
 *   1. **Không bao giờ tự đọc nội dung trang.** Chỉ gửi đi câu người dùng gõ và
 *      đoạn họ CHỦ ĐỘNG bôi đen. Vừa là ranh giới riêng tư, vừa giữ context của
 *      agent khỏi bị nhồi rác.
 *   2. **Không im lặng.** Mọi lúc chờ đều phải có chữ nói rõ đang chờ ai và chờ
 *      vì cái gì — im lặng là kiểu hỏng khiến người dùng ngồi nhìn vòng xoay
 *      không biết đầu bên kia còn ai không.
 *   3. Shadow DOM closed, và không đụng DOM của trang ngoài đúng một thẻ host.
 */

const ORIGIN = location.origin;
const THREAD_KEY = `ask_thread:${ORIGIN}`;
const ORIGIN_KEY = `ask_enabled:${ORIGIN}`;
const GLOBAL_KEY = 'ask_global_enabled';

/** Chờ quá lâu mà chưa phiên agent nào nhận → nói thẳng là chưa có ai trực. */
const NO_LISTENER_HINT_MS = 90_000;
/** Nhịp vẽ lại để dòng trạng thái tự chuyển sang cảnh báo đúng lúc. */
const TICK_MS = 5_000;
/** Giữ lịch sử vừa đủ để mở lại thấy mạch trò chuyện, không phình storage. */
const THREAD_LIMIT = 30;
/** Trần đoạn bôi đen gửi đi — dài hơn thì gần như chắc chắn là chọn nhầm cả trang. */
const SELECTION_LIMIT = 4_000;

type ItemStatus = 'waiting' | 'claimed' | 'answered';

interface ThreadItem {
  id: string;
  askedAt: number;
  text: string;
  selection?: string;
  status: ItemStatus;
  answer?: string;
  followups: string[];
}

let thread: ThreadItem[] = [];
let open = false;
let unread = false;
let pendingSelection = '';

/**
 * Đường dây SW → Local Server. `null` = chưa nghe SW nói gì lần nào.
 *
 * Ba giá trị chứ không phải hai: lúc widget vừa dựng mà SW còn đang ngủ thì
 * chưa biết gì cả, và nói bừa "mất kết nối" lúc đó là báo động giả.
 */
let linkOk: boolean | null = null;

/**
 * Widget này thuộc một bản extension đã bị gỡ khỏi bộ nhớ (reload/cập nhật).
 *
 * Nó vẫn hiện, vẫn gõ được, nhưng mọi thứ gửi đi đều rơi vào hư không — content
 * script cũ không còn cầu nối nào tới SW. Chỉ F5 mới cứu được, nên phải nói ra
 * đúng câu đó thay vì để người dùng ngồi nhìn vòng xoay.
 */
let contextDead = false;

let root: HTMLDivElement;
let shadow: ShadowRoot;
let askChip: HTMLButtonElement | null = null;

// ---------------------------------------------------------------------------
// Khởi động
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  if (!(await isEnabled())) return;

  thread = await loadThread();
  mount();
  render();

  // Widget vừa dựng lại (mở tab mới, hoặc F5 đúng lúc câu trả lời đang bay về)
  // → xin server giao lại phần chưa nhận.
  send({ type: 'cs_ask_hello', url: location.href });

  chrome.runtime.onMessage.addListener((msg: AskSwToContent) => {
    if (!msg?.type?.startsWith('sw_ask_')) return;
    handleServer(msg);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!(ORIGIN_KEY in changes) && !(GLOBAL_KEY in changes)) return;
    void isEnabled().then((on) => {
      root.style.display = on ? '' : 'none';
      if (!on) closePanel();
    });
  });

  setInterval(() => {
    // Chỉ vẽ lại khi thật sự có cái đang chờ — đừng đụng DOM vô cớ mỗi 5 giây.
    if (open && thread.some((i) => i.status !== 'answered')) render();
  }, TICK_MS);

  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('mousedown', (e) => {
    if (askChip && e.target !== askChip) hideAskChip();
  });
}

async function isEnabled(): Promise<boolean> {
  const s = await chrome.storage.local.get([GLOBAL_KEY, ORIGIN_KEY]);
  // Mặc định BẬT: người dùng đã chủ động cài extension này rồi, bắt họ bật lại
  // trên từng trang là ma sát không đổi lấy được gì.
  return s[GLOBAL_KEY] !== false && s[ORIGIN_KEY] !== false;
}

// ---------------------------------------------------------------------------
// Lưu trữ
// ---------------------------------------------------------------------------

async function loadThread(): Promise<ThreadItem[]> {
  const s = await chrome.storage.local.get(THREAD_KEY);
  const raw = s[THREAD_KEY];
  return Array.isArray(raw) ? (raw as ThreadItem[]) : [];
}

function saveThread(): void {
  void chrome.storage.local.set({ [THREAD_KEY]: thread.slice(-THREAD_LIMIT) });
}

/**
 * Gửi cho SW. Không được nuốt lỗi im lặng — đó chính là lỗi đã bắt được lúc
 * dùng thử thật: extension vừa build lại, widget cũ vẫn hiện, người dùng hỏi và
 * ngồi nhìn vòng xoay mãi mãi vì `sendMessage` ném lỗi rồi bị `.catch(() => {})`
 * nuốt gọn.
 *
 * Vẫn không để lỗi nổ ra console của trang chủ nhà — nhưng thay vì vứt đi, ta
 * ghi nhận nó thành trạng thái hiển thị được.
 */
function send(msg: AskContentToSw): void {
  const dead = () => {
    if (contextDead) return;
    contextDead = true;
    render();
  };

  /**
   * Reject KHÔNG đủ để kết luận widget đã chết: SW đang ngủ dậy cũng reject một
   * nhịp. Dấu hiệu chắc chắn là `chrome.runtime.id` biến mất — context bị gỡ thì
   * chính đối tượng `chrome.runtime` cũng không còn dùng được nữa.
   */
  const onFail = () => {
    let alive = false;
    try {
      alive = Boolean(chrome.runtime?.id);
    } catch {
      alive = false;
    }
    if (!alive) dead();
  };

  try {
    // Ném ĐỒNG BỘ khi context đã chết, reject khi SW không nhận — bắt cả hai
    // đường, chỉ chừa một là lỗi lọt qua im lặng y như cũ.
    void chrome.runtime.sendMessage(msg).catch(onFail);
  } catch {
    dead();
  }
}

// ---------------------------------------------------------------------------
// Server → widget
// ---------------------------------------------------------------------------

function handleServer(msg: AskSwToContent): void {
  if (msg.type === 'sw_ask_open') {
    // Phím tắt: nếu người dùng đang bôi đen thì kéo luôn đoạn đó vào ô soạn —
    // đó gần như luôn là lý do họ bấm phím tắt.
    const sel = document.getSelection()?.toString().trim() ?? '';
    if (sel.length >= 2) pendingSelection = sel.slice(0, SELECTION_LIMIT);
    open = true;
    unread = false;
    render();
    focusInput();
    return;
  }

  if (msg.type === 'sw_ask_link') {
    // Nghe được SW nói nghĩa là cầu nối còn sống — gỡ luôn nghi ngờ "widget đã
    // chết" nếu trước đó có một lần gửi trượt vì SW đang ngủ.
    contextDead = false;
    if (linkOk === msg.connected) return;
    linkOk = msg.connected;
    render();
    return;
  }

  const item = thread.find((i) => i.id === msg.questionId);
  if (!item) return;

  switch (msg.type) {
    case 'sw_ask_claimed':
      if (item.status === 'waiting') item.status = 'claimed';
      break;
    case 'sw_ask_released':
      if (item.status === 'claimed') item.status = 'waiting';
      break;
    case 'sw_ask_followup':
      item.followups.push(msg.text);
      break;
    case 'sw_ask_answer':
      item.status = 'answered';
      item.answer = msg.markdown;
      // Xác nhận rồi server mới được dọn: tab chết giữa chừng thì câu trả lời
      // vẫn còn để lần mở sau `cs_ask_hello` lấy lại.
      send({ type: 'cs_ask_delivered', questionId: item.id });
      if (!open) unread = true;
      break;
  }
  saveThread();
  render();
}

// ---------------------------------------------------------------------------
// Dựng DOM
// ---------------------------------------------------------------------------

function mount(): void {
  root = document.createElement('div');
  root.setAttribute('data-livemcp-ask', '');
  // documentElement chứ không phải body: content script chạy ở document_idle
  // nhưng vẫn có trang thay cả body sau đó, và host sẽ bay theo.
  document.documentElement.appendChild(root);

  shadow = root.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = WIDGET_CSS;
  shadow.append(style);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(): void {
  // Cả gốc bị thay mới, nên tham chiếu chip cũ trỏ vào một node đã rời cây —
  // giữ lại sẽ thành một nút vô hình không bao giờ hiện ra nữa.
  shadow.querySelector('.lmx-root')?.remove();
  askChip = null;
  const box = el('div', 'lmx-root');
  box.append(open ? renderPanel() : renderDot());
  shadow.append(box);
}

function renderDot(): HTMLElement {
  const dot = el('button', 'lmx-dot', '\u{1F4AC}');
  dot.title = 'Hỏi trợ lý Live MCP';
  if (unread) dot.dataset.unread = '1';
  dot.addEventListener('click', () => {
    open = true;
    unread = false;
    render();
    focusInput();
  });
  return dot;
}

function renderPanel(): HTMLElement {
  const panel = el('div', 'lmx-panel');

  const head = el('div', 'lmx-head');
  head.append(el('div', 'lmx-title', 'Trợ lý Live MCP'));

  const offBtn = el('button', 'lmx-link', 'Tắt ở trang này');
  offBtn.title = `Ẩn widget trên ${ORIGIN}. Bật lại ở popup extension.`;
  offBtn.addEventListener('click', () => {
    void chrome.storage.local.set({ [ORIGIN_KEY]: false });
  });

  const closeBtn = el('button', 'lmx-link', '✕');
  closeBtn.title = 'Đóng';
  closeBtn.addEventListener('click', closePanel);

  head.append(offBtn, closeBtn);
  panel.append(head, renderThread(), renderCompose());
  return panel;
}

function closePanel(): void {
  open = false;
  render();
}

function focusInput(): void {
  shadow.querySelector<HTMLTextAreaElement>('.lmx-ta')?.focus();
}

function renderThread(): HTMLElement {
  const list = el('div', 'lmx-thread');
  if (thread.length === 0) {
    list.append(
      el(
        'div',
        'lmx-empty',
        'Bôi đen một đoạn trên trang rồi bấm "Hỏi Claude", hoặc gõ thẳng câu hỏi bên dưới.',
      ),
    );
    return list;
  }

  for (const item of thread) {
    const turn = el('div', 'lmx-turn');

    const q = el('div', 'lmx-q', item.text);
    if (item.selection) q.append(el('div', 'lmx-sel', item.selection));
    turn.append(q);

    for (const f of item.followups) {
      turn.append(el('div', 'lmx-followup', `Claude hỏi lại: ${f}`));
    }

    if (item.status === 'answered' && item.answer !== undefined) {
      const a = el('div', 'lmx-a');
      // An toàn nhờ renderMarkdown escape TRƯỚC rồi mới sinh thẻ — xem markdown.ts.
      a.innerHTML = renderMarkdown(item.answer);
      turn.append(a);
    } else {
      turn.append(renderStatus(item));
    }
    list.append(turn);
  }

  // Vẽ xong mới cuộn: chiều cao chưa tồn tại trước khi gắn vào cây.
  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });
  return list;
}

/**
 * Vì sao hàm này dài hơn vẻ ngoài của nó: bốn tình huống dưới đây trước kia
 * hiện ra y hệt nhau — một vòng xoay và câu "đang chờ một phiên Claude". Ba
 * trong bốn tình huống đó KHÔNG phải đang chờ Claude, và hai cái cần người dùng
 * ra tay thì mới xong. Gộp chúng lại là kiểu hỏng im lặng mà N2 cấm.
 */
function renderStatus(item: ThreadItem): HTMLElement {
  const row = el('div', 'lmx-status');

  // 1. Widget mồ côi: không spinner, vì không có gì đang chạy để mà quay.
  if (contextDead) {
    row.dataset.tone = 'warn';
    row.append(
      el(
        'span',
        undefined,
        'Extension vừa được nạp lại nên widget này đã cũ — câu hỏi không gửi đi được. ' +
          'Tải lại trang (F5) rồi hỏi lại.',
      ),
    );
    return row;
  }

  // 2. Chưa nối được server: câu hỏi đang nằm chờ trong trình duyệt, chưa hề rời máy.
  if (linkOk === false) {
    row.dataset.tone = 'warn';
    row.append(
      el(
        'span',
        undefined,
        'Chưa nối được Local Server, câu hỏi đang xếp hàng trong trình duyệt. ' +
          'Kiểm tra server đã chạy chưa; token thì dán ở popup extension.',
      ),
    );
    return row;
  }

  row.append(el('span', 'lmx-spin'));

  if (item.status === 'claimed') {
    row.append(el('span', undefined, 'Claude đã nhận câu hỏi, đang trả lời…'));
    return row;
  }
  if (Date.now() - item.askedAt > NO_LISTENER_HINT_MS) {
    row.dataset.tone = 'warn';
    row.append(
      el(
        'span',
        undefined,
        'Chưa có phiên Claude nào nhận. Mở claude.ai và bảo "trả lời các câu hỏi đang đợi".',
      ),
    );
    return row;
  }
  row.append(el('span', undefined, 'Đang chờ một phiên Claude nhận câu hỏi…'));
  return row;
}

function renderCompose(): HTMLElement {
  const wrap = el('div', 'lmx-compose');

  if (pendingSelection) {
    const chip = el('div', 'lmx-chip');
    chip.append(el('span', undefined, pendingSelection));
    const drop = el('button', 'lmx-link', '✕');
    drop.title = 'Bỏ đoạn đã bôi đen';
    drop.addEventListener('click', () => {
      pendingSelection = '';
      render();
    });
    chip.append(drop);
    wrap.append(chip);
  }

  const ta = el('textarea', 'lmx-ta');
  ta.placeholder = 'Hỏi về trang này…';
  ta.rows = 3;

  const row = el('div', 'lmx-row');
  row.append(el('div', 'lmx-hint', 'Ctrl+Enter để gửi'));
  const btn = el('button', 'lmx-send', 'Gửi');
  btn.disabled = true;
  row.append(btn);

  const submit = () => {
    const text = ta.value.trim();
    if (!text) return;
    ask(text, pendingSelection || undefined);
    ta.value = '';
    pendingSelection = '';
    render();
  };

  ta.addEventListener('input', () => {
    btn.disabled = ta.value.trim().length === 0;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });
  btn.addEventListener('click', submit);

  wrap.append(ta, row);
  return wrap;
}

// ---------------------------------------------------------------------------
// Gửi câu hỏi
// ---------------------------------------------------------------------------

function ask(text: string, selection?: string): void {
  const item: ThreadItem = {
    id: `q-${crypto.randomUUID()}`,
    askedAt: Date.now(),
    text,
    selection,
    status: 'waiting',
    followups: [],
  };
  thread.push(item);
  if (thread.length > THREAD_LIMIT) thread = thread.slice(-THREAD_LIMIT);
  saveThread();

  send({
    type: 'cs_ask_send',
    questionId: item.id,
    url: location.href,
    title: document.title,
    text,
    selection,
  });
}

// ---------------------------------------------------------------------------
// Bôi đen → nút hỏi nổi lên
// ---------------------------------------------------------------------------

function onSelectionChange(): void {
  if (open) return;
  const sel = document.getSelection();
  const text = sel?.toString().trim() ?? '';
  if (!sel || sel.rangeCount !== 1 || text.length < 2) {
    hideAskChip();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideAskChip();
    return;
  }
  showAskChip(text.slice(0, SELECTION_LIMIT), rect);
}

function showAskChip(text: string, rect: DOMRect): void {
  if (!askChip) {
    askChip = el('button', 'lmx-ask-chip', 'Hỏi Claude');
    shadow.querySelector('.lmx-root')?.append(askChip);
  }
  const chip = askChip;
  chip.onclick = () => {
    pendingSelection = text;
    open = true;
    unread = false;
    hideAskChip();
    render();
    focusInput();
  };
  chip.style.left = `${rect.left + rect.width / 2}px`;
  chip.style.top = `${rect.bottom}px`;
}

function hideAskChip(): void {
  askChip?.remove();
  askChip = null;
}

/** Chạy ở frame trên cùng thôi — mỗi iframe một widget là vô nghĩa. */
if (window.top === window) void boot();
