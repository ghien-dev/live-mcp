import type { ToolDecl } from '@livemcp/protocol';
import type { ActionStep } from '../messages.js';
import {
  createProbeInput,
  currentOrder,
  dateDigits,
  PROBE_DIGITS,
  type DateOrder,
} from './dateOrder.js';

/**
 * Lập kế hoạch thao tác: từ `ToolDecl` + tham số của agent → danh sách bước
 * chuột/bàn phím mà service worker sẽ dispatch qua CDP.
 *
 * Toàn bộ hiểu biết về "làm sao điền một ô ngày", "làm sao chọn một option"
 * nằm ở đây. Nguyên tắc: **chỉ dùng những gì con người dùng được** — chuột và
 * bàn phím, không set `.value` bằng JavaScript.
 */

/** Ô nhập nhận được `Input.insertText` nguyên chuỗi. */
const TEXT_LIKE = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'number',
  'password',
  'textarea',
]);

/** Ô ngày/giờ phải gõ từng chữ số theo thứ tự segment của trình duyệt. */
const DATE_LIKE = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

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
// Toạ độ
// ---------------------------------------------------------------------------

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function rectOf(el: HTMLElement): Promise<DOMRect> {
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  await nextFrame();
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    throw new PlanError(`Phần tử "${describe(el)}" có kích thước 0 — không thao tác được.`);
  }
  return rect;
}

function describe(el: HTMLElement): string {
  return (
    el.getAttribute('livemcp-name') ??
    el.getAttribute('toolname') ??
    (el as HTMLInputElement).name ??
    el.tagName.toLowerCase()
  );
}

async function clickStep(el: HTMLElement, button: 'left' | 'right' = 'left'): Promise<ActionStep> {
  const rect = await rectOf(el);
  return { kind: 'click', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, button };
}

/**
 * Ô ngày/giờ gồm nhiều segment; click vào giữa ô sẽ rơi vào segment giữa
 * (tháng hoặc ngày tuỳ locale). Click sát mép trái rồi ArrowLeft vài lần để
 * chắc chắn con trỏ ở segment đầu tiên.
 */
async function focusFirstSegment(el: HTMLElement): Promise<ActionStep[]> {
  const rect = await rectOf(el);
  return [
    { kind: 'click', x: rect.left + Math.min(12, rect.width / 4), y: rect.top + rect.height / 2 },
    { kind: 'keys', keys: ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft'] },
  ];
}

// ---------------------------------------------------------------------------
// Ngày / giờ: gõ chữ số theo đúng thứ tự segment mà trình duyệt đang hiển thị
// ---------------------------------------------------------------------------

/**
 * Kế hoạch dò thứ tự ô ngày: gõ ngày mốc vào ô `date` ẩn của riêng extension.
 * Ứng dụng của trang không thấy gì — ô dò nằm ngoài mọi form và bị gỡ ngay sau
 * khi đo (xem `dateOrder.ts` để hiểu vì sao phải đo thay vì đoán).
 */
export async function buildProbePlan(): Promise<ActionStep[]> {
  const probe = createProbeInput();
  return [...(await focusFirstSegment(probe)), { kind: 'keys', keys: [...PROBE_DIGITS] }];
}

function browserUsesHour12(): boolean {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;
}

/** '14:30' → chữ số + phím AM/PM nếu locale dùng 12 giờ. */
export function timeKeys(raw: string): string[] {
  const m = /^(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) throw new PlanError(`Giờ "${raw}" phải ở dạng HH:MM (24 giờ).`);
  const hour24 = Number(m[1]);
  if (!browserUsesHour12()) return [...m[1]!.split(''), ...m[2]!.split('')];

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return [
    ...String(hour12).padStart(2, '0').split(''),
    ...m[2]!.split(''),
    hour24 < 12 ? 'a' : 'p',
  ];
}

function dateLikeSteps(htmlType: string, value: string, order: DateOrder): ActionStep[] {
  if (htmlType === 'time') return [{ kind: 'keys', keys: timeKeys(value) }];
  if (htmlType === 'datetime-local') {
    const [datePart, timePart] = value.split('T');
    return [
      { kind: 'keys', keys: dateDigits(datePart ?? '', order) },
      { kind: 'keys', keys: timeKeys(timePart ?? '00:00') },
    ];
  }
  return [{ kind: 'keys', keys: dateDigits(value, order) }];
}

// ---------------------------------------------------------------------------
// Lập kế hoạch
// ---------------------------------------------------------------------------

function textLikeSteps(value: unknown): ActionStep[] {
  return [{ kind: 'selectAll' }, { kind: 'insertText', text: String(value) }];
}

/**
 * `<select>`: KHÔNG mở popup. Popup của select là cửa sổ native của trình duyệt,
 * sự kiện CDP không tới được nó. Cách của người dùng bàn phím: focus vào select
 * (Tab từ ô trước, hoặc click nhãn) rồi ArrowUp/ArrowDown — lựa chọn đổi ngay
 * tại chỗ và `change` vẫn phát bình thường.
 */
async function selectSteps(
  select: HTMLSelectElement,
  value: unknown,
  hasPrecedingField: boolean,
): Promise<ActionStep[]> {
  const target = Array.from(select.options).findIndex((o) => o.value === String(value));
  if (target < 0) {
    throw new PlanError(
      `Giá trị "${String(value)}" không có trong ô "${select.name}". ` +
        `Các lựa chọn: ${Array.from(select.options).map((o) => o.value).join(', ')}`,
    );
  }

  const focus: ActionStep[] = hasPrecedingField
    ? [{ kind: 'keys', keys: ['Tab'] }]
    : await focusSelectByLabel(select);

  const delta = target - select.selectedIndex;
  if (delta === 0) return focus;

  const key = delta > 0 ? 'ArrowDown' : 'ArrowUp';
  return [...focus, { kind: 'keys', keys: Array.from({ length: Math.abs(delta) }, () => key) }];
}

/** Click vào `<label for>` cho select focus mà không bung popup. */
async function focusSelectByLabel(select: HTMLSelectElement): Promise<ActionStep[]> {
  const id = select.getAttribute('id');
  const label = id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    : select.closest('label');
  if (label) return [await clickStep(label)];
  // Không có nhãn: đành click thẳng (popup bung), rồi Escape để đóng lại.
  return [await clickStep(select), { kind: 'wait', ms: 80 }, { kind: 'keys', keys: ['Escape'] }];
}

async function radioSteps(
  form: HTMLFormElement,
  name: string,
  value: unknown,
): Promise<ActionStep[]> {
  const radio = Array.from(
    form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  ).find((r) => r.value === String(value));
  if (!radio) throw new PlanError(`Không có lựa chọn "${String(value)}" cho "${name}".`);
  return [await clickStep(radio)];
}

/** Điền một form theo DOM order rồi bấm submit (spec §4, luồng thi hành). */
async function planForm(
  form: HTMLFormElement,
  decl: ToolDecl,
  args: Record<string, unknown>,
): Promise<Plan> {
  const steps: ActionStep[] = [];
  const expected: ExpectedField[] = [];
  const order = currentOrder();
  let hasPrecedingField = false;

  for (const field of decl.fields ?? []) {
    const value = args[field.name];
    if (value === undefined || value === null || value === '') continue;

    const el = form.elements.namedItem(field.name);
    const control = (el instanceof RadioNodeList ? el.item(0) : el) as HTMLElement | null;
    if (!control) throw new PlanError(`Không tìm thấy ô "${field.name}" trong form.`);

    if (field.htmlType === 'password') {
      // Chặn mặc định (spec §9.4); nới lỏng qua settings sẽ làm ở M4.
      throw new PlanError(
        `Live MCP từ chối gõ vào ô mật khẩu "${field.name}" vì lý do an toàn.`,
      );
    }

    if (field.htmlType === 'select') {
      steps.push(...(await selectSteps(control as HTMLSelectElement, value, hasPrecedingField)));
    } else if (field.htmlType === 'radio-group') {
      steps.push(...(await radioSteps(form, field.name, value)));
    } else if (field.htmlType === 'checkbox') {
      const box = control as HTMLInputElement;
      if (box.checked !== Boolean(value)) steps.push(await clickStep(box));
    } else if (DATE_LIKE.has(field.htmlType)) {
      steps.push(...(await focusFirstSegment(control)));
      steps.push(...dateLikeSteps(field.htmlType, String(value), order));
    } else if (TEXT_LIKE.has(field.htmlType)) {
      steps.push(await clickStep(control), ...textLikeSteps(value));
    } else {
      steps.push(await clickStep(control), ...textLikeSteps(value));
    }

    expected.push({ el: control, name: field.name, htmlType: field.htmlType, value });
    hasPrecedingField = true;
  }

  const submit = form.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  );
  if (submit) {
    steps.push(await clickStep(submit));
  } else {
    steps.push({ kind: 'keys', keys: ['Enter'] });
  }

  return { steps, expected };
}

/** Phần tử đơn ngoài form (spec §5). */
async function planElement(
  el: HTMLElement,
  decl: ToolDecl,
  args: Record<string, unknown>,
): Promise<Plan> {
  switch (decl.action) {
    case 'type': {
      if ((el as HTMLInputElement).type === 'password') {
        throw new PlanError('Live MCP từ chối gõ vào ô mật khẩu vì lý do an toàn.');
      }
      const steps: ActionStep[] = [await clickStep(el), ...textLikeSteps(args.text ?? '')];
      if (decl.submitKey) steps.push({ kind: 'keys', keys: [decl.submitKey] });
      return {
        steps,
        expected: [{ el, name: 'text', htmlType: 'text', value: args.text }],
      };
    }

    case 'click-right':
      return { steps: [await clickStep(el, 'right')], expected: [] };

    case 'dblclick': {
      // Double click thật = hai lần nhấn cùng điểm, lần sau clickCount=2.
      const rect = await rectOf(el);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
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
      return { steps: [{ kind: 'keys', keys: [decl.key] }], expected: [] };
    }

    default:
      return { steps: [await clickStep(el)], expected: [] };
  }
}

export async function buildPlan(
  el: HTMLElement,
  decl: ToolDecl,
  args: Record<string, unknown>,
): Promise<Plan> {
  return decl.kind === 'form'
    ? planForm(el as HTMLFormElement, decl, args)
    : planElement(el, decl, args);
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

/** Gõ lại một ô ngày với một thứ tự segment khác. */
export async function retryDatePlan(
  field: ExpectedField,
  order: DateOrder,
): Promise<ActionStep[]> {
  return [
    ...(await focusFirstSegment(field.el)),
    ...dateLikeSteps(field.htmlType, String(field.value), order),
  ];
}

export { DATE_LIKE };
