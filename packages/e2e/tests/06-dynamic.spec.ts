import {
  expect,
  OPEN_MENU,
  PICK_DRINK,
  PICK_MAIN,
  ROTTEN_STATE,
  test,
} from '../fixtures/stack.js';

/**
 * Ca 6 — DOM động: **luận điểm trung tâm của cả dự án**.
 *
 * M0/M1 mới chứng minh phần dễ hơn: trang tĩnh, tool biết trước. Nếu vòng
 * *hành động → đợi → declarative mới → hành động tiếp* chạy được, thì lập luận
 * "không cần Imperative API" đứng vững. Nếu không, mọi thứ còn lại đều lung lay.
 *
 * Điều kiện then chốt của các bài dưới đây: agent **không biết trước** tool nào
 * sẽ xuất hiện. Nó chỉ gọi tool đang có, đợi, rồi đọc lại danh sách.
 */

test('tool sinh ra từ DOM mới, không cần biết trước', async ({ stack, dynamic }) => {
  // Lúc trang vừa load, ba tool chon_* KHÔNG tồn tại. Đây là điều kiện của bài
  // — nếu chúng có sẵn thì bài này không chứng minh được gì.
  const before = await stack.agent.toolNames();
  expect(before).not.toContain(PICK_MAIN);
  expect(before).toContain(OPEN_MENU);

  const opened = await stack.agent.callTool(OPEN_MENU, {});
  expect(opened.isError, opened.text).toBe(false);

  // Agent thấy hệ quả của chính mình NGAY trong kết quả trả về, không phải hỏi
  // lại — đây là phần "declarative mới" của vòng lặp.
  expect(opened.text).toContain(PICK_MAIN);

  await stack.agent.waitForTool(PICK_MAIN, 10_000);
  await expect(dynamic.locator('#menu')).toHaveAttribute('livemcp-state', 'ready');
});

test('gọi được tool vừa sinh ra, và nó biến mất sau khi dùng', async ({ stack, dynamic }) => {
  await stack.agent.callTool(OPEN_MENU, {});
  await stack.agent.waitForTool(PICK_DRINK, 10_000);

  const picked = await stack.agent.callTool(PICK_DRINK, {});
  expect(picked.isError, picked.text).toBe(false);

  // Trang đã phản ứng: đây là bằng chứng hành động rơi đúng vào tool vừa sinh.
  await expect(dynamic.locator('#chosen')).toContainText('Đồ uống');

  // Nửa còn lại của vòng đời: tool có sinh thì phải có tử. Menu đóng → cả ba
  // tool chon_* phải biến mất, nếu không agent sẽ gọi vào hư không.
  await stack.agent.waitForToolGone(PICK_DRINK, 10_000);
  expect(await stack.agent.toolNames()).not.toContain(PICK_MAIN);
});

test('đợi bằng livemcp-wait chứ không bằng sleep', async ({ stack, dynamic }) => {
  // Trang trễ 300ms mới render menu. Nếu waiter trả về trước khi điều kiện thoả
  // thì bài này đỏ ngay — và nó đỏ VÌ ĐÚNG LÝ DO, không phải vì hết giờ.
  const opened = await stack.agent.callTool(OPEN_MENU, {});
  expect(opened.isError, opened.text).toBe(false);

  // Ngay tại thời điểm tool trả về, menu đã phải sẵn sàng — không cần đợi thêm.
  expect(await dynamic.locator('#menu').getAttribute('livemcp-state')).toBe('ready');
  expect(await dynamic.locator('.menu-item').count()).toBe(3);
});

test('livemcp_wait: có sẵn thì trả ngay, không có thì hết giờ tử tế', async ({ stack, dynamic }) => {
  expect(dynamic.url()).toContain('dynamic.html');

  const now = await stack.agent.callTool('livemcp_wait', { tool: OPEN_MENU });
  expect(now.isError, now.text).toBe(false);
  expect(now.text).toContain('không phải đợi');

  // Tool không bao giờ tới: phải hết giờ ĐÚNG hạn và nói rõ, chứ không treo
  // phiên làm việc. Đây là lý do server tự đặt trần thay vì tin tham số agent.
  const started = Date.now();
  const never = await stack.agent.callTool('livemcp_wait', {
    tool: 'dynamicdemo__khong_bao_gio_ton_tai',
    timeoutMs: 1_000,
  });
  const elapsed = Date.now() - started;

  expect(never.text).toContain('vẫn chưa xuất hiện');
  expect(elapsed).toBeGreaterThanOrEqual(900);
  expect(elapsed).toBeLessThan(5_000);
});

test('livemcp-state kẹt ở busy KHÔNG treo agent tới hết giờ', async ({ stack, dynamic }) => {
  // Nút này cố ý không bao giờ đặt lại state về ready — mô phỏng đúng lỗi dev
  // hay mắc và không tự thấy. Ràng buộc từ R07: state là tối ưu hoá, DOM lắng
  // mới là đường tin cậy, nên agent phải thoát ra được.
  const started = Date.now();
  const res = await stack.agent.callTool(ROTTEN_STATE, {});
  const elapsed = Date.now() - started;

  expect(res.isError, res.text).toBe(false);
  expect(res.text).toContain('Xong lượt 1');

  // Trang khai wait-timeout 8000ms. Thoát sớm hơn nhiều nghĩa là đường DOM lắng
  // đã làm việc; chạm ngưỡng đó nghĩa là ta đang đợi hết giờ như bản cũ.
  expect(elapsed).toBeLessThan(6_000);

  // Và state đúng là vẫn mục — bài test này chỉ có nghĩa khi tiền đề đó còn thật.
  await expect(dynamic.locator('#rotten-result')).toHaveAttribute('livemcp-state', 'busy');
});
