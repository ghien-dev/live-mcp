import { test, expect, SITE_URL } from '../fixtures/stack.js';
import {
  askQuestion,
  openPanel,
  pierceHtml,
  readThread,
  threadKeyFor,
  waitForWidget,
} from '../fixtures/askWidget.js';

/**
 * Widget nói gì khi KHÔNG nối được server.
 *
 * Bài này sinh ra từ một lỗi bắt được lúc dùng thật, không phải từ suy luận:
 * chủ dự án hỏi một câu trong lúc server chưa chạy, và widget quay vòng vô tận
 * mà không nói gì. Ba tình huống khác hẳn nhau — "chưa ai trực", "không nối được
 * server", "widget đã chết" — hiện ra y hệt nhau, còn sau 90 giây thì widget
 * khuyên "mở claude.ai" đúng lúc lỗi nằm ở kết nối ngay trên máy.
 *
 * 128 unit test và 31 bài E2E lúc đó đều xanh. Không cái nào thấy, vì cái hỏng
 * không nằm ở logic mà nằm ở **chỗ trống giữa hai tầng**: `ws.ts` xếp message
 * vào outbox rồi im, còn widget không có đường nào để biết chuyện đó.
 */

const PAGE_URL = `${SITE_URL}/index.html`;
const THREAD_KEY = threadKeyFor(SITE_URL);

/** Gom text người dùng đọc được từ dòng trạng thái trong closed shadow root. */
async function statusText(page: import('@playwright/test').Page): Promise<string> {
  const rows = await pierceHtml(page, 'lmx-status');
  return rows.join('\n').replace(/<[^>]+>/g, ' ');
}

/**
 * Dọn hội thoại cũ trước mỗi bài.
 *
 * Widget lưu thread theo origin và thread sống qua cả các bài test, nên câu hỏi
 * của bài trước vẫn vẽ dòng trạng thái của nó trong bài sau — và `statusText()`
 * gom hết. Một bài đọc nhầm trạng thái của bài khác là kiểu đỏ ngẫu nhiên tệ
 * nhất: nó phụ thuộc thứ tự chạy, nên gỡ ra thì mất cả ngày.
 */
test.beforeEach(async ({ stack }) => {
  await stack.worker.evaluate((key: string) => chrome.storage.local.remove(key), THREAD_KEY);
});

/**
 * Đợi extension THẬT SỰ đang nối server trước khi bài test tự tay ngắt nó.
 *
 * Không có bước này thì bài test ngầm giả định trạng thái ban đầu là "đang nối"
 * — giả định đúng phần lớn thời gian, và sai đúng lúc bài trước vừa tắt/bật
 * server xong. Trang `index.html` là trang chuẩn Live MCP, nên nó chỉ hiện ra
 * trong `list_sites` khi extension đã nối được và đã khai báo xong.
 */
async function waitExtensionOnline(agent: {
  callTool: (n: string, a: Record<string, unknown>) => Promise<{ text: string }>;
}): Promise<void> {
  await expect
    .poll(async () => (await agent.callTool('livemcp_list_sites', {})).text, { timeout: 20_000 })
    .toContain('localhost');
}

test('server tắt: widget nói thẳng là chưa nối được, không giả vờ đang chờ Claude', async ({
  stack,
}) => {
  const { agent, worker, context } = stack;
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await waitForWidget(page);
  await waitExtensionOnline(agent);

  // Tắt server trong khi trình duyệt vẫn mở — đúng cảnh đã cắn ngoài đời.
  agent.stopServer();

  try {
    await openPanel(page, worker, PAGE_URL);
    await askQuestion(page, 'Server đang tắt thì tôi có được báo không?');

    // Câu hỏi vẫn phải nằm trong luồng: nó KHÔNG mất, chỉ là chưa đi được.
    await expect
      .poll(async () => (await readThread(worker, THREAD_KEY)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await expect
      .poll(() => statusText(page), { timeout: 15_000 })
      .toContain('Chưa nối được Local Server');

    const text = await statusText(page);

    // Khẳng định ÂM, và đây mới là phần đắt giá: câu cũ nói sai sự thật (nó
    // không chờ phiên Claude nào cả, nó chờ một WebSocket), còn lời khuyên "mở
    // claude.ai" thì đẩy người dùng đi sai chỗ. Cả hai không được xuất hiện.
    expect(text).not.toContain('Đang chờ một phiên Claude');
    expect(text).not.toContain('claude.ai');
  } finally {
    await agent.startServer();
    await page.close();
  }
});

test('server bật lại: widget tự bỏ cảnh báo, không cần người dùng làm gì', async ({ stack }) => {
  const { agent, worker, context } = stack;
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await waitForWidget(page);
  await waitExtensionOnline(agent);

  agent.stopServer();

  // `finally` chứ không phải dọn ở cuối thân bài: bài này CỐ Ý để server chết
  // giữa chừng, nên nếu một assertion đỏ thì server sẽ nằm chết luôn và mọi bài
  // sau đỏ theo vì lý do không liên quan — che mất lỗi thật.
  try {
    await openPanel(page, worker, PAGE_URL);
    await askQuestion(page, 'Bật lại rồi thì widget có tự biết không?');
    await expect
      .poll(() => statusText(page), { timeout: 15_000 })
      .toContain('Chưa nối được Local Server');

    await agent.startServer();

    // Service worker vẫn còn sống ở đây, nên đường hồi phục được kiểm là
    // `setTimeout` backoff của `ServerLink` (trần 10s) + `onOpen` ->
    // broadcastLink. Ca "SW đã bị Chrome giết" thì alarm mới là thứ cứu, và nó
    // KHÔNG được kiểm ở đây — xem ghi chú cuối file.
    await expect
      .poll(() => statusText(page), { timeout: 30_000 })
      .not.toContain('Chưa nối được Local Server');
  } finally {
    if (!agent.alive) await agent.startServer();
    await page.close();
  }
});

test('alarm hồi phục được khai đúng tên và đúng nhịp', async ({ stack }) => {
  const alarm = await stack.worker.evaluate(() => chrome.alarms.get('livemcp-reconnect'));

  // Bài kiểm rẻ tiền nhưng bắt đúng ba kiểu hỏng thầm lặng đã suýt xảy ra: quên
  // khai quyền `alarms` trong manifest, gõ sai tên alarm, và đặt nhịp khác 1
  // phút. Cả ba đều làm bản vá thành vô hiệu mà không có dấu hiệu nào.
  expect(alarm, 'không có alarm nào tên livemcp-reconnect — bản vá tự nối lại đã mất tác dụng').
    toBeTruthy();
  expect(alarm?.periodInMinutes).toBe(1);
});

/**
 * CHƯA kiểm được, ghi ra thay vì để người sau tưởng đã phủ:
 *
 * Đường hồi phục **sau khi Chrome giết service worker** — tức là chính kịch bản
 * mà alarm sinh ra để cứu. Muốn kiểm thật thì phải ép Chrome giết SW đúng lúc,
 * việc mà Playwright không có API nào làm được một cách tin cậy; còn tự dừng SW
 * bằng CDP thì lại là một đường chết khác với đường Chrome thật đi, nên bài test
 * sẽ kiểm chính bản giả lập chứ không kiểm sản phẩm.
 *
 * Phần kiểm được đã kiểm: alarm tồn tại, đúng tên, đúng nhịp (ba kiểu hỏng thầm
 * lặng hay gặp nhất). Phần còn lại chỉ chạy 24/24 ngoài đời mới trả lời được.
 */
