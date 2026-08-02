import {
  BOOK_TABLE,
  expect,
  INTERACTION_EVENTS,
  recordedEvents,
  test,
} from '../fixtures/stack.js';

/**
 * Ca 1 — điền đủ mọi loại ô, và khẳng định **không có sự kiện untrusted nào**.
 *
 * Đây là bài quan trọng nhất của lưới. Nó bảo vệ hai thứ cùng lúc: chức năng
 * (mọi loại ô vào đúng giá trị) và triết lý (mọi tương tác đều trusted).
 */

test('điền đủ 6 loại ô và gửi form', async ({ stack, booking }) => {
  const res = await stack.agent.callTool(BOOK_TABLE, {
    guests: 4,
    date: '2026-08-20',
    time: '19:30',
    area: 'outdoor',
    note: 'Bàn gần cửa sổ, có trẻ em',
    windowSeat: true,
  });

  expect(res.isError, `tool trả lỗi: ${res.text}`).toBe(false);
  expect(res.text).toMatch(/BK-\d+/);

  // Đọc thẳng DOM: đây là sự thật cuối cùng, không phải chuỗi kết quả do trang
  // tự thuật lại.
  await expect(booking.locator('#guests')).toHaveValue('4');
  await expect(booking.locator('#date')).toHaveValue('2026-08-20');
  await expect(booking.locator('#time')).toHaveValue('19:30');
  await expect(booking.locator('#area')).toHaveValue('outdoor');
  await expect(booking.locator('#note')).toHaveValue('Bàn gần cửa sổ, có trẻ em');
  await expect(booking.locator('#window-seat')).toBeChecked();
});

test('KHÔNG tồn tại sự kiện tương tác nào untrusted', async ({ stack, booking }) => {
  await stack.agent.callTool(BOOK_TABLE, {
    guests: 3,
    date: '2026-09-15',
    area: 'balcony',
    windowSeat: true,
  });

  const recorded = await recordedEvents(booking);
  const untrusted = recorded.filter((e) => INTERACTION_EVENTS.has(e.type) && !e.isTrusted);

  // Khẳng định ÂM tính, và nó đáng giá hơn mọi khẳng định dương ở đây: nó sẽ bắt
  // được cái ngày ai đó lỡ thêm một `dispatchEvent` "chỉ lần này thôi" — đúng
  // loại xói mòn triết lý mà không review bằng mắt nào thấy.
  expect(untrusted, `sự kiện untrusted: ${JSON.stringify(untrusted, null, 2)}`).toEqual([]);

  // Và phải thật sự có sự kiện để kiểm — tránh test xanh vì recorder rỗng.
  expect(recorded.filter((e) => e.type === 'keydown').length).toBeGreaterThan(5);
  expect(recorded.some((e) => e.type === 'submit')).toBe(true);
});

test('focus do el.focus() sinh ra vẫn là trusted', async ({ stack, booking }) => {
  await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-10-01' });

  // Điểm tựa của cả thiết kế bàn phím: nếu `focus()` sinh sự kiện untrusted thì
  // đường bàn phím đã đưa một sự kiện giả vào trang, và §2.1 bị vi phạm.
  const focusEvents = (await recordedEvents(booking)).filter((e) => e.type === 'focusin');
  expect(focusEvents.length).toBeGreaterThan(0);
  expect(focusEvents.every((e) => e.isTrusted)).toBe(true);
});

test('checkbox bật rồi tắt được — Space phải đúng là phím cách', async ({ stack, booking }) => {
  // Lỗi cũ: parseKey trả key:'Space' trong khi DOM cần key:' '. Sự kiện vẫn
  // gửi, vẫn trusted, vẫn tới đúng ô — chỉ là Blink không nhận ra đó là phím
  // cách nên checkbox không bao giờ tick. Hỏng hoàn toàn im lặng.
  await stack.agent.callTool(BOOK_TABLE, {
    guests: 2,
    date: '2026-10-02',
    windowSeat: true,
  });
  await expect(booking.locator('#window-seat')).toBeChecked();

  await stack.agent.callTool(BOOK_TABLE, {
    guests: 2,
    date: '2026-10-03',
    windowSeat: false,
  });
  await expect(booking.locator('#window-seat')).not.toBeChecked();
});

test('select đi được cả hai chiều và tới đúng option', async ({ stack, booking }) => {
  // indoor(0) → balcony(2): đường ngắn nhất là End một phím.
  await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-11-01', area: 'balcony' });
  await expect(booking.locator('#area')).toHaveValue('balcony');

  // balcony(2) → indoor(0): đi ngược, đường ngắn nhất là Home.
  await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-11-02', area: 'indoor' });
  await expect(booking.locator('#area')).toHaveValue('indoor');

  // Đích ở giữa.
  await stack.agent.callTool(BOOK_TABLE, { guests: 2, date: '2026-11-03', area: 'outdoor' });
  await expect(booking.locator('#area')).toHaveValue('outdoor');
});
