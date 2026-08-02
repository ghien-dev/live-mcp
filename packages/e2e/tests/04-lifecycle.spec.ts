import { BOOK_TABLE, expect, SITE_URL, test } from '../fixtures/stack.js';

/**
 * Ca 4 — vòng đời và khả năng hồi phục.
 *
 * MV3 service worker bị Chrome tắt sau ~30s rảnh, và server thì có thể bị khởi
 * động lại bất cứ lúc nào (người dùng restart Claude Code). Kiến trúc chốt là
 * **stateless-recoverable**: mọi bên phải tự dựng lại trạng thái từ đầu, không
 * bên nào được giả định bên kia còn nhớ gì.
 *
 * Đây là lớp lỗi chỉ E2E thấy được, và là lớp sẽ cắn người dùng thật đầu tiên —
 * vì với người dùng thật, phiên làm việc kéo dài hàng chục phút chứ không phải
 * vài giây như trong test.
 */

test('server khởi động lại → extension tự nối lại và khai báo lại tool', async ({
  stack,
  booking,
}) => {
  // Trạng thái ban đầu: hoạt động bình thường.
  const before = await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-12-01' });
  expect(before.isError, before.text).toBe(false);

  // Server chết và dựng lại. Chrome vẫn mở nguyên, extension không hề hay biết
  // cho tới khi WS đứt.
  await stack.agent.restart();

  // Không được đụng gì vào trang: extension phải tự nối lại và tự khai báo lại.
  // Nếu bước này treo thì hoặc backoff reconnect hỏng, hoặc resync không chạy.
  await stack.agent.waitForTool(BOOK_TABLE, 30_000);

  // Và quan trọng nhất: sau khi hồi phục thì vẫn *làm việc được*, không chỉ
  // "hiện ra trong danh sách".
  const after = await stack.agent.callTool(BOOK_TABLE, { guests: 5, date: '2026-12-02' });
  expect(after.isError, after.text).toBe(false);
  await expect(booking.locator('#guests')).toHaveValue('5');
  await expect(booking.locator('#date')).toHaveValue('2026-12-02');
});

test('đóng tab → tool biến mất khỏi danh sách của agent', async ({ stack }) => {
  const page = await stack.context.newPage();
  await page.goto(`${SITE_URL}/booking.html`);
  await stack.agent.waitForTool(BOOK_TABLE);

  await page.close();

  // Tool của một tab đã đóng phải biến mất, nếu không agent sẽ gọi vào hư không.
  await stack.agent.waitForToolGone(BOOK_TABLE, 30_000);
});

test('service worker vẫn sống sau một loạt hành động', async ({ stack, booking }) => {
  for (const date of ['2027-01-05', '2027-01-06', '2027-01-07']) {
    const res = await stack.agent.callTool(BOOK_TABLE, { guests: 2, date });
    expect(res.isError, res.text).toBe(false);
  }

  // SW còn sống và còn giữ được ngữ cảnh của mình.
  const worker = await stack.reviveWorker();
  const alive = await worker.evaluate(() => typeof chrome?.debugger?.sendCommand === 'function');
  expect(alive).toBe(true);
  await expect(booking.locator('#date')).toHaveValue('2027-01-07');
});
