import { BOOK_TABLE, expect, test } from '../fixtures/stack.js';

/**
 * Ca 0 — trục xương sống có nối được không.
 *
 * Bài này tồn tại vì một câu hỏi cụ thể: extension gọi `chrome.debugger.attach`,
 * còn Playwright cũng điều khiển Chrome qua CDP. Về lý thuyết CDP là multi-client
 * từ Chrome 63 nên hai bên sống chung được — nhưng đó đúng là loại giả định
 * không nên tin, phải đo. Bản Chrome nào phá vỡ điều này, ca 0 đỏ và ta biết
 * ngay trong ngày, thay vì lần mò qua năm ca phức tạp hơn.
 */
test('trang được phát hiện và schema sinh ra từ HTML semantic', async ({ stack, booking }) => {
  expect(booking.url()).toContain('booking.html');

  const tool = (await stack.agent.listTools()).find((t) => t.name === BOOK_TABLE)!;
  expect(tool.description).toContain('Đặt bàn');

  const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
  expect(Object.keys(schema.properties).sort()).toEqual(
    ['area', 'date', 'guests', 'note', 'time', 'windowSeat'].sort(),
  );
  // required sinh từ thuộc tính `required` của HTML, không phải khai báo tay.
  expect(schema.required.sort()).toEqual(['date', 'guests']);
});

test('attach debugger và thi hành được một hành động tối giản', async ({ stack, booking }) => {
  // Một hành động tối giản là đủ để chứng minh chuỗi attach → dispatch → DOM
  // chạy được, mà không phụ thuộc vào bất cứ logic điền form phức tạp nào.
  const res = await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-08-20' });

  expect(res.isError, `tool trả lỗi: ${res.text}`).toBe(false);
  expect(res.text).toMatch(/BK-\d+/);
  await expect(booking.locator('#guests')).toHaveValue('2');
});
