import { describe, expect, it } from 'vitest';
import {
  dateDigits,
  interpretProbe,
  nextCandidate,
  ORDER_DMY,
  ORDER_MDY,
  ORDER_YMD,
  PROBE_DIGITS,
  sameOrder,
} from './dateOrder.js';

/**
 * Thứ tự segment của `<input type="date">` là chỗ dễ sai nhất và sai rất lặng
 * lẽ: agent yêu cầu 2026-08-20, trình duyệt en-US nhận thành 20/08 → tháng 20
 * không hợp lệ, hoặc tệ hơn là nhận nhầm thành một ngày hợp lệ khác (05/06 ↔
 * 06/05) mà không ai phát hiện. Logic dò/suy luận vì vậy phải có test.
 */
describe('dò thứ tự segment của ô ngày', () => {
  it('ngày mốc dò là 01 / 02 / 2026 — cả hai số đầu đều hợp lệ cho ngày lẫn tháng', () => {
    expect(PROBE_DIGITS.join('')).toBe('01022026');
  });

  it('suy ra đúng thứ tự từ giá trị ISO mà ô dò trả về', () => {
    // Gõ 01 → 02 → 2026 vào ba segment theo thứ tự hiển thị.
    expect(interpretProbe('2026-01-02')).toEqual(ORDER_MDY); // segment đầu là tháng
    expect(interpretProbe('2026-02-01')).toEqual(ORDER_DMY); // segment đầu là ngày
  });

  it('nhận ra locale kiểu YMD: segment năm nuốt mất 0102 nên năm không phải 2026', () => {
    expect(interpretProbe('102-02-02')).toEqual(ORDER_YMD);
    expect(interpretProbe('0102-02-02')).toEqual(ORDER_YMD);
  });

  it('không suy đoán liều khi ô dò không cho kết quả đọc được', () => {
    expect(interpretProbe('')).toBeNull();
    expect(interpretProbe('2026-12-31')).toBeNull();
    expect(interpretProbe('linh tinh')).toBeNull();
  });

  it('sinh đúng chuỗi chữ số cần gõ cho từng thứ tự', () => {
    expect(dateDigits('2026-08-20', ORDER_MDY).join('')).toBe('08202026');
    expect(dateDigits('2026-08-20', ORDER_DMY).join('')).toBe('20082026');
    expect(dateDigits('2026-08-20', ORDER_YMD).join('')).toBe('20260820');
  });

  it('từ chối ngày không đúng dạng ISO thay vì gõ bừa', () => {
    expect(() => dateDigits('20/08/2026', ORDER_DMY)).toThrow();
    expect(() => dateDigits('2026-8-2', ORDER_DMY)).toThrow();
  });

  it('vòng sửa lỗi vét cạn mọi thứ tự rồi mới chịu thua', () => {
    const tried = [ORDER_MDY, ORDER_DMY, ORDER_YMD];
    expect(nextCandidate([])).not.toBeNull();
    expect(nextCandidate(tried)).toBeNull();

    // Không bao giờ đề xuất lại thứ tự đã thử.
    const first = nextCandidate([])!;
    const second = nextCandidate([first])!;
    expect(sameOrder(first, second)).toBe(false);
  });
});
