/**
 * Xác định thứ tự segment của `<input type="date">`.
 *
 * Vấn đề: `input.value` LUÔN là ISO `YYYY-MM-DD`, nhưng thứ tự các ô con hiển
 * thị (và do đó thứ tự phải gõ chữ số) do **locale giao diện của trình duyệt**
 * quyết định — không phải `lang` của trang, không phải định dạng dev mong muốn.
 * Trang tiếng Việt chạy trên Chrome tiếng Anh vẫn hiện `mm/dd/yyyy`.
 *
 * Vì vậy không được ĐOÁN. Chiến lược ba lớp:
 *   1. `Intl` + `chrome.i18n.getUILanguage()` chỉ dùng làm phỏng đoán ban đầu.
 *   2. **Dò thật**: gõ ngày mốc vào một ô `date` ẩn của riêng extension rồi đọc
 *      `.value` — đo đúng cái trình duyệt đang làm, không phụ thuộc locale.
 *   3. Nếu vẫn lệch: xác minh giá trị thật rồi lần lượt thử các thứ tự còn lại.
 *
 * NGUYÊN TẮC CHUNG (Q02): hành vi nào không được spec chuẩn hoá thì **đo trên
 * chính trình duyệt đang chạy, không tin tài liệu**. Rendering của ô ngày là
 * UA-defined; mọi thứ ta "biết" về nó đều là chi tiết cài đặt của Blink.
 */

export type DateOrder = Array<'day' | 'month' | 'year'>;

export const ORDER_MDY: DateOrder = ['month', 'day', 'year'];
export const ORDER_DMY: DateOrder = ['day', 'month', 'year'];
export const ORDER_YMD: DateOrder = ['year', 'month', 'day'];

// ---------------------------------------------------------------------------
// Logic thuần (test được, không đụng DOM)
// ---------------------------------------------------------------------------

/**
 * Một bộ ngày mốc để gõ vào ô dò.
 *
 * `first`/`second` phải là số **hợp lệ cho cả ngày lẫn tháng** (1..12), để không
 * segment nào bị trình duyệt tự ép về giá trị khác — nếu không phép đo sẽ nhập
 * nhằng giữa "gõ sai thứ tự" và "trình duyệt sửa hộ".
 */
export interface ProbeMarker {
  first: string;
  second: string;
  year: string;
}

/** Mốc lượt 1: 01 / 02 / 2026. */
export const MARKER_A: ProbeMarker = { first: '01', second: '02', year: '2026' };

/**
 * Mốc lượt 2: 03 / 04 / 2027 — khác hẳn mốc 1 nên phân biệt được "đã gõ lại
 * đúng" với "không gõ được gì nên giá trị giữ nguyên".
 */
export const MARKER_B: ProbeMarker = { first: '03', second: '04', year: '2027' };

export function markerDigits(marker: ProbeMarker): string[] {
  return [...marker.first, ...marker.second, ...marker.year];
}

/** Giữ tên cũ cho phần còn lại của mã và cho test. */
export const PROBE_DIGITS = markerDigits(MARKER_A);

/**
 * Đọc `.value` của ô dò → suy ra thứ tự segment.
 *
 * Với mốc 01/02/2026:
 * - `2026-01-02` → segment đầu là tháng  → MDY (en-US)
 * - `2026-02-01` → segment đầu là ngày   → DMY (vi-VN, đa số châu Âu)
 * - năm không phải 2026 → segment đầu đã nuốt `0102` làm năm → YMD (ja, hu, lt…)
 */
export function interpretProbe(value: string, marker: ProbeMarker = MARKER_A): DateOrder | null {
  if (value === `${marker.year}-${marker.first}-${marker.second}`) return ORDER_MDY;
  if (value === `${marker.year}-${marker.second}-${marker.first}`) return ORDER_DMY;
  if (/^\d{1,6}-\d{2}-\d{2}$/.test(value) && !value.startsWith(`${marker.year}-`)) return ORDER_YMD;
  return null;
}

/**
 * Locale **giao diện trình duyệt** — thứ thực sự quyết định thứ tự segment.
 *
 * `navigator.language` là Accept-Language của người dùng, một thứ khác hẳn: một
 * trang tiếng Việt trên Chrome bản tiếng Anh có `navigator.language === 'vi'`
 * nhưng ô ngày vẫn hiện `mm/dd/yyyy`. Đây chính là lỗi nguyên tắc của bản trước.
 */
export function uiLanguage(): string | undefined {
  try {
    return chrome?.i18n?.getUILanguage?.() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phỏng đoán ban đầu từ locale giao diện trình duyệt — chỉ là điểm khởi đầu và
 * là *cross-check* rẻ tiền cho phép dò, không phải nguồn sự thật: chuỗi suy luận
 * "getUILanguage → dữ liệu CLDR → Blink render đúng CLDR" có ba mắt xích, còn
 * phép dò đo thẳng đầu ra.
 */
export function guessOrderFromIntl(): DateOrder {
  const parts = new Intl.DateTimeFormat(uiLanguage(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const order = parts
    .map((p) => p.type)
    .filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year');
  return order.length === 3 ? (order as DateOrder) : ORDER_MDY;
}

/** Locale giao diện có dùng đồng hồ 12 giờ không (cùng nguồn với thứ tự ngày). */
export function guessHour12(): boolean {
  return (
    new Intl.DateTimeFormat(uiLanguage(), { hour: 'numeric' }).resolvedOptions().hour12 === true
  );
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

export const PROBE_HOST_ID = 'livemcp-date-probe';

/**
 * Tạo ô `date` ẩn của riêng extension để đo. Đặt trong shadow root nên CSS của
 * trang không can thiệp được, và ứng dụng của trang không bao giờ thấy nó.
 *
 * Ô nằm ngoài mọi form và bị gỡ ngay sau khi đo. `opacity` gần 0 nhưng vẫn thật
 * sự được render — phải render thì trình duyệt mới xếp segment để ta đo.
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

export function probeInput(): HTMLInputElement | null {
  return (
    document.getElementById(PROBE_HOST_ID)?.shadowRoot?.querySelector<HTMLInputElement>('input') ??
    null
  );
}

export function removeProbe(): void {
  document.getElementById(PROBE_HOST_ID)?.remove();
}
