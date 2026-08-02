import { describe, expect, it } from 'vitest';
import { parseKey } from './keys.js';

/**
 * Bảng phím đáng có test vì nó hỏng theo kiểu tệ nhất: **im lặng hoàn toàn**.
 *
 * Sai `key` thì sự kiện vẫn được gửi, vẫn `isTrusted: true`, vẫn tới đúng phần
 * tử — chỉ là trình duyệt không nhận ra đó là phím gì nên không kích hoạt gì
 * cả. Không lỗi, không cảnh báo, checkbox chỉ đơn giản là không tick. Nghiệm
 * thu M1 đã vấp đúng ca này với phím cách.
 *
 * Ranh giới ở đây là `KeyboardEvent.key` vs `code`: `code` là vị trí vật lý
 * ('Space', 'KeyA'), `key` là ký tự sinh ra (' ', 'a'). Với hầu hết phím điều
 * khiển hai thứ trùng tên nên dễ tưởng là luôn trùng.
 */
describe('bảng phím cho CDP', () => {
  it('phím cách: key phải là dấu cách, KHÔNG phải chuỗi "Space"', () => {
    // Đây chính là lỗi đã làm checkbox không bao giờ tick: gửi key='Space' thì
    // Blink không coi đó là phím cách nên không chạy activation behavior.
    const space = parseKey('Space');
    expect(space.key).toBe(' ');
    expect(space.code).toBe('Space');
    expect(space.keyCode).toBe(32);

    // Viết bằng ký tự cách cũng phải ra đúng một kết quả.
    expect(parseKey(' ')).toEqual(space);
  });

  it('phím điều khiển khác giữ nguyên tên vì key và code vốn trùng nhau', () => {
    for (const name of ['Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowDown', 'Home', 'End']) {
      const def = parseKey(name);
      expect(def.key, `key của ${name}`).toBe(name);
      expect(def.code, `code của ${name}`).toBe(name);
    }
  });

  it('chữ số và chữ cái: key là ký tự, code là vị trí phím', () => {
    expect(parseKey('5')).toMatchObject({ key: '5', code: 'Digit5', text: '5' });
    expect(parseKey('a')).toMatchObject({ key: 'a', code: 'KeyA', text: 'a' });
  });

  it('phím tắt: đọc đúng modifier và không sinh ký tự', () => {
    const ctrlS = parseKey('Ctrl+S');
    expect(ctrlS.modifiers).toBe(2);
    expect(ctrlS.code).toBe('KeyS');
    // Có Ctrl thì đây là lệnh, không phải gõ chữ 's' vào ô.
    expect(ctrlS.text).toBeUndefined();

    expect(parseKey('Shift+Tab').modifiers).toBe(8);
    expect(parseKey('Ctrl+Shift+A').modifiers).toBe(2 | 8);
  });

  it('mọi phím sinh ký tự đều phải có text, để CDP gõ ra được', () => {
    // Không có `text` thì cdp.ts gửi 'rawKeyDown' — không ký tự nào được nhập.
    for (const spec of ['Space', ' ', '0', '9', 'a', 'Z']) {
      expect(parseKey(spec).text, `text của "${spec}"`).toBeTruthy();
    }
  });
});
