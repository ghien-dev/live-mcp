/**
 * Cơ chế đợi sau hành động (spec §7.2, milestone M2).
 *
 * ═══ RÀNG BUỘC QUAN TRỌNG NHẤT CỦA MODULE NÀY ═══
 *
 * Spec xếp `livemcp-state` là tín hiệu ưu tiên cao nhất. Nhưng `livemcp-state`
 * là attribute **phải đồng bộ runtime** — dev quên cập nhật thì trang vẫn chạy
 * bình thường, không gì trừng phạt người quên. Nó trượt đúng phép thử N3 của
 * chính dự án, và theo bài học ARIA thì đây là hình dạng "rot" số một.
 * Kỳ vọng đúng: **state rot sẽ là chuyện thường ngoài thực địa, không phải ngoại lệ.**
 *
 * Vì vậy module này lật quan hệ:
 *
 *   • `livemcp-state` = **tối ưu hoá** — nó giúp kết thúc SỚM và chính xác.
 *   • DOM lắng        = **đường tin cậy** — nó bảo đảm không bao giờ treo.
 *
 * Cụ thể: `state="busy"` kéo dài trong khi DOM đã lắng hẳn thì ta **đi tiếp** và
 * báo to rằng state có vẻ hỏng, thay vì ngồi đợi tới hết giờ. Một agent bị treo
 * vì attribute của trang quên đổi là kiểu hỏng tệ nhất — nó đổ lỗi lên Live MCP
 * chứ không lên trang.
 *
 * Phần quyết định ở đây là hàm THUẦN (`evaluateWait`), không đụng DOM, để kiểm
 * được từng nhánh. Phần DOM chỉ đi thu tín hiệu rồi hỏi nó.
 */

/** DOM im lặng bao lâu thì coi là "đã lắng". */
export const QUIET_MS = 250;

/**
 * `state="busy"` mà DOM đã lắng lâu hơn ngần này → coi là state rot, đi tiếp.
 * Đặt rộng hơn `QUIET_MS` nhiều lần: trang thật có thể đang chờ mạng, im lặng
 * một nhịp rồi mới render tiếp — không được vội kết luận là rot.
 */
export const STATE_ROT_MS = 2_000;

/**
 * Không khai báo gì (không `wait`, không `wait-gone`, không `state`) thì đợi
 * DOM lắng, nhưng có trần riêng: trang có animation hoặc polling thì **không
 * bao giờ lắng**, mà ta không có hợp đồng nào để biết khi nào xong. Đợi hết
 * timeout ở ca đó là phạt oan trang chỉ vì nó có một cái spinner trang trí.
 */
export const NO_CONTRACT_CAP_MS = 1_200;

export type WaitReason =
  /** `livemcp-wait` đã xuất hiện. */
  | 'wait-selector'
  /** `livemcp-wait-gone` đã biến mất. */
  | 'wait-gone'
  /** Trang tự báo xong qua `livemcp-state`. */
  | 'state-ready'
  /** Trang tự báo lỗi qua `livemcp-state="error"`. */
  | 'state-error'
  /** DOM đã lắng — đường tin cậy. */
  | 'dom-quiet'
  /** Không có hợp đồng nào và DOM không chịu lắng; đi tiếp theo best-effort. */
  | 'no-contract'
  /** Hết giờ mà điều kiện chưa thoả. */
  | 'timeout';

export interface WaitOutcome {
  done: true;
  reason: WaitReason;
  /** Chỉ `timeout` mới là hỏng; các lý do khác đều là kết thúc bình thường. */
  timedOut: boolean;
  /** Điều kiện đã thoả nhưng `state` vẫn kêu busy → nghi state rot. */
  staleState?: boolean;
}

export interface WaitSignals {
  /** `null` = tool không khai báo `livemcp-wait`. */
  waitSelectorPresent: boolean | null;
  /** `null` = tool không khai báo `livemcp-wait-gone`. */
  waitGonePresent: boolean | null;
  /** `livemcp-state` của vùng liên quan, hoặc `null` nếu không có. */
  state: string | null;
  /** DOM đã im lặng bao lâu (ms). */
  quietMs: number;
  /** Đã đợi bao lâu kể từ lúc hành động xong (ms). */
  elapsedMs: number;
  timeoutMs: number;
}

/**
 * Quyết định: dừng đợi chưa, và vì sao. `null` = tiếp tục đợi.
 *
 * Thứ tự các nhánh dưới đây LÀ đặc tả — đọc từ trên xuống chính là thứ tự ưu
 * tiên. Đừng sắp xếp lại cho gọn.
 */
export function evaluateWait(s: WaitSignals): WaitOutcome | null {
  const declared = s.waitSelectorPresent !== null || s.waitGonePresent !== null;
  const satisfied = s.waitSelectorPresent === true || s.waitGonePresent === false;
  const busy = s.state === 'busy';

  // 1. Trang tự nhận lỗi. Đợi thêm là vô nghĩa — nó sẽ không "hết lỗi" mà không
  //    có hành động mới. Kết thúc ngay và để lớp trên báo nguyên trạng.
  if (s.state === 'error') {
    return { done: true, reason: 'state-error', timedOut: false };
  }

  // 2. Hợp đồng tường minh đã thoả. Đây là tín hiệu chắc chắn nhất vì nó là sự
  //    thật kiểm được về DOM, không phải lời trang tự khai.
  if (declared && satisfied) {
    if (!busy) {
      return {
        done: true,
        reason: s.waitSelectorPresent === true ? 'wait-selector' : 'wait-gone',
        timedOut: false,
      };
    }
    // Thoả rồi nhưng state vẫn kêu busy: cho trang thêm thời gian, nhưng KHÔNG
    // vô hạn — DOM lắng đủ lâu thì đi tiếp và ghi nghi vấn state rot.
    if (s.quietMs >= STATE_ROT_MS) {
      return {
        done: true,
        reason: s.waitSelectorPresent === true ? 'wait-selector' : 'wait-gone',
        timedOut: false,
        staleState: true,
      };
    }
  }

  // 3. Không có hợp đồng tường minh → nghe `state`, rồi nghe DOM.
  if (!declared) {
    if (s.state === 'ready') {
      return { done: true, reason: 'state-ready', timedOut: false };
    }
    if (busy) {
      // Cũng phải có lối thoát khỏi state rot ở nhánh này.
      if (s.quietMs >= STATE_ROT_MS) {
        return { done: true, reason: 'dom-quiet', timedOut: false, staleState: true };
      }
    } else if (s.quietMs >= QUIET_MS) {
      return { done: true, reason: 'dom-quiet', timedOut: false };
    } else if (s.elapsedMs >= NO_CONTRACT_CAP_MS) {
      // DOM không chịu lắng và trang chẳng hứa gì. Đi tiếp, và nói rõ là
      // best-effort chứ không giả vờ đã chắc chắn.
      return { done: true, reason: 'no-contract', timedOut: false };
    }
  }

  // 4. Lưới chốt hạn.
  if (s.elapsedMs >= s.timeoutMs) {
    return { done: true, reason: 'timeout', timedOut: true };
  }

  return null;
}

/** Câu giải thích cho agent, ghép vào kết quả hành động. */
export function explainWait(outcome: WaitOutcome, timeoutMs: number): string | undefined {
  if (outcome.reason === 'timeout') {
    return `Quá ${timeoutMs}ms mà điều kiện đợi của trang chưa thoả.`;
  }
  if (outcome.reason === 'state-error') {
    return 'Trang tự báo trạng thái "error" sau hành động này.';
  }
  return undefined;
}
