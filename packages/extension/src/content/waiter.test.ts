import { describe, expect, it } from 'vitest';
import {
  evaluateWait,
  NO_CONTRACT_CAP_MS,
  QUIET_MS,
  STATE_ROT_MS,
  type WaitSignals,
} from './waiter.js';

/**
 * Đây là chỗ đáng viết test nhất của M2, vì hai lý do:
 *
 * 1. Mọi nhánh sai đều hỏng **im lặng** — agent hoặc treo tới hết giờ, hoặc đi
 *    tiếp quá sớm rồi đọc phải trang chưa render xong. Cả hai đều trông giống
 *    "trang chậm" chứ không giống lỗi của ta.
 * 2. Nhánh chống state-rot là một ràng buộc mượn từ bên ngoài (R07). Không có
 *    test thì lần refactor sau sẽ "dọn dẹp" nó đi mà không ai nhận ra.
 */

const base: WaitSignals = {
  waitSelectorPresent: null,
  waitGonePresent: null,
  state: null,
  quietMs: 0,
  elapsedMs: 0,
  timeoutMs: 5_000,
};

const at = (over: Partial<WaitSignals>): WaitSignals => ({ ...base, ...over });

describe('livemcp-wait / wait-gone — hợp đồng tường minh', () => {
  it('selector chưa xuất hiện → còn đợi', () => {
    expect(evaluateWait(at({ waitSelectorPresent: false }))).toBeNull();
  });

  it('selector xuất hiện → xong ngay, không cần đợi DOM lắng', () => {
    const out = evaluateWait(at({ waitSelectorPresent: true, quietMs: 0 }));
    expect(out).toMatchObject({ reason: 'wait-selector', timedOut: false });
  });

  it('wait-gone: còn thấy thì còn đợi, biến mất thì xong', () => {
    expect(evaluateWait(at({ waitGonePresent: true }))).toBeNull();
    expect(evaluateWait(at({ waitGonePresent: false }))).toMatchObject({ reason: 'wait-gone' });
  });

  it('hết giờ mà điều kiện chưa thoả → timeout', () => {
    const out = evaluateWait(at({ waitSelectorPresent: false, elapsedMs: 5_000 }));
    expect(out).toMatchObject({ reason: 'timeout', timedOut: true });
  });
});

describe('chống state-rot — ràng buộc từ R07', () => {
  it('điều kiện thoả nhưng state kêu busy → CHƯA đi ngay, cho trang thêm thời gian', () => {
    const out = evaluateWait(
      at({ waitSelectorPresent: true, state: 'busy', quietMs: STATE_ROT_MS - 1 }),
    );
    expect(out).toBeNull();
  });

  it('điều kiện thoả, state kẹt busy, DOM đã lắng lâu → ĐI TIẾP và đánh dấu nghi rot', () => {
    const out = evaluateWait(
      at({ waitSelectorPresent: true, state: 'busy', quietMs: STATE_ROT_MS }),
    );
    expect(out).toMatchObject({ reason: 'wait-selector', timedOut: false, staleState: true });
  });

  it('không khai báo gì, state kẹt busy, DOM lắng lâu → vẫn thoát ra được', () => {
    const out = evaluateWait(at({ state: 'busy', quietMs: STATE_ROT_MS }));
    expect(out).toMatchObject({ reason: 'dom-quiet', staleState: true });
  });

  it('state busy KHÔNG bao giờ được phép treo agent quá timeout', () => {
    // Ca xấu nhất: state mục, DOM vẫn lục đục nên không bao giờ "lắng đủ lâu".
    const out = evaluateWait(
      at({ waitSelectorPresent: false, state: 'busy', quietMs: 10, elapsedMs: 5_000 }),
    );
    expect(out?.done).toBe(true);
  });
});

describe('livemcp-state là tối ưu hoá, không phải điều kiện duy nhất', () => {
  it('state="ready" khi không khai báo wait → xong sớm', () => {
    expect(evaluateWait(at({ state: 'ready' }))).toMatchObject({ reason: 'state-ready' });
  });

  it('state="error" → dừng ngay, đợi thêm là vô nghĩa', () => {
    const out = evaluateWait(at({ state: 'error', waitSelectorPresent: false }));
    expect(out).toMatchObject({ reason: 'state-error', timedOut: false });
  });

  it('state="error" thắng cả điều kiện wait đã thoả — trang tự nhận hỏng', () => {
    expect(evaluateWait(at({ state: 'error', waitSelectorPresent: true }))).toMatchObject({
      reason: 'state-error',
    });
  });
});

describe('không có hợp đồng nào — đường DOM lắng', () => {
  it('DOM chưa lắng đủ → còn đợi', () => {
    expect(evaluateWait(at({ quietMs: QUIET_MS - 1 }))).toBeNull();
  });

  it('DOM lắng đủ → xong', () => {
    expect(evaluateWait(at({ quietMs: QUIET_MS }))).toMatchObject({ reason: 'dom-quiet' });
  });

  it('trang có animation nên không bao giờ lắng → đi tiếp best-effort, KHÔNG tính là timeout', () => {
    const out = evaluateWait(at({ quietMs: 5, elapsedMs: NO_CONTRACT_CAP_MS }));
    expect(out).toMatchObject({ reason: 'no-contract', timedOut: false });
  });

  it('trần no-contract không được áp cho tool CÓ khai báo wait', () => {
    // Tool đã hứa một selector thì phải đợi đủ timeout của nó, không cắt ngang
    // ở 1.2s — cắt ngang sẽ biến mọi trang chậm thành "xong" giả.
    const out = evaluateWait(
      at({ waitSelectorPresent: false, quietMs: 5, elapsedMs: NO_CONTRACT_CAP_MS }),
    );
    expect(out).toBeNull();
  });
});
