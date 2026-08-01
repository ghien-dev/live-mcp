import { MAX_RESULT_CHARS } from '@livemcp/protocol';
import type {
  AfterActionReply,
  ContentToSw,
  ResolveTargetReply,
  SwToContent,
} from '../messages.js';
import { readPageInfo, scan, type ScanResult } from './scanner.js';

/**
 * Content script — "con mắt và bàn tay chỉ đường" của Live MCP trên trang.
 *
 * Nó KHÔNG tự thi hành click/type thật (việc đó của CDP trong service worker);
 * nhiệm vụ của nó là quét declarative, tính toạ độ, và đọc kết quả.
 */

const page = readPageInfo();
if (page) {
  let current: ScanResult = scan();
  let seq = 0;

  const send = (msg: ContentToSw) => {
    chrome.runtime.sendMessage(msg).catch(() => {
      // SW đang ngủ hoặc extension vừa reload — không sao, SW sẽ xin resync.
    });
  };

  const announce = () => {
    current = scan();
    seq += 1;
    send({
      type: 'cs_site_ready',
      site: {
        url: location.href,
        app: page.app,
        description: page.description,
        specVersion: page.specVersion,
      },
      seq,
      tools: current.tools,
      resources: current.resources,
    });
  };

  announce();
  console.info(
    `[Live MCP] "${page.app}" — phát hiện ${current.tools.length} tool declarative.`,
  );

  window.addEventListener('pagehide', () => send({ type: 'cs_site_gone' }), { once: true });

  // TODO(M2): MutationObserver → declarative_delta + cơ chế đợi livemcp-wait.

  chrome.runtime.onMessage.addListener((msg: SwToContent, _sender, sendResponse) => {
    switch (msg.type) {
      case 'sw_request_resync':
        announce();
        sendResponse({ ok: true });
        return false;

      case 'sw_resolve_target':
        resolveTarget(msg.tool).then(sendResponse);
        return true; // giữ kênh mở cho phản hồi bất đồng bộ

      case 'sw_after_action':
        afterAction(msg.tool).then(sendResponse);
        return true;

      default:
        return false;
    }
  });

  /**
   * Tìm phần tử của tool → cuộn vào tầm nhìn → trả toạ độ tâm.
   * Toạ độ là ngôn ngữ chung của hành động (§2.2): nhờ vậy click DOM và click
   * canvas dùng chung một code path.
   */
  async function resolveTarget(tool: string): Promise<ResolveTargetReply> {
    const candidates = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
    if (candidates.length === 0) {
      // Registry có thể đã cũ (DOM đổi mà chưa rescan) — quét lại một lần rồi thử tiếp.
      current = scan();
      const retry = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
      if (retry.length === 0) {
        return { ok: false, error: `Không tìm thấy phần tử nào mang livemcp-name="${tool}".` };
      }
      candidates.push(...retry);
    }

    // TODO(M3): chọn phần tử theo cặp livemcp-arg thay vì luôn lấy cái đầu.
    const el = candidates[0]!;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await nextFrame();

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { ok: false, error: `Phần tử "${tool}" có kích thước 0 — không click được.` };
    }

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const topmost = document.elementFromPoint(x, y);
    if (topmost && topmost !== el && !el.contains(topmost) && !topmost.contains(el)) {
      console.warn(`[Live MCP] điểm click của "${tool}" đang bị phần tử khác che:`, topmost);
    }

    return { ok: true, x, y };
  }

  /**
   * Sau khi CDP dispatch xong: đợi trang ổn định rồi đọc `livemcp-result`.
   * M0 dùng độ trễ cố định; M2 sẽ thay bằng waiter thật (livemcp-wait /
   * livemcp-state / wait-gone) theo thứ tự ưu tiên ở spec §7.2.
   */
  async function afterAction(tool: string): Promise<AfterActionReply> {
    const decl = current.tools.find((t) => t.name === tool);
    await sleep(150);

    if (!decl?.resultSelector) {
      return { status: 'ok' };
    }

    const target = document.querySelector(decl.resultSelector);
    if (!target) {
      return {
        status: 'ok',
        resultText: `(không tìm thấy vùng kết quả "${decl.resultSelector}")`,
      };
    }

    return {
      status: 'ok',
      resultText: cleanText((target as HTMLElement).innerText ?? target.textContent ?? ''),
      stateSnapshot: target.getAttribute('livemcp-state') ?? undefined,
    };
  }
}

/** Chuẩn hoá whitespace + cắt trần để không phá context window của agent (§5.4). */
function cleanText(raw: string): string {
  const text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(đã cắt bớt)`
    : text;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
