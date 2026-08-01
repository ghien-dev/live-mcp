import { DEFAULT_WAIT_TIMEOUT_MS, MAX_RESULT_CHARS, type ToolDecl } from '@livemcp/protocol';
import type { AfterActionReply, ContentToSw, PlanReply, SwToContent } from '../messages.js';
import { readPageInfo, scan, type ScanResult } from './scanner.js';
import {
  buildPlan,
  DATE_LIKE,
  PlanError,
  retryDatePlan,
  verify,
  type ExpectedField,
} from './plan.js';

/**
 * Content script — "con mắt và bàn tay chỉ đường" của Live MCP trên trang.
 *
 * Nó KHÔNG tự thi hành click/type thật (việc đó của CDP trong service worker);
 * nhiệm vụ của nó là quét declarative, lập kế hoạch thao tác, và đọc kết quả.
 */

const page = readPageInfo();
if (page) {
  let current: ScanResult = scan();
  let seq = 0;

  /** Kỳ vọng của hành động đang chạy, dùng để xác minh sau khi thi hành xong. */
  let pending: { tool: string; expected: ExpectedField[]; retried: boolean } | null = null;

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
  console.info(`[Live MCP] "${page.app}" — phát hiện ${current.tools.length} tool declarative.`);

  window.addEventListener('pagehide', () => send({ type: 'cs_site_gone' }), { once: true });

  // TODO(M2): MutationObserver → declarative_delta + cơ chế đợi livemcp-wait.

  chrome.runtime.onMessage.addListener((msg: SwToContent, _sender, sendResponse) => {
    switch (msg.type) {
      case 'sw_request_resync':
        announce();
        sendResponse({ ok: true });
        return false;

      case 'sw_plan_action':
        planAction(msg.tool, msg.args).then(sendResponse);
        return true; // giữ kênh mở cho phản hồi bất đồng bộ

      case 'sw_after_action':
        afterAction(msg.tool).then(sendResponse);
        return true;

      default:
        return false;
    }
  });

  /** Tìm phần tử của tool trong registry; quét lại một lần nếu registry đã cũ. */
  function findElement(tool: string): HTMLElement | null {
    let candidates = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
    if (candidates.length === 0) {
      current = scan();
      candidates = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
    }
    // TODO(M3): chọn phần tử theo cặp livemcp-arg thay vì luôn lấy cái đầu.
    return candidates[0] ?? null;
  }

  async function planAction(tool: string, args: Record<string, unknown>): Promise<PlanReply> {
    const decl = current.tools.find((t) => t.name === tool);
    const el = findElement(tool);
    if (!decl || !el) {
      return { ok: false, error: `Không tìm thấy phần tử nào mang tool "${tool}" trên trang.` };
    }

    try {
      const plan = await buildPlan(el, decl, args);
      pending = { tool, expected: plan.expected, retried: false };
      return { ok: true, steps: plan.steps };
    } catch (err) {
      pending = null;
      return {
        ok: false,
        error: err instanceof PlanError ? err.message : String(err),
      };
    }
  }

  /**
   * Sau khi CDP dispatch xong: xác minh giá trị đã vào đúng ô, rồi đọc
   * `livemcp-result`.
   *
   * M0/M1 dùng độ trễ cố định; M2 sẽ thay bằng waiter thật (livemcp-wait /
   * livemcp-state / wait-gone) theo thứ tự ưu tiên ở spec §7.2.
   */
  async function afterAction(tool: string): Promise<AfterActionReply> {
    const decl = current.tools.find((t) => t.name === tool);
    const timedOut = decl ? await waitForSettle(decl) : (await sleep(200), false);

    // --- xác minh: ô ngày rất dễ nhận sai thứ tự dd/mm tuỳ locale ------------
    if (pending?.tool === tool && !pending.retried) {
      const wrong = verify(pending.expected);
      const badDate = wrong.find((f) => DATE_LIKE.has(f.htmlType));
      if (badDate) {
        pending.retried = true;
        console.info('[Live MCP] ô ngày nhận sai thứ tự segment — gõ lại với thứ tự đảo.');
        return { status: 'retry', steps: await retryDatePlan(badDate) };
      }
    }

    const mismatched = pending?.tool === tool ? verify(pending.expected) : [];
    pending = null;

    const lines: string[] = [];

    if (decl?.resultSelector) {
      const target = document.querySelector(decl.resultSelector);
      if (target) {
        lines.push(cleanText((target as HTMLElement).innerText ?? target.textContent ?? ''));
      } else {
        lines.push(`(không tìm thấy vùng kết quả "${decl.resultSelector}")`);
      }
    }

    // Báo thật thà: giá trị nào không vào đúng ô, thay vì im lặng coi như xong.
    if (mismatched.length > 0) {
      lines.push(
        `⚠ Các ô sau không nhận đúng giá trị: ` +
          mismatched
            .map(
              (f) =>
                `${f.name} (yêu cầu "${String(f.value)}", thực tế "${
                  (f.el as HTMLInputElement).value ?? ''
                }")`,
            )
            .join('; '),
      );
    }

    const stateEl = decl?.resultSelector ? document.querySelector(decl.resultSelector) : null;
    return {
      status: timedOut ? 'timeout' : 'ok',
      resultText: lines.length ? lines.join('\n') : undefined,
      stateSnapshot: stateEl?.getAttribute('livemcp-state') ?? undefined,
      error: timedOut
        ? `Quá ${decl?.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS}ms mà điều kiện đợi chưa thoả.`
        : undefined,
    };
  }

  /**
   * Đợi trang ổn định sau hành động. Bản tối giản của spec §7.2 — polling
   * `livemcp-wait` / `livemcp-wait-gone`; M2 sẽ thay bằng MutationObserver để
   * bắt cả tool mới sinh ra và xử lý ưu tiên `livemcp-state`.
   *
   * @returns true nếu hết thời gian mà điều kiện chưa thoả.
   */
  async function waitForSettle(decl: ToolDecl): Promise<boolean> {
    if (!decl.wait && !decl.waitGone) {
      await sleep(200); // không khai báo wait → đợi DOM lắng một nhịp ngắn
      return false;
    }

    const deadline = Date.now() + (decl.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (decl.wait && document.querySelector(decl.wait)) return false;
      if (decl.waitGone && !document.querySelector(decl.waitGone)) return false;
      await sleep(50);
    }
    return true;
  }
}

/** Chuẩn hoá whitespace + cắt trần để không phá context window của agent (§5.4). */
function cleanText(raw: string): string {
  const text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(đã cắt bớt)`
    : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
