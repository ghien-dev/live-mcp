import {
  CLICK_BURIED,
  CLICK_REACHABLE,
  expect,
  PICK_CITY,
  recordedEvents,
  test,
} from '../fixtures/stack.js';

/**
 * Ca 2 — đường FAIL.
 *
 * Bài này bảo vệ thứ khó thấy nhất: **cách hệ thống từ chối**. Toàn bộ lớp tự
 * kiểm (focusElement xác minh activeElement, assertHits, hit target
 * interceptor, xác minh từng ô) sinh ra sau một lỗi tốn nhiều lượt gỡ, mà lại
 * chưa có gì giữ chúng khỏi hồi quy. Đường fail hỏng thì không ai biết — cho
 * tới lần sau, khi nó lại lặng lẽ gõ vào nhầm ô.
 *
 * Tiêu chuẩn ở đây không phải "có lỗi", mà là **lỗi chỉ đích danh và không để
 * lại tác dụng phụ nào**.
 */

test('phần tử bị lớp phủ che → huỷ hành động và nói rõ trúng vào đâu', async ({
  stack,
  edgeCases,
}) => {
  const res = await stack.agent.callTool(CLICK_BURIED, {});

  expect(res.isError, `đáng lẽ phải lỗi, nhưng trả về: ${res.text}`).toBe(true);
  // Lỗi phải chỉ ra phần tử nào đã nuốt cú click, không phải "thao tác thất bại".
  expect(res.text).toContain('blanket');

  // Và quan trọng không kém: KHÔNG được bấm trúng gì cả.
  await expect(edgeCases.locator('#buried-result')).toHaveText('chưa bấm');
  const clicks = (await recordedEvents(edgeCases)).filter((e) => e.type === 'click');
  expect(clicks, 'không được phát cú click nào khi đã biết là sẽ trượt').toEqual([]);
});

test('phần tử không focus được nhưng thông thoáng → đường chuột vẫn chạy', async ({
  stack,
  edgeCases,
}) => {
  const res = await stack.agent.callTool(CLICK_REACHABLE, {});
  expect(res.isError, res.text).toBe(false);

  await expect(edgeCases.locator('#reachable-result')).toContainText('đã bấm');
  // Đường chuột cũng phải trusted như đường bàn phím.
  await expect(edgeCases.locator('#reachable-result')).toContainText('isTrusted: true');
});

test('select có option bị khoá vẫn tới đúng đích', async ({ stack, edgeCases }) => {
  // hanoi(0) → saigon(3). Nếu tính Δindex = 3 rồi bấm mù ba lần, mũi tên bỏ qua
  // hai option disabled nên sẽ vọt tới cantho(4). Chỉ vòng bấm-rồi-xác-minh mới
  // tới đúng nơi — đây chính là cạm bẫy mà số học Δindex không thấy.
  const res = await stack.agent.callTool(PICK_CITY, { city: 'saigon' });
  expect(res.isError, res.text).toBe(false);
  await expect(edgeCases.locator('#city')).toHaveValue('saigon');
});

test('giá trị không có trong select → lỗi liệt kê đúng các lựa chọn', async ({
  stack,
  edgeCases,
}) => {
  const res = await stack.agent.callTool(PICK_CITY, { city: 'tokyo' });

  expect(res.isError).toBe(true);
  // Lỗi phải hữu ích cho agent: nói rõ có những lựa chọn nào.
  expect(res.text).toContain('hanoi');
  expect(res.text).toContain('saigon');
  // Không được đụng vào ô.
  await expect(edgeCases.locator('#city')).toHaveValue('hanoi');
});
