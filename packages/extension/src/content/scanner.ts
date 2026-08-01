import type { FieldDecl, LiveMcpAction, ResourceDecl, ToolDecl } from '@livemcp/protocol';

/**
 * Scanner: DOM → ToolDecl. Đây là nơi DUY NHẤT trong hệ thống hiểu ý nghĩa của
 * các attribute `livemcp-*` (docs/livemcp-architecture.md §3.3). Server phía sau
 * chỉ nhận cấu trúc đã chuẩn hoá.
 */

const VALID_ACTIONS: readonly LiveMcpAction[] = [
  'click',
  'click-right',
  'dblclick',
  'type',
  'select',
  'hover',
  'scroll',
  'press',
  'drag',
];

export interface ScanResult {
  tools: ToolDecl[];
  resources: ResourceDecl[];
  /**
   * Giữ tham chiếu element trực tiếp, KHÔNG lưu selector: DOM churn khiến
   * selector mồ côi, còn element ref + isConnected là tin cậy nhất (§5.1).
   */
  registry: Map<string, HTMLElement[]>;
}

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null || v === '' ? undefined : v;
}

/** Phần tử nằm trong vùng `livemcp-ignore` thì vô hình với agent (spec §3.1). */
function isIgnored(el: Element): boolean {
  return el.closest('[livemcp-ignore]') !== null;
}

/** disabled / hidden → tool vẫn tồn tại nhưng ở trạng thái unavailable (spec §3.2). */
function checkAvailability(el: HTMLElement): { available: boolean; reason?: string } {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    return { available: false, reason: 'phần tử đang bị disabled' };
  }
  if (el.closest('[hidden]')) {
    return { available: false, reason: 'phần tử (hoặc tổ tiên) đang hidden' };
  }
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) {
    return { available: false, reason: 'phần tử không hiển thị trên trang' };
  }
  return { available: true };
}

function parseAction(el: Element): LiveMcpAction {
  const raw = attr(el, 'livemcp-action') as LiveMcpAction | undefined;
  return raw && VALID_ACTIONS.includes(raw) ? raw : 'click';
}

function toolFromElement(el: HTMLElement): ToolDecl | null {
  const name = attr(el, 'livemcp-name');
  if (!name) return null;

  const availability = checkAvailability(el);
  const timeout = attr(el, 'livemcp-wait-timeout');

  return {
    name,
    description: attr(el, 'livemcp-description') ?? name,
    kind: 'element',
    action: parseAction(el),
    key: attr(el, 'livemcp-key'),
    submitKey: attr(el, 'livemcp-submit-key'),
    wait: attr(el, 'livemcp-wait'),
    waitGone: attr(el, 'livemcp-wait-gone'),
    waitTimeout: timeout ? Number(timeout) : undefined,
    resultSelector: attr(el, 'livemcp-result'),
    confirm: attr(el, 'livemcp-confirm'),
    group: attr(el, 'livemcp-group'),
    navigate: el.hasAttribute('livemcp-navigate'),
    available: availability.available,
    unavailableReason: availability.reason,
  };
}

/** Nhãn của một field: `toolparamdescription` → `<label for>` → placeholder → name. */
function fieldDescription(el: HTMLElement, form: HTMLFormElement, name: string): string | undefined {
  const explicit = attr(el, 'toolparamdescription') ?? attr(el, 'livemcp-description');
  if (explicit) return explicit;

  const id = el.getAttribute('id');
  const label = id
    ? form.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)
    : el.closest('label');
  const text = label?.textContent?.trim();
  if (text) return text;

  return attr(el, 'placeholder') ?? name;
}

/**
 * Các field của một form → `FieldDecl[]` (sự thật DOM thuần).
 * Việc dịch sang JSON Schema là của server (`parser/schema.ts`) — content script
 * cố tình không biết gì về MCP.
 */
function scanFormFields(form: HTMLFormElement): FieldDecl[] {
  const fields: FieldDecl[] = [];
  const radioGroups = new Set<string>();

  for (const el of Array.from(form.elements) as HTMLElement[]) {
    const name = (el as HTMLInputElement).name;
    if (!name || isIgnored(el)) continue;

    const tag = el.tagName.toLowerCase();
    if (tag === 'button') continue;

    const input = el as HTMLInputElement;
    if (tag === 'input' && ['submit', 'reset', 'button', 'image', 'hidden'].includes(input.type)) {
      continue;
    }

    const base = {
      name,
      description: fieldDescription(el, form, name),
      required: input.required || el.hasAttribute('required') || undefined,
    };

    if (tag === 'select') {
      const select = el as unknown as HTMLSelectElement;
      fields.push({
        ...base,
        htmlType: 'select',
        options: Array.from(select.options).map((o) => o.value),
      });
      continue;
    }

    if (tag === 'textarea') {
      const area = el as unknown as HTMLTextAreaElement;
      fields.push({
        ...base,
        htmlType: 'textarea',
        maxLength: area.maxLength > 0 ? area.maxLength : undefined,
      });
      continue;
    }

    if (input.type === 'radio') {
      if (radioGroups.has(name)) continue;
      radioGroups.add(name);
      const options = Array.from(
        form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
      ).map((r) => r.value);
      fields.push({ ...base, htmlType: 'radio-group', options });
      continue;
    }

    fields.push({
      ...base,
      htmlType: input.type || 'text',
      min: attr(el, 'min'),
      max: attr(el, 'max'),
      step: attr(el, 'step'),
      pattern: attr(el, 'pattern'),
      maxLength: input.maxLength > 0 ? input.maxLength : undefined,
    });
  }

  return fields;
}

/**
 * Form là đơn vị tool tự nhiên nhất (spec §4). Chấp nhận cả `toolname` của
 * WebMCP gốc lẫn `livemcp-name` — chuẩn Live MCP tương thích ngược (spec §1.3).
 */
function toolFromForm(form: HTMLFormElement): ToolDecl | null {
  const name = attr(form, 'toolname') ?? attr(form, 'livemcp-name');
  if (!name) return null;

  const timeout = attr(form, 'livemcp-wait-timeout');
  const availability = checkAvailability(form);

  return {
    name,
    description:
      attr(form, 'tooldescription') ?? attr(form, 'livemcp-description') ?? name,
    kind: 'form',
    action: 'click',
    fields: scanFormFields(form),
    wait: attr(form, 'livemcp-wait'),
    waitGone: attr(form, 'livemcp-wait-gone'),
    waitTimeout: timeout ? Number(timeout) : undefined,
    resultSelector: attr(form, 'livemcp-result'),
    confirm: attr(form, 'livemcp-confirm'),
    group: attr(form, 'livemcp-group'),
    navigate: form.hasAttribute('livemcp-navigate'),
    available: availability.available,
    unavailableReason: availability.reason,
  };
}

export function scan(root: Document = document): ScanResult {
  const tools: ToolDecl[] = [];
  const registry = new Map<string, HTMLElement[]>();

  for (const form of root.querySelectorAll<HTMLFormElement>('form[toolname], form[livemcp-name]')) {
    if (isIgnored(form)) continue;
    const decl = toolFromForm(form);
    if (!decl || registry.has(decl.name)) continue;
    registry.set(decl.name, [form]);
    tools.push(decl);
  }

  for (const el of root.querySelectorAll<HTMLElement>('[livemcp-name]')) {
    if (el.tagName.toLowerCase() === 'form') continue; // đã xử lý ở vòng trên
    if (isIgnored(el)) continue;
    const decl = toolFromElement(el);
    if (!decl) continue;

    const existing = registry.get(decl.name);
    if (existing) {
      // Nhiều phần tử cùng name = tool tham số hoá (spec §5.3, gộp arg ở M3).
      existing.push(el);
      continue;
    }
    registry.set(decl.name, [el]);
    tools.push(decl);
  }

  // TODO(M3): quét [livemcp-resource] → ResourceDecl + trích xuất JSON/table/list.
  const resources: ResourceDecl[] = [];

  return { tools, resources, registry };
}

/** Ba meta cấp trang bắt buộc (spec §2). Thiếu `livemcp` → trang ngoài chuẩn. */
export function readPageInfo(root: Document = document): {
  specVersion: string;
  app: string;
  description: string;
} | null {
  const specVersion = root
    .querySelector('meta[name="livemcp"]')
    ?.getAttribute('content')
    ?.trim();
  if (!specVersion) return null;

  return {
    specVersion,
    app:
      root.querySelector('meta[name="livemcp-app"]')?.getAttribute('content')?.trim() ||
      root.title ||
      location.hostname,
    description:
      root.querySelector('meta[name="livemcp-description"]')?.getAttribute('content')?.trim() ||
      '(trang không khai báo livemcp-description)',
  };
}
