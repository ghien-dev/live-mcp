import {
  ACTION_SLACK_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  type ActionResultMsg,
  type ServerToExtensionMsg,
} from '@livemcp/protocol';
import type {
  ActionStep,
  AfterActionReply,
  AskContentToSw,
  AskSwToContent,
  ContentToSw,
  PageInfo,
  PlanReply,
  SwToContent,
} from '../messages.js';
import { click, detach, ensureAttached, insertText, pressKey, selectAll } from './cdp.js';
import { ServerLink, TOKEN_STORAGE_KEY } from './ws.js';
import type { PopupToSw, PopupStatus } from '../messages.js';

/**
 * Service Worker — người điều phối.
 *
 * Nó nói WebSocket với server, thi hành hành động qua CDP, quản lý tab; nó KHÔNG
 * parse schema và KHÔNG biết gì về attribute `livemcp-*` (§1, bảng phân vai).
 */

/** Tab đang có site chuẩn Live MCP. Mất khi SW bị kill → xin resync lúc dậy lại. */
const sites = new Map<number, PageInfo>();

const link = new ServerLink(handleServerMessage, () => {
  // Vừa (re)connect: khai lại toàn bộ site đang mở để server dựng lại tool list.
  void resyncAllTabs();
});
link.connect();

// ---------------------------------------------------------------------------
// Content script → SW
// ---------------------------------------------------------------------------

// Popup: dán token pairing (M1.5). Popup không có `sender.tab` nên phải xử lý
// TRƯỚC lá chắn tabId bên dưới.
chrome.runtime.onMessage.addListener((msg: PopupToSw, sender, sendResponse) => {
  if (sender.tab || !msg?.type?.startsWith('popup_')) return;

  if (msg.type === 'popup_get_status') {
    void chrome.storage.local.get(TOKEN_STORAGE_KEY).then((stored) => {
      const status: PopupStatus = {
        connected: link.connected,
        hasToken: Boolean(stored[TOKEN_STORAGE_KEY]),
        siteCount: sites.size,
      };
      sendResponse(status);
    });
    return true; // giữ kênh mở cho phản hồi bất đồng bộ
  }

  if (msg.type === 'popup_set_token') {
    void chrome.storage.local
      .set({ [TOKEN_STORAGE_KEY]: msg.token.trim() })
      .then(() => {
        link.retryNow();
        sendResponse({ ok: true });
      });
    return true;
  }
  return;
});

/**
 * Kênh Ask — chỉ chuyển tiếp, không giữ trạng thái.
 *
 * SW cố tình không nhớ câu hỏi nào đang chờ: MV3 giết service worker bất cứ lúc
 * nào, nên mọi thứ nó nhớ đều là thứ sẽ mất. Nguồn sự thật nằm ở server
 * (`AskStore`), bản sao để hiển thị nằm ở `chrome.storage.local` của widget.
 */
chrome.runtime.onMessage.addListener((msg: AskContentToSw, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || !msg?.type?.startsWith('cs_ask_')) return;

  switch (msg.type) {
    case 'cs_ask_send':
      link.send({
        type: 'ask_question',
        tabId,
        questionId: msg.questionId,
        url: msg.url,
        title: msg.title,
        text: msg.text,
        selection: msg.selection,
        ts: Date.now(),
      });
      break;
    case 'cs_ask_hello':
      link.send({ type: 'ask_hello', tabId, url: msg.url });
      break;
    case 'cs_ask_delivered':
      link.send({ type: 'ask_delivered', tabId, questionId: msg.questionId });
      break;
    case 'cs_ask_cancel':
      link.send({ type: 'ask_cancel', tabId, questionId: msg.questionId });
      break;
  }
});

chrome.runtime.onMessage.addListener((msg: ContentToSw, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  if (msg.type === 'cs_site_ready') {
    sites.set(tabId, msg.site);
    link.send({
      type: 'site_announce',
      tabId,
      pageId: msg.site.pageId,
      url: msg.site.url,
      app: msg.site.app,
      description: msg.site.description,
      specVersion: msg.site.specVersion,
    });
    link.send({
      type: 'declarative_snapshot',
      tabId,
      pageId: msg.site.pageId,
      seq: msg.seq,
      tools: msg.tools,
      resources: msg.resources,
    });
    return;
  }

  if (msg.type === 'cs_declarative_delta') {
    // SW chỉ chuyển tiếp: nó không biết gì về attribute `livemcp-*`, và việc
    // quyết định "có đáng báo không" đã xong ở content script (§1 bảng phân vai).
    link.send({
      type: 'declarative_delta',
      tabId,
      pageId: msg.pageId,
      seq: msg.seq,
      added: msg.added,
      removed: msg.removed,
      changed: msg.changed,
    });
    return;
  }

  if (msg.type === 'cs_site_gone') {
    forgetTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

function forgetTab(tabId: number): void {
  if (!sites.delete(tabId)) return;
  link.send({ type: 'site_gone', tabId });
  void detach(tabId);
}

/** SW vừa hồi sinh hoặc vừa nối lại server → hỏi mọi tab xem trang nào đạt chuẩn. */
async function resyncAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    await sendToTab(tab.id, { type: 'sw_request_resync' }).catch(() => {
      // Tab không có content script (trang ngoài chuẩn hoặc chưa load) — bỏ qua.
    });
  }
}

function sendToTab<T>(tabId: number, msg: SwToContent): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Server → SW
// ---------------------------------------------------------------------------

function handleServerMessage(msg: ServerToExtensionMsg): void {
  switch (msg.type) {
    case 'ping':
      link.send({ type: 'pong' });
      break;
    case 'execute_action':
      void executeAction(msg.tabId, msg.actionId, msg.tool, msg.args, msg.waitTimeoutMs);
      break;
    case 'ask_claimed':
      void toAsk(msg.tabId, { type: 'sw_ask_claimed', questionId: msg.questionId });
      break;
    case 'ask_released':
      void toAsk(msg.tabId, { type: 'sw_ask_released', questionId: msg.questionId });
      break;
    case 'ask_followup':
      void toAsk(msg.tabId, {
        type: 'sw_ask_followup',
        questionId: msg.questionId,
        text: msg.text,
      });
      break;
    case 'ask_answer':
      void deliverAnswer(msg.tabId, msg.questionId, msg.markdown);
      break;
    case 'read_resource':
      // TODO(M3): đọc resource qua content script.
      link.send({
        type: 'action_result',
        tabId: msg.tabId,
        actionId: msg.actionId,
        status: 'error',
        error: 'Đọc resource chưa được hiện thực (M3).',
      });
      break;
  }
}

/**
 * Đẩy một message của kênh Ask xuống widget.
 *
 * Nuốt lỗi có chủ ý: tab có thể vừa đóng, vừa điều hướng, hoặc đang ở trang mà
 * content script không chạy được (chrome://, Web Store). Không tab nào trong số
 * đó là sự cố cần báo — và ném lỗi ở đây sẽ giết cả vòng xử lý message.
 */
function toAsk(tabId: number, msg: AskSwToContent): Promise<void> {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

/**
 * Câu trả lời về tới nơi. Nếu tab đang ẩn thì phải kêu — người dùng gần như
 * chắc chắn đã chuyển đi làm việc khác trong lúc chờ, và một câu trả lời nằm im
 * trong tab nền thì coi như chưa từng tới.
 */
async function deliverAnswer(tabId: number, questionId: string, markdown: string): Promise<void> {
  await toAsk(tabId, { type: 'sw_ask_answer', questionId, markdown });

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.active) return;

  await chrome.action.setBadgeText({ tabId, text: '1' }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' }).catch(() => {});
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon128.png'),
    title: 'Trợ lý Live MCP đã trả lời',
    message: markdown.replace(/\s+/g, ' ').slice(0, 180),
  });
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-ask') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) await toAsk(tab.id, { type: 'sw_ask_open' });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

/** Nhịp nghỉ giữa hai bước thao tác — vừa giống người, vừa cho trang kịp phản ứng. */
const STEP_GAP_MS = 30;

/**
 * Số vòng tối đa. Mỗi ô của form là một vòng riêng (content script đo toạ độ
 * ngay trước khi dùng, không đo cả mẻ), cộng 1 vòng dò thứ tự ô ngày, 1 vòng
 * bấm submit, và tối đa 3 vòng gõ lại ngày theo thứ tự segment khác.
 */
const MAX_ROUNDS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Server bỏ cuộc sau `waitTimeout + 5000ms`. SW phải bỏ cuộc SỚM HƠN thế, nếu
 * không agent chỉ nhận được "extension không phản hồi" — một câu chẳng nói lên
 * điều gì. Chừa lại khoảng này để lời báo lỗi kịp về tới nơi.
 */
const SW_DEADLINE_MARGIN_MS = 1_500;

/**
 * Chạy một giai đoạn với hạn chót chung. Hết hạn thì nói rõ **giai đoạn nào**
 * treo — im lặng là kiểu hỏng khó chữa nhất của một chuỗi 5 lớp.
 */
async function withDeadline<T>(
  phase: string,
  work: Promise<T>,
  deadline: number,
  timings: string[],
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(
      `Hết thời gian trước khi kịp vào giai đoạn "${phase}". Đã qua: ${timings.join(', ')}.`,
    );
  }
  const startedAt = Date.now();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Treo ở giai đoạn "${phase}": quá ${remaining}ms chưa xong. ` +
                  `Đã qua: ${timings.join(', ')}.`,
              ),
            ),
          remaining,
        ),
      ),
    ]);
  } finally {
    timings.push(`${phase} ${Date.now() - startedAt}ms`);
  }
}

/** Thi hành một plan do content script soạn. SW không biết plan này nghĩa là gì. */
async function runSteps(tabId: number, steps: ActionStep[]): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case 'click':
        await click(tabId, step.x, step.y, step.button ?? 'left', step.clickCount ?? 1);
        break;
      case 'insertText':
        await insertText(tabId, step.text);
        break;
      case 'keys':
        for (const key of step.keys) {
          await pressKey(tabId, key);
          await sleep(STEP_GAP_MS);
        }
        break;
      case 'selectAll':
        await selectAll(tabId);
        break;
      case 'wait':
        await sleep(step.ms);
        break;
    }
    await sleep(STEP_GAP_MS);
  }
}

/**
 * Luồng thi hành một tool (docs/livemcp-architecture.md §4):
 * content script lập plan → SW dispatch CDP → content script xác minh + đọc kết quả.
 * Nếu content script báo `retry` (vd ô ngày nhận sai thứ tự dd/mm theo locale),
 * thi hành plan sửa rồi hỏi lại — tối đa `MAX_ROUNDS` vòng.
 */
async function executeAction(
  tabId: number,
  actionId: string,
  tool: string,
  args: Record<string, unknown>,
  waitTimeoutMs: number,
): Promise<void> {
  const started = Date.now();
  const reply = (result: Omit<ActionResultMsg, 'type' | 'tabId' | 'actionId'>) =>
    link.send({
      type: 'action_result',
      tabId,
      actionId,
      durationMs: Date.now() - started,
      ...result,
    } as ActionResultMsg);

  try {
    if (!sites.has(tabId)) {
      reply({ status: 'error', error: `Tab ${tabId} không còn mở trang chuẩn Live MCP.` });
      return;
    }

    // `?? DEFAULT` để còn chạy được với server bản cũ chưa gửi trường này.
    const budget = waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = started + budget + ACTION_SLACK_MS - SW_DEADLINE_MARGIN_MS;
    const timings: string[] = [];

    const plan = await withDeadline(
      'lập kế hoạch (content script)',
      sendToTab<PlanReply>(tabId, { type: 'sw_plan_action', tool, args }),
      deadline,
      timings,
    );
    if (!plan.ok || !plan.steps) {
      reply({ status: 'error', error: plan.error ?? 'Không lập được kế hoạch thao tác.' });
      return;
    }

    // TODO(M5): bảo content script cho ong bay tới từng toạ độ trước mỗi bước.

    await withDeadline('gắn debugger (CDP)', ensureAttached(tabId), deadline, timings);

    let steps = plan.steps;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      await withDeadline(
        `thi hành ${steps.length} bước qua CDP`,
        runSteps(tabId, steps),
        deadline,
        timings,
      );

      const after = await withDeadline(
        'đọc kết quả (content script)',
        sendToTab<AfterActionReply>(tabId, { type: 'sw_after_action', tool }),
        deadline,
        timings,
      );
      if (after.status !== 'retry') {
        console.info(`[Live MCP] ${tool}: ${timings.join(' · ')}`);
        reply({
          status: after.status,
          resultText: after.resultText,
          stateSnapshot: after.stateSnapshot,
          newTools: after.newTools,
          goneTools: after.goneTools,
          error: after.error,
        });
        return;
      }
      steps = after.steps ?? [];
    }

    reply({
      status: 'error',
      error: `Đã thử ${MAX_ROUNDS} lần nhưng giá trị vẫn không vào đúng ô.`,
    });
  } catch (err) {
    reply({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
