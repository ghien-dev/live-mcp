/**
 * Xác định thứ tự segment của `<input type="date">`.
 *
 * Vấn đề: `input.value` LUÔN là ISO `YYYY-MM-DD`, nhưng thứ tự các ô con hiển
 * thị (và do đó thứ tự phải gõ chữ số) do **locale giao diện của trình duyệt**
 * quyết định — không phải `lang` của trang, không phải định dạng dev mong muốn.
 * Trang tiếng Việt chạy trên Chrome tiếng Anh vẫn hiện `mm/dd/yyyy`.
 *
 * Vì vậy không được ĐOÁN. Chiến lược ba lớp:
 *   1. `Intl` chỉ dùng làm phỏng đoán ban đầu.
 *   2. **Dò thật**: gõ một ngày mốc vào một ô `date` ẩn của riêng extension rồi
 *      đọc `.value` — đo đúng cái trình duyệt đang làm, không phụ thuộc locale.
 *      Ô dò nằm trong shadow root riêng nên CSS của trang không phá được, và bị
 *      gỡ ngay sau khi đo; ứng dụng của trang không bao giờ thấy nó.
 *   3. Nếu vẫn lệch: xác minh giá trị thật rồi lần lượt thử các thứ tự còn lại.
 */

export type DateOrder = Array<'day' | 'month' | 'year'>;

export const ORDER_MDY: DateOrder = ['month', 'day', 'year'];
export const ORDER_DMY: DateOrder = ['day', 'month', 'year'];
export const ORDER_YMD: DateOrder = ['year', 'month', 'day'];

// ---------------------------------------------------------------------------
// Logic thuần (test được, không đụng DOM)
// ---------------------------------------------------------------------------

/**
 * Ngày mốc để dò: segment 1 nhận `01`, segment 2 nhận `02`, segment 3 nhận `2026`.
 * Chọn 01/02 vì cả hai đều hợp lệ cho cả ngày lẫn tháng — không segment nào bị
 * trình duyệt tự ép về giá trị khác.
 */
export const PROBE_DIGITS = ['0', '1', '0', '2', '2', '0', '2', '6'];

/**
 * Đọc `.value` của ô dò → suy ra thứ tự segment.
 *
 * - `2026-01-02` → segment đầu là tháng  → MDY (en-US)
 * - `2026-02-01` → segment đầu là ngày   → DMY (vi-VN, đa số châu Âu)
 * - năm không phải 2026 → segment đầu đã nuốt `0102` làm năm → YMD (ja, hu, lt…)
 */
export function interpretProbe(value: string): DateOrder | null {
  if (value === '2026-01-02') return ORDER_MDY;
  if (value === '2026-02-01') return ORDER_DMY;
  if (/^\d{1,6}-\d{2}-\d{2}$/.test(value) && !value.startsWith('2026-')) return ORDER_YMD;
  return null;
}

/** Phỏng đoán ban đầu từ locale của trình duyệt — chỉ là điểm khởi đầu. */
export function guessOrderFromIntl(): DateOrder {
  const parts = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const order = parts
    .map((p) => p.type)
    .filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year');
  return order.length === 3 ? (order as DateOrder) : ORDER_MDY;
}

/** '2026-08-20' + thứ tự segment → chuỗi chữ số cần gõ. */
export function dateDigits(iso: string, order: DateOrder): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`Ngày "${iso}" phải ở dạng YYYY-MM-DD.`);
  const value = { year: m[1]!, month: m[2]!, day: m[3]! };
  return order.flatMap((seg) => value[seg].split(''));
}

export function sameOrder(a: DateOrder, b: DateOrder): boolean {
  return a.length === b.length && a.every((seg, i) => seg === b[i]);
}

/** Thứ tự tiếp theo chưa thử, để vòng sửa lỗi lần lượt vét cạn. */
export function nextCandidate(tried: DateOrder[]): DateOrder | null {
  const all = [guessOrderFromIntl(), ORDER_MDY, ORDER_DMY, ORDER_YMD];
  for (const candidate of all) {
    if (!tried.some((t) => sameOrder(t, candidate))) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bộ nhớ + ô dò (phần đụng DOM)
// ---------------------------------------------------------------------------

let learned: DateOrder | null = null;

export function isOrderKnown(): boolean {
  return learned !== null;
}

/** Thứ tự đang dùng: đã đo được thì dùng, chưa thì tạm phỏng đoán. */
export function currentOrder(): DateOrder {
  return learned ?? guessOrderFromIntl();
}

export function rememberOrder(order: DateOrder): void {
  if (!learned || !sameOrder(learned, order)) {
    learned = order;
    console.info(`[Live MCP] thứ tự ô ngày của trình duyệt: ${order.join('-')}`);
  }
}

const PROBE_HOST_ID = 'livemcp-date-probe';

/**
 * Tạo ô `date` ẩn của riêng extension để đo. Đặt trong shadow root nên CSS của
 * trang không can thiệp được; `opacity` gần 0 nhưng vẫn nhận được click thật.
 */
export function createProbeInput(): HTMLInputElement {
  removeProbe();

  const host = document.createElement('div');
  host.id = PROBE_HOST_ID;
  host.style.cssText =
    'position:fixed;left:4px;bottom:4px;width:140px;height:26px;' +
    'z-index:2147483646;opacity:0.01;pointer-events:auto;';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  const input = document.createElement('input');
  input.type = 'date';
  input.style.cssText = 'width:140px;height:26px;font-size:13px;';
  root.appendChild(input);

  return input;
}

export function removeProbe(): void {
  document.getElementById(PROBE_HOST_ID)?.remove();
}
