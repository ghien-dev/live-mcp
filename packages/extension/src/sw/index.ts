import type { ActionResultMsg, ServerToExtensionMsg } from '@livemcp/protocol';
import type {
  ActionStep,
  AfterActionReply,
  ContentToSw,
  PageInfo,
  PlanReply,
  SwToContent,
} from '../messages.js';
import { click, detach, ensureAttached, insertText, pressKey, selectAll } from './cdp.js';
import { ServerLink } from './ws.js';

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

chrome.runtime.onMessage.addListener((msg: ContentToSw, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  if (msg.type === 'cs_site_ready') {
    sites.set(tabId, msg.site);
    link.send({
      type: 'site_announce',
      tabId,
      url: msg.site.url,
      app: msg.site.app,
      description: msg.site.description,
      specVersion: msg.site.specVersion,
    });
    link.send({
      type: 'declarative_snapshot',
      tabId,
      seq: msg.seq,
      tools: msg.tools,
      resources: msg.resources,
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
      void executeAction(msg.tabId, msg.actionId, msg.tool, msg.args);
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

/** Nhịp nghỉ giữa hai bước thao tác — vừa giống người, vừa cho trang kịp phản ứng. */
const STEP_GAP_MS = 30;

/** Số vòng sửa tối đa khi content script báo giá trị chưa vào đúng ô. */
const MAX_ROUNDS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const plan = await sendToTab<PlanReply>(tabId, { type: 'sw_plan_action', tool, args });
    if (!plan.ok || !plan.steps) {
      reply({ status: 'error', error: plan.error ?? 'Không lập được kế hoạch thao tác.' });
      return;
    }

    // TODO(M5): bảo content script cho ong bay tới từng toạ độ trước mỗi bước.

    await ensureAttached(tabId);

    let steps = plan.steps;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      await runSteps(tabId, steps);

      const after = await sendToTab<AfterActionReply>(tabId, { type: 'sw_after_action', tool });
      if (after.status !== 'retry') {
        reply({
          status: after.status,
          resultText: after.resultText,
          stateSnapshot: after.stateSnapshot,
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
