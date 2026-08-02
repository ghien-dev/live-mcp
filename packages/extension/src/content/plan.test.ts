import { describe, expect, it } from 'vitest';
import { arrowSteps } from './plan.js';

/**
 * Điều hướng `<select>` bằng mũi tên.
 *
 * Đáng viết test vì hai lý do: nó có ba nhánh (đi thẳng / nhảy Home / nhảy End)
 * và nó **hỏng lặng lẽ** — bấm thiếu một nấc thì form vẫn gửi được, chỉ là gửi
 * sai lựa chọn. Đúng loại lỗi mà nhìn bằng mắt không bắt được.
 *
 * Mỗi lần bấm phát một cặp `input`+`change`, nên số phím bấm không chỉ là tốc
 * độ: nó là số lần trang bị đánh thức. Vì vậy test khẳng định cả *đường đi ngắn
 * nhất*, không chỉ *đi tới đúng nơi*.
 */
describe('điều hướng select bằng mũi tên', () => {
  const keys = (steps: ReturnType<typeof arrowSteps>) =>
    steps.flatMap((s) => (s.kind === 'keys' ? s.keys : []));

  it('đã đúng option rồi thì không bấm gì cả', () => {
    expect(arrowSteps(10, 3, 3)).toEqual([]);
  });

  it('đi thẳng khi đích ở gần vị trí hiện tại', () => {
    expect(keys(arrowSteps(10, 5, 7))).toEqual(['ArrowDown', 'ArrowDown']);
    expect(keys(arrowSteps(10, 5, 3))).toEqual(['ArrowUp', 'ArrowUp']);
  });

  it('nhảy Home khi đích ở gần đầu danh sách hơn', () => {
    // Từ 18 xuống 0: đi thẳng mất 18 phím, Home mất 1.
    expect(keys(arrowSteps(20, 18, 0))).toEqual(['Home']);
    expect(keys(arrowSteps(20, 18, 2))).toEqual(['Home', 'ArrowDown', 'ArrowDown']);
  });

  it('nhảy End khi đích ở gần cuối danh sách hơn', () => {
    expect(keys(arrowSteps(20, 1, 19))).toEqual(['End']);
    expect(keys(arrowSteps(20, 1, 17))).toEqual(['End', 'ArrowUp', 'ArrowUp']);
  });

  it('luôn chọn đường ít phím nhất trong mọi cặp (vị trí, đích)', () => {
    const count = 12;
    for (let from = 0; from < count; from += 1) {
      for (let to = 0; to < count; to += 1) {
        const used = keys(arrowSteps(count, from, to)).length;
        const best = Math.min(Math.abs(to - from), to + 1, count - to);
        expect(used, `từ ${from} tới ${to}`).toBe(best);
      }
    }
  });

  it('mọi đường đi đều thật sự tới đúng option', () => {
    const count = 12;
    for (let from = 0; from < count; from += 1) {
      for (let to = 0; to < count; to += 1) {
        let at = from;
        for (const key of keys(arrowSteps(count, from, to))) {
          if (key === 'Home') at = 0;
          else if (key === 'End') at = count - 1;
          else if (key === 'ArrowDown') at = Math.min(count - 1, at + 1);
          else if (key === 'ArrowUp') at = Math.max(0, at - 1);
          else throw new Error(`phím lạ trong kế hoạch select: ${key}`);
        }
        expect(at, `từ ${from} tới ${to}`).toBe(to);
      }
    }
  });
});
