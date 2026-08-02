import type { FieldDecl, ToolDecl } from '@livemcp/protocol';
import type { ActionStep } from '../messages.js';
import {
  createProbeInput,
  dateKeys,
  guessHour12,
  markerDigits,
  MARKER_A,
  MARKER_B,
  type DateOrder,
} from './dateOrder.js';

/**
 * Lập kế hoạch thao tác: từ `ToolDecl` + tham số của agent → danh sách bước
 * chuột/bàn phím mà service worker sẽ dispatch qua CDP.
 *
 * Toàn bộ hiểu biết về "làm sao điền một ô ngày", "làm sao chọn một option"
 * nằm ở đây. Nguyên tắc: **chỉ dùng những gì con người dùng được** — chuột và
 * bàn phím, không set `.value` bằng JavaScript.
 *
 * NGUYÊN TẮC SỐ 2, học được sau một lỗi tốn nhiều thời gian: **mỗi lượt chỉ lập
 * kế hoạch cho MỘT ô.** Đo toạ độ cả form một mẻ rồi phát lại sau là sai, vì
 * `scrollIntoView` của phép đo ô sau làm sai toạ độ ô trước; đến lúc phát thì
 * mọi điểm đều thuộc một trạng thái cuộn không còn tồn tại.
 *
 * NGUYÊN TẮC SỐ 3, sau khi hỏi chuyên gia (docs/consult/Q01): **bàn phím là
 * đường mặc định, toạ độ chỉ là ngôn ngữ của hành động chuột.** Toạ độ là sản
 * phẩm của một trạng thái layout — nó chỉ đúng trong khoảnh khắc đo, nên không
 * bao giờ được dùng làm *danh tính* của phần tử. Focus thì ngược lại: nó là
 * trạng thái bền của document, đặt xong là giữ nguyên cho tới lượt dispatch.
 * Vì vậy toàn bộ việc điền form đi qua `focusElement()` + phím, và không một ô
 * nào của form còn phụ thuộc vào toạ độ nữa.
 *
 * Hai sự thật khiến điều đó hợp lệ, cả hai đều đã được xác nhận ở Q01:
 * - `el.focus()` chạy "focusing steps" của HTML spec, sự kiện `focus`/`focusin`
 *   sinh ra từ đó vẫn `isTrusted: true` (khác `el.click()`, thứ spec bắt phải
 *   dispatch synthetic). Ta không hề đưa sự kiện untrusted nào vào trang.
 * - Sự kiện từ `Input.dispatchKeyEvent` đi qua pipeline input của browser
 *   process nên **có cấp transient user activation**. Activation gắn với *hành
 *   động* (phím), không phải với bước lấy focus.
 *
 * INVARIANT kèm theo: `Input.insertText` mô phỏng IME commit chứ không phải
 * keydown, nên **tự nó không cấp user activation**. Mọi chuỗi bước phải chứa ít
 * nhất một phím thật trước bước cần activation — hôm nay luôn đúng vì đường
 * text-like bắt đầu bằng Ctrl+A. Đừng bỏ bước đó đi để "tối ưu".
 */

/** Ô nhập nhận được `Input.insertText` nguyên chuỗi. */
const TEXT_LIKE = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'textarea']);

/** Ô ngày/giờ phải gõ từng chữ số theo thứ tự segment của trình duyệt. */
const DATE_LIKE = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

/**
 * Số segment tối đa của từng loại ô ngày/giờ.
 *
 * Dùng để biết bấm ArrowLeft bao nhiêu lần thì chắc chắn về được segment đầu.
 * An toàn vì ArrowLeft ở segment đầu **clamp** (đứng yên), không wrap sang
 * segment cuối — bấm dư không hại gì. Chính phép dò xác nhận điều này trên đúng
 * bản Chrome đang chạy, thay vì tin tài liệu (Q02 câu 2).
 */
const SEGMENT_COUNT: Record<string, number> = {
  date: 3,
  month: 2,
  week: 2,
  time: 3, // giờ, phút, AM/PM
  'datetime-local': 6,
};

export interface ExpectedField {
  el: HTMLElement;
  name: string;
  htmlType: string;
  value: unknown;
}

export interface Plan {
  steps: ActionStep[];
  expected: ExpectedField[];
}

export class PlanError extends Error {}

// ---------------------------------------------------------------------------
// Focus — đường chính, không phụ thuộc toạ độ
// ---------------------------------------------------------------------------

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(el: HTMLElement): string {
  return (
    el.getAttribute('livemcp-name') ??
    el.getAttribute('toolname') ??
    (el as HTMLInputElement).name ??
    el.tagName.toLowerCase()
  );
}

function describeHit(el: Element): string {
  const name = (el as HTMLInputElement).name;
  return `<${el.tagName.toLowerCase()}${name ? ` name="${name}"` : ''}${
    el.id ? ` id="${el.id}"` : ''
  }>`;
}

/**
 * Đưa focus vào phần tử rồi **xác minh** nó thật sự nhận được focus.
 *
 * Đây là bước thay thế cú click-để-lấy-focus. Xác minh bằng `activeElement` của
 * `getRootNode()` chứ không phải của `document`: trong shadow DOM,
 * `document.activeElement` chỉ trả về host, còn root mới biết phần tử thật.
 *
 * Phần tử không nhận được focus (disabled, `display:none`, `inert`, hoặc bị
 * trang cướp focus lại) → huỷ hành động ngay. Thà báo lỗi chỉ đích danh còn hơn
 * gõ cả chuỗi phím vào một ô không ai biết là ô nào.
 */
export async function focusElement(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  el.focus({ preventScroll: true });
  await nextTask();

  const root = el.getRootNode() as Document | ShadowRoot;
  const active = root.activeElement;
  if (active === el) return;

  throw new PlanError(
    `Không đưa được con trỏ vào ô "${describe(el)}" — ` +
      (active
        ? `focus đang ở ${describeHit(active)}`
        : 'không phần tử nào đang được focus') +
      `. Huỷ hành động để khỏi gõ nhầm chỗ.`,
  );
}

// ---------------------------------------------------------------------------
// Toạ độ — chỉ còn dùng cho hành động chuột thật sự (canvas, phần tử không
// focus được, click/dblclick/right-click khai báo tường minh)
// ---------------------------------------------------------------------------

/**
 * Đo toạ độ có kiểm tra độ ổn định.
 *
 * Đo hai lần cách nhau một nhịp ngắn, khác nhau thì đo lại: layout đang dịch
 * (ảnh vừa tải, animation, sticky header co lại) thì toạ độ đo được sẽ sai
 * trước cả khi kịp dùng.
 *
 * Cố ý KHÔNG dùng `requestAnimationFrame` như stability check của Playwright:
 * rAF đóng băng khi tab ở nền hoặc cửa sổ bị che — đúng trạng thái làm việc
 * bình thường của agent. Nhưng layout tính-theo-yêu-cầu thì vẫn chạy:
 * `getBoundingClientRect()` ép tính layout đồng bộ bất kể trạng thái tab. Nên ta
 * lấy chính phép đo làm đồng hồ, thay vì mượn nhịp vẽ của trang (Q04 câu 1).
 */
async function stableRect(el: HTMLElement): Promise<DOMRect> {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await nextTask();

  let previous = el.getBoundingClientRect();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await sleep(40);
    const rect = el.getBoundingClientRect();
    if (sameRect(previous, rect)) {
      if (rect.width === 0 || rect.height === 0) {
        throw new PlanError(`Phần tử "${describe(el)}" có kích thước 0 — không thao tác được.`);
      }
      return rect;
    }
    previous = rect;
  }

  throw new PlanError(
    `Phần tử "${describe(el)}" vẫn đang dịch chuyển sau 4 lần đo — ` +
      `huỷ hành động thay vì click vào một toạ độ chắc chắn đã cũ.`,
  );
}

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Điểm sắp click có thật sự rơi vào phần tử ta nhắm không?
 *
 * Kiểm ở tâm là đúng và đủ: ca "tâm thoáng nhưng phần lớn diện tích bị che" vẫn
 * click trúng phần tử nên không có gì phải chặn; ca nguy hiểm duy nhất là *tâm
 * bị che*, và đó đúng là ca `elementFromPoint` bắt được (Q04 câu 3).
 */
function assertHits(el: HTMLElement, x: number, y: number): void {
  const root = el.getRootNode();
  const scope = root instanceof ShadowRoot ? root : document;
  const hit = scope.elementFromPoint(x, y);
  if (hit && (hit === el || el.contains(hit) || hit.contains(el))) return;
  throw new PlanError(
    `Điểm (${Math.round(x)}, ${Math.round(y)}) không rơi vào ô "${describe(el)}" mà vào ` +
      `${hit ? describeHit(hit) : 'khoảng trống'} — huỷ hành động để khỏi gõ nhầm ô.`,
  );
}

async function clickStep(el: HTMLElement, button: 'left' | 'right' = 'left'): Promise<ActionStep> {
  const rect = await stableRect(el);
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  assertHits(el, x, y);
  armHitCheck(el);
  return { kind: 'click', x, y, button };
}

// ---------------------------------------------------------------------------
// Kiểm chứng SAU sự kiện: cú click vừa rồi có trúng đúng phần tử không?
// ---------------------------------------------------------------------------

/**
 * `assertHits` kiểm tại **thời điểm đo**, nên nó bắt được layout đã sai từ
 * trước nhưng không bắt được layout dịch trong khoảng giữa lúc đo và lúc
 * dispatch. Bịt nốt khoảng đó bằng cách nghe chính cú `mousedown` do CDP sinh
 * và đối chiếu target thật — kiểm tại thời điểm THẬT (Q04 câu 3).
 */
let hitWatch: { target: HTMLElement; actual: Element | null; fired: boolean } | null = null;

function onMouseDownCapture(event: MouseEvent): void {
  if (!hitWatch || hitWatch.fired) return;
  hitWatch.fired = true;
  hitWatch.actual = (event.composedPath()[0] as Element | undefined) ?? null;
}

function armHitCheck(el: HTMLElement): void {
  if (!hitWatch) {
    document.addEventListener('mousedown', onMouseDownCapture, { capture: true });
  }
  hitWatch = { target: el, actual: null, fired: false };
}

/** Gọi sau khi SW dispatch xong. Trả về mô tả lỗi, hoặc `null` nếu trúng đích. */
export function hitCheckError(): string | null {
  const watch = hitWatch;
  hitWatch = null;
  document.removeEventListener('mousedown', onMouseDownCapture, { capture: true });
  if (!watch || !watch.fired) return null;

  const { target, actual } = watch;
  if (actual && (actual === target || target.contains(actual) || actual.contains(target))) {
    return null;
  }
  return (
    `Cú click rơi vào ${actual ? describeHit(actual) : 'khoảng trống'} chứ không phải ` +
    `"${describe(target)}" — layout đã dịch giữa lúc đo toạ độ và lúc bấm.`
  );
}

// ---------------------------------------------------------------------------
// Ngày / giờ
// ---------------------------------------------------------------------------

/**
 * Kế hoạch dò ô ngày. Một lần dò, **ba sự thật** (Q02 câu 2):
 *
 *   1. thứ tự segment của trình duyệt — từ giá trị đọc được sau lượt 1;
 *   2. `focus()` có đặt con trỏ ở segment đầu tiên không;
 *   3. ArrowLeft ở segment đầu có clamp (đứng yên) không, hay wrap.
 *
 * Cách làm: gõ mốc A (con trỏ dừng ở segment cuối), rồi ArrowLeft về đầu và gõ
 * mốc B. Nếu lượt 2 cho đúng kết quả kỳ vọng thì cả ba điều trên đều đã được
 * chứng minh trên đúng bản Chrome đang chạy, qua đúng đường CDP thật — và đó
 * cũng chính là bài kiểm cho ca "gõ lại" khi thứ tự đầu tiên sai.
 *
 * Ô dò nằm trong shadow root của riêng extension, ngoài mọi form, và bị gỡ ngay
 * sau khi đo: ứng dụng của trang không bao giờ thấy nó.
 */
export async function buildProbePlan(): Promise<ActionStep[]> {
  const probe = createProbeInput();
  await focusElement(probe);
  return [...backToFirstSegment('date'), { kind: 'keys', keys: markerDigits(MARKER_A) }];
}

/**
 * Lượt 2 của phép dò: con trỏ đang ở segment cuối sau lượt 1, ArrowLeft về đầu
 * rồi gõ mốc B. Ra đúng kết quả kỳ vọng nghĩa là ArrowLeft thật sự clamp và
 * `focus()` thật sự về segment đầu — nếu wrap thì mốc B sẽ đổ vào sai chỗ và ta
 * biết ngay, thay vì phát hiện sau đó trên ô thật của người dùng.
 */
export async function probeStageBSteps(probe: HTMLInputElement): Promise<ActionStep[]> {
  await focusElement(probe);
  return [...backToFirstSegment('date'), { kind: 'keys', keys: markerDigits(MARKER_B) }];
}

/** ArrowLeft đủ nhiều để chắc chắn về segment đầu (an toàn vì clamp). */
function backToFirstSegment(htmlType: string): ActionStep[] {
  const count = SEGMENT_COUNT[htmlType] ?? 3;
  return [{ kind: 'keys', keys: Array.from({ length: count }, () => 'ArrowLeft') }];
}

/**
 * '14:30' → chữ số + phím AM/PM nếu locale giao diện dùng 12 giờ.
 *
 * Cạm bẫy đã biết (Q02 câu 5): có locale đặt AM/PM **trước** giờ (ko-KR). Ở đó
 * chuỗi này sẽ sai và vòng xác minh sẽ bắt được.
 *
 * TODO(M2): mở phép dò sang `type="time"` để đo luôn 12/24h và vị trí field
 * AM/PM, thay vì suy ra từ `Intl` — cùng lý do đã bỏ `Intl` cho ô ngày.
 */
export function timeKeys(raw: string): string[] {
  const m = /^(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) throw new PlanError(`Giờ "${raw}" phải ở dạng HH:MM (24 giờ).`);
  const hour24 = Number(m[1]);
  if (!guessHour12()) return [...m[1]!.split(''), ...m[2]!.split('')];

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return [
    ...String(hour12).padStart(2, '0').split(''),
    ...m[2]!.split(''),
    hour24 < 12 ? 'a' : 'p',
  ];
}

function dateLikeSteps(htmlType: string, value: string, order: DateOrder): ActionStep[] {
  const reset = backToFirstSegment(htmlType);
  if (htmlType === 'time') return [...reset, { kind: 'keys', keys: timeKeys(value) }];
  if (htmlType === 'datetime-local') {
    const [datePart, timePart] = value.split('T');
    return [
      ...reset,
      { kind: 'keys', keys: dateKeys(datePart ?? '', order) },
      { kind: 'keys', keys: timeKeys(timePart ?? '00:00') },
    ];
  }
  return [...reset, { kind: 'keys', keys: dateKeys(value, order) }];
}

// ---------------------------------------------------------------------------
// Điền MỘT ô — tất cả đều đi qua bàn phím
// ---------------------------------------------------------------------------

function textLikeSteps(value: unknown): ActionStep[] {
  return [{ kind: 'selectAll' }, { kind: 'insertText', text: String(value) }];
}

/**
 * `<select>`: focus rồi bấm mũi tên. **KHÔNG BAO GIỜ mở popup, không bao giờ
 * click vào select** — đây là một invariant, không phải một quy ước.
 *
 * Popup của select là cửa sổ native của trình duyệt với vòng input riêng, nằm
 * ngoài renderer. CDP không đưa phím vào đó được — kể cả Escape để đóng lại
 * cũng không chắc tới nơi. Một cú click nhầm vào select có thể treo cả phiên
 * cho tới khi người dùng thật động tay (Q03).
 *
 * Số lần bấm mũi tên chỉ là **ước lượng**: mũi tên bỏ qua option `disabled`, nên
 * số học `Δindex` sai ngay khi form có option bị khoá. Đúng đắn đến từ vòng
 * bấm-rồi-xác-minh ở `index.ts`, không đến từ phép trừ ở đây.
 */
function selectSteps(select: HTMLSelectElement, value: unknown): ActionStep[] {
  return selectArrowSteps(select, optionIndex(select, value));
}

function optionIndex(select: HTMLSelectElement, value: unknown): number {
  const target = Array.from(select.options).findIndex((o) => o.value === String(value));
  if (target < 0) {
    throw new PlanError(
      `Giá trị "${String(value)}" không có trong ô "${select.name}". ` +
        `Các lựa chọn: ${Array.from(select.options)
          .map((o) => o.value)
          .join(', ')}`,
    );
  }
  return target;
}

/**
 * Đường ngắn nhất tới option đích trong ba lối: đi thẳng từ vị trí hiện tại,
 * nhảy Home rồi xuống, hoặc nhảy End rồi lên.
 *
 * Mỗi lần bấm phát một cặp `input`+`change` — đúng như một người dùng bàn phím
 * thật tạo ra. Home/End cắt bớt số sự kiện đó bằng một lần bấm duy nhất, nên
 * đáng làm dù rẻ tiền.
 */
export function arrowSteps(count: number, from: number, to: number): ActionStep[] {
  const last = count - 1;
  const direct = Math.abs(to - from);
  const viaHome = to + 1;
  const viaEnd = last - to + 1;

  if (direct === 0) return [];
  if (direct <= viaHome && direct <= viaEnd) {
    return [repeat(to > from ? 'ArrowDown' : 'ArrowUp', direct)];
  }
  if (viaHome <= viaEnd) {
    return to === 0 ? [repeat('Home', 1)] : [repeat('Home', 1), repeat('ArrowDown', to)];
  }
  return to === last ? [repeat('End', 1)] : [repeat('End', 1), repeat('ArrowUp', last - to)];
}

function selectArrowSteps(select: HTMLSelectElement, target: number): ActionStep[] {
  return arrowSteps(select.options.length, select.selectedIndex, target);
}

function repeat(key: string, times: number): ActionStep {
  return { kind: 'keys', keys: Array.from({ length: times }, () => key) };
}

/** Bấm tiếp cho một select chưa tới đúng option (vòng bấm-rồi-xác-minh). */
export async function retrySelectSteps(field: ExpectedField): Promise<ActionStep[]> {
  const select = field.el as HTMLSelectElement;
  await focusElement(select);
  return selectArrowSteps(select, optionIndex(select, field.value));
}

/**
 * Radio: focus đúng nút cần chọn rồi Space.
 *
 * Space trên radio/checkbox/button khiến UA phát một sự kiện `click` thật
 * (`isTrusted: true`, `detail: 0`) — nên widget nghe `click` vẫn chạy trọn vẹn
 * qua đường bàn phím (Q01 câu 2).
 */
async function radioSteps(
  form: HTMLFormElement,
  name: string,
  value: unknown,
): Promise<ActionStep[]> {
  const radio = Array.from(
    form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  ).find((r) => r.value === String(value));
  if (!radio) throw new PlanError(`Không có lựa chọn "${String(value)}" cho "${name}".`);
  await focusElement(radio);
  return radio.checked ? [] : [{ kind: 'keys', keys: ['Space'] }];
}

/** Các ô của form mà agent thực sự truyền giá trị, theo đúng thứ tự DOM. */
export function fieldsToFill(
  decl: ToolDecl,
  args: Record<string, unknown>,
): Array<{ field: FieldDecl; value: unknown }> {
  return (decl.fields ?? [])
    .filter((f) => {
      const v = args[f.name];
      return v !== undefined && v !== null && v !== '';
    })
    .map((field) => ({ field, value: args[field.name] }));
}

/**
 * Kế hoạch điền MỘT ô. Focus được đặt ngay tại đây và giữ nguyên tới lượt
 * dispatch — khác hẳn toạ độ, focus không "cũ đi" theo layout.
 */
export async function planField(
  form: HTMLFormElement,
  field: FieldDecl,
  value: unknown,
  order: DateOrder,
): Promise<Plan> {
  if (field.htmlType === 'password') {
    // Chặn mặc định (spec §9.4); nới lỏng qua settings sẽ làm ở M4.
    throw new PlanError(`Live MCP từ chối gõ vào ô mật khẩu "${field.name}" vì lý do an toàn.`);
  }

  const named = form.elements.namedItem(field.name);
  const control = (named instanceof RadioNodeList ? named.item(0) : named) as HTMLElement | null;
  if (!control) throw new PlanError(`Không tìm thấy ô "${field.name}" trong form.`);

  const steps: ActionStep[] = [];

  if (field.htmlType === 'radio-group') {
    // Radio group: phải focus đúng nút đích, không phải nút đầu tiên.
    steps.push(...(await radioSteps(form, field.name, value)));
  } else if (field.htmlType === 'select') {
    const select = control as HTMLSelectElement;
    if (select.multiple) {
      throw new PlanError(
        `Ô "${field.name}" là <select multiple> — Live MCP chưa hỗ trợ chọn nhiều mục.`,
      );
    }
    await focusElement(select);
    steps.push(...selectSteps(select, value));
  } else if (field.htmlType === 'checkbox') {
    const box = control as HTMLInputElement;
    await focusElement(box);
    if (box.checked !== Boolean(value)) steps.push({ kind: 'keys', keys: ['Space'] });
  } else if (DATE_LIKE.has(field.htmlType)) {
    await focusElement(control);
    steps.push(...dateLikeSteps(field.htmlType, String(value), order));
  } else {
    await focusElement(control);
    steps.push(...textLikeSteps(value));
  }

  return {
    steps,
    expected: [{ el: control, name: field.name, htmlType: field.htmlType, value }],
  };
}

/** Gõ lại một ô ngày với một thứ tự segment khác. */
export async function retryDateSteps(
  field: ExpectedField,
  order: DateOrder,
): Promise<ActionStep[]> {
  await focusElement(field.el);
  return dateLikeSteps(field.htmlType, String(field.value), order);
}

/**
 * Gửi form: focus nút submit rồi Enter.
 *
 * Enter trên `<button>` cũng khiến UA phát một `click` trusted, nên không mất gì
 * so với cú click chuột — mà lại không phải đo toạ độ.
 */
export async function submitSteps(form: HTMLFormElement): Promise<ActionStep[]> {
  const submit = form.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  if (!submit) return [{ kind: 'keys', keys: ['Enter'] }];
  await focusElement(submit);
  return [{ kind: 'keys', keys: ['Enter'] }];
}

// ---------------------------------------------------------------------------
// Phần tử đơn ngoài form (spec §5)
// ---------------------------------------------------------------------------

/**
 * Đây là nơi duy nhất còn dùng chuột — và chỉ khi buộc phải.
 *
 * `livemcp-action="click"` trên một phần tử focus được thì vẫn đi bàn phím;
 * chuột dành cho phần tử không focus được (div/span/canvas) và cho những hành
 * động vốn dĩ là chuột: click phải, double click.
 */
export async function planElement(
  el: HTMLElement,
  decl: ToolDecl,
  args: Record<string, unknown>,
): Promise<Plan> {
  switch (decl.action) {
    case 'type': {
      if ((el as HTMLInputElement).type === 'password') {
        throw new PlanError('Live MCP từ chối gõ vào ô mật khẩu vì lý do an toàn.');
      }
      await focusElement(el);
      const steps: ActionStep[] = [...textLikeSteps(args.text ?? '')];
      if (decl.submitKey) steps.push({ kind: 'keys', keys: [decl.submitKey] });
      return { steps, expected: [{ el, name: 'text', htmlType: 'text', value: args.text }] };
    }

    case 'click-right':
      return { steps: [await clickStep(el, 'right')], expected: [] };

    case 'dblclick': {
      // Double click thật = hai lần nhấn cùng điểm, lần sau clickCount=2.
      const rect = await stableRect(el);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      assertHits(el, x, y);
      armHitCheck(el);
      return {
        steps: [
          { kind: 'click', x, y, clickCount: 1 },
          { kind: 'click', x, y, clickCount: 2 },
        ],
        expected: [],
      };
    }

    case 'press': {
      if (!decl.key) throw new PlanError(`Tool "${decl.name}" thiếu livemcp-key.`);
      await focusElement(el);
      return { steps: [{ kind: 'keys', keys: [decl.key] }], expected: [] };
    }

    default: {
      // Phần tử focus được thì Enter là đủ và không cần toạ độ; còn lại mới click.
      if (isKeyboardOperable(el)) {
        await focusElement(el);
        return { steps: [{ kind: 'keys', keys: ['Enter'] }], expected: [] };
      }
      return { steps: [await clickStep(el)], expected: [] };
    }
  }
}

/**
 * Phần tử có vận hành được thuần bàn phím theo chuẩn HTML không?
 *
 * Đây cũng là điều kiện conformance mà chuẩn declarative đặt ra cho trang
 * (spec §9.6): **agent-accessible ≡ keyboard-accessible**. Nhờ vậy chuẩn thừa
 * kế miễn phí hai mươi năm hạ tầng accessibility thay vì phát minh khái niệm
 * "agent-focusable" của riêng mình (Q06 câu 3).
 */
function isKeyboardOperable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.tabIndex < 0) return false;
  return (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el.hasAttribute('tabindex')
  );
}

/**
 * Sau khi thi hành: đối chiếu giá trị thật trên DOM với thứ agent yêu cầu.
 * Trả về danh sách field lệch — cơ sở để quyết định sửa lại hay báo lỗi thật thà.
 */
export function verify(expected: ExpectedField[]): ExpectedField[] {
  return expected.filter((field) => {
    if (!field.el.isConnected) return false;
    const el = field.el as HTMLInputElement;
    if (field.htmlType === 'checkbox') return el.checked !== Boolean(field.value);
    return String(el.value ?? '') !== String(field.value);
  });
}

export { DATE_LIKE, TEXT_LIKE };
