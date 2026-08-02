import { BOOK_TABLE, expect, test } from '../fixtures/stack.js';

/**
 * Ca 3 — thứ tự segment ô ngày trên nhiều locale giao diện.
 *
 * Đây là bài tôi từng cho là "không test được". Thứ tự hiển thị của
 * `<input type="date">` do **locale giao diện trình duyệt** quyết định — không
 * phải `lang` của trang, không phải `navigator.language` — nên tưởng như phải
 * có ba máy cài ba bản Chrome khác nhau. Hoá ra chỉ là một tham số dòng lệnh:
 * `--lang`.
 *
 * Bài này nâng phép dò segment từ "tin là đúng" thành "được chứng minh trên ba
 * locale", trong đó có một locale YMD (ja) mà nhánh xử lý riêng của nó chưa
 * từng chạy trên trang thật lần nào.
 *
 * Ngày kiểm cố ý chọn loại **mơ hồ**: cả hai phần đều ≤ 12, nên gõ sai thứ tự
 * sẽ ra một ngày hợp lệ khác thay vì báo lỗi. Đó mới là ca nguy hiểm — ca
 * "tháng 20 không tồn tại" tự nó đã ồn ào rồi.
 */

const AMBIGUOUS = '2026-03-05'; // 5 tháng 3 — nhầm thứ tự thành 3 tháng 5, vẫn hợp lệ
const UNAMBIGUOUS = '2026-08-20'; // ngày 20 > 12 — sai thứ tự là hỏng ồn ào

test('ngày mơ hồ vào đúng, không lặng lẽ thành ngày khác', async ({ stack, booking }) => {
  const res = await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: AMBIGUOUS });

  expect(res.isError, res.text).toBe(false);
  await expect(booking.locator('#date')).toHaveValue(AMBIGUOUS);
});

test('ngày rõ ràng vào đúng', async ({ stack, booking }) => {
  const res = await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: UNAMBIGUOUS });

  expect(res.isError, res.text).toBe(false);
  await expect(booking.locator('#date')).toHaveValue(UNAMBIGUOUS);
});

test('ô dò của extension không để lại dấu vết nào trên trang', async ({ stack, booking }) => {
  await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: AMBIGUOUS });

  // Ô dò nằm trong shadow root riêng, ngoài mọi form, và phải bị gỡ ngay sau khi
  // đo. Ứng dụng của trang không bao giờ được thấy nó — kể cả trong FormData.
  await expect(booking.locator('#livemcp-date-probe')).toHaveCount(0);
  const formFieldNames = await booking.evaluate(() => {
    const data = new FormData(document.getElementById('booking-form') as HTMLFormElement);
    const names: string[] = [];
    data.forEach((_value, key) => names.push(key));
    return names;
  });
  expect(formFieldNames).not.toContain('');
  expect(formFieldNames.sort()).toEqual(['area', 'date', 'guests', 'note', 'time']);
});
