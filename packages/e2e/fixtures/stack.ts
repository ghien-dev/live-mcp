import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpAgent } from './mcpClient.js';
import { E2E_SITE_PORT, E2E_WS_PORT, EXT_DIST_DIR } from './ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const EXT_PATH = join(REPO, 'packages', 'extension', EXT_DIST_DIR as string);
const SERVER_ENTRY = join(REPO, 'packages', 'server', 'dist', 'index.js');

export const SITE_URL = `http://localhost:${E2E_SITE_PORT}`;

/**
 * Bộ đồ nghề cho mọi bài E2E.
 *
 * Phân vai cố ý và không được lẫn:
 * - **Playwright**: khởi động Chrome có extension, phục vụ trang, đọc DOM để
 *   assert. Không click, không gõ, không dispatch một sự kiện `Input` nào.
 * - **McpAgent**: ra lệnh, qua đúng đường sản phẩm (MCP → server → WS →
 *   extension → CDP).
 *
 * Nếu để Playwright thao tác hộ thì bài test không còn kiểm sản phẩm nữa — nó
 * kiểm Playwright. Với vai thụ động, Playwright cũng không giẫm chân
 * `chrome.debugger` của extension.
 */
export interface Stack {
  context: BrowserContext;
  agent: McpAgent;
  /** Service worker của extension — để đọc trạng thái và kiểm vòng đời MV3. */
  worker: Worker;
  /** Mở lại SW nếu Chrome vừa cho nó ngủ (ca vòng đời MV3). */
  reviveWorker(): Promise<Worker>;
}

/**
 * `uiLocale` chứ không phải `locale`: đây là **ngôn ngữ giao diện trình duyệt**
 * (`--lang`), thứ quyết định thứ tự segment của `<input type="date">` — khác
 * hẳn `navigator.language` mà fixture `locale` sẵn có của Playwright điều khiển.
 * Chính chỗ lẫn hai khái niệm này từng làm ô ngày điền sai.
 */
/** Option riêng của lưới, khai ra để `playwright.config.ts` cũng được kiểm kiểu. */
export interface UiLocaleOptions {
  uiLocale: string;
}

export const test = base.extend<
  { booking: Page; edgeCases: Page },
  UiLocaleOptions & { stack: Stack }
>({
  uiLocale: ['en-US', { option: true, scope: 'worker' }],

  /**
   * Stack dùng chung cho cả worker, không dựng lại mỗi bài.
   *
   * Khởi động Chrome + server mất ~4s; nhân với số bài thì lưới chạm ngưỡng
   * "chậm tới mức không ai chạy" — mà lưới không ai chạy thì bằng không. Tách
   * phần đắt ra worker scope, phần rẻ (mở tab) để test scope.
   */
  stack: [
    async ({ uiLocale }, use) => {
      const agent = new McpAgent(SERVER_ENTRY, E2E_WS_PORT as number);
      await agent.initialize();

      const profile = await mkdtemp(join(tmpdir(), 'livemcp-e2e-'));
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        args: [
          `--disable-extensions-except=${EXT_PATH}`,
          `--load-extension=${EXT_PATH}`,
          // Locale giao diện trình duyệt — thứ quyết định thứ tự segment ô ngày.
          // Đây là cách ma trận locale "không test được" trở nên test được.
          `--lang=${uiLocale}`,
        ],
        // headless mới (Chrome 112+) chạy được extension, nên lưới lên CI được.
        headless: !process.env.E2E_HEADED,
      });

      const waitWorker = async (): Promise<Worker> =>
        context.serviceWorkers()[0] ??
        (await context.waitForEvent('serviceworker', { timeout: 15_000 }));

      const worker = await waitWorker();

      await use({
        context,
        agent,
        worker,
        reviveWorker: waitWorker,
      });

      await context.close();
      await agent.close();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
    { scope: 'worker' },
  ],

  /**
   * Một tab booking.html sạch cho mỗi bài, đã được extension phát hiện.
   *
   * Đóng tab sau mỗi bài là bắt buộc: mỗi tab mở là một namespace tool, để tồn
   * đọng thì các bài sau thấy tool trùng tên và kết quả phụ thuộc thứ tự chạy.
   */
  booking: async ({ stack }, use, testInfo) => {
    await usePage(stack, 'booking.html', BOOK_TABLE, use, testInfo);
  },

  edgeCases: async ({ stack }, use, testInfo) => {
    await usePage(stack, 'edge-cases.html', CLICK_BURIED, use, testInfo);
  },
});

export const BOOK_TABLE = 'bookmytable__book_table';
export const CLICK_BURIED = 'edgecases__click_buried';
export const CLICK_REACHABLE = 'edgecases__click_reachable';
export const PICK_CITY = 'edgecases__pick_city';

/**
 * Mở một trang, đợi extension phát hiện, rồi **đóng lại sau bài test**.
 *
 * Đóng tab là bắt buộc chứ không phải lịch sự: mỗi tab mở là một namespace tool
 * sống. Để tab tồn đọng thì bài sau gọi cùng tên tool có thể bị định tuyến sang
 * tab cũ — hành động rơi vào một trang, còn assertion đọc một trang khác, và
 * bài test đỏ vì lý do hoàn toàn không liên quan tới sản phẩm.
 */
async function usePage(
  stack: Stack,
  path: string,
  toolName: string,
  use: (page: Page) => Promise<void>,
  testInfo: { status?: string; expectedStatus?: string; attach: (n: string, o: { body: string }) => Promise<void> },
): Promise<void> {
  const page = await stack.context.newPage();
  await page.goto(`${SITE_URL}/${path}`);
  await stack.agent.waitForTool(toolName);

  await use(page);

  // Khi test đỏ, log của server là manh mối đắt nhất — đính vào report.
  if (testInfo.status !== testInfo.expectedStatus && stack.agent.serverLog.length) {
    await testInfo.attach('server.log', { body: stack.agent.serverLog.slice(-60).join('\n') });
  }

  await page.close();
  await stack.agent.waitForToolGone(toolName).catch(() => {
    /* grace period của server có thể giữ tool lâu hơn — không phải lỗi của bài này */
  });
}

export { expect } from '@playwright/test';

/**
 * Sự kiện mà trang demo ghi lại được (booking.js).
 *
 * `isTrusted` là thuộc tính readonly do UA gán — trang không giả mạo được, nên
 * listener capture-phase đọc ra giá trị thật. Đây là oracle cho khẳng định
 * trung tâm của cả dự án.
 */
export interface RecordedEvent {
  type: string;
  isTrusted: boolean;
  target: string;
}

/** Đọc máy ghi sự kiện của trang demo. */
export function recordedEvents(page: Page): Promise<RecordedEvent[]> {
  return page.evaluate(
    () => (window as unknown as { __livemcpEvents: RecordedEvent[] }).__livemcpEvents,
  );
}

/** Chỉ những sự kiện thể hiện một tương tác thật của người dùng. */
export const INTERACTION_EVENTS = new Set([
  'focusin',
  'keydown',
  'click',
  'input',
  'change',
  'submit',
]);
