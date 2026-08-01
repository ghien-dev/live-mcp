import type { ActionResultMsg, ServerToExtensionMsg } from '@livemcp/protocol';
import type {
  AfterActionReply,
  ContentToSw,
  PageInfo,
  ResolveTargetReply,
  SwToContent,
} from '../messages.js';
import { click, detach, ensureAttached } from './cdp.js';
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

/**
 * Luồng thi hành một tool (docs/livemcp-architecture.md §4):
 * resolve toạ độ (content script) → dispatch CDP → đọc kết quả (content script).
 */
async function executeAction(
  tabId: number,
  actionId: string,
  tool: string,
  _args: Record<string, unknown>,
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

    const target = await sendToTab<ResolveTargetReply>(tabId, {
      type: 'sw_resolve_target',
      tool,
      args: _args,
    });
    if (!target.ok || target.x === undefined || target.y === undefined) {
      reply({ status: 'error', error: target.error ?? 'Không xác định được vị trí phần tử.' });
      return;
    }

    // TODO(M5): bảo content script cho ong bay tới (x, y) và đợi ong tới nơi.

    await ensureAttached(tabId);
    await click(tabId, target.x, target.y, 'left');

    const after = await sendToTab<AfterActionReply>(tabId, { type: 'sw_after_action', tool });
    reply({
      status: after.status,
      resultText: after.resultText,
      stateSnapshot: after.stateSnapshot,
      error: after.error,
    });
  } catch (err) {
    reply({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
