import {
  SPEC_MAJOR,
  SPEC_VERSION,
  specMajorOf,
  type FieldDecl,
  type LiveMcpAction,
  type ResourceDecl,
  type ToolDecl,
} from '@livemcp/protocol';

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

/**
 * `closest` nhưng đi xuyên được ranh giới shadow.
 *
 * `Element.closest` dừng ở gốc cây của nó. Với phần tử nằm trong shadow root,
 * điều đó nghĩa là `livemcp-ignore` hay `hidden` đặt ở light DOM **mất hiệu lực
 * ngay tại biên** — một vùng khai là bỏ qua bỗng lại lộ ra tool. Đi tiếp qua
 * `host` là cách khôi phục đúng ngữ nghĩa mà tác giả trang mong đợi.
 */
function closestAcrossShadow(el: Element, selector: string): Element | null {
  let node: Element | null = el;
  while (node) {
    const hit = node.closest(selector);
    if (hit) return hit;
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/** Phần tử nằm trong vùng `livemcp-ignore` thì vô hình với agent (spec §3.1). */
function isIgnored(el: Element): boolean {
  return closestAcrossShadow(el, '[livemcp-ignore]') !== null;
}

/** disabled / hidden → tool vẫn tồn tại nhưng ở trạng thái unavailable (spec §3.2). */
function checkAvailability(el: HTMLElement): { available: boolean; reason?: string } {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    return { available: false, reason: 'phần tử đang bị disabled' };
  }
  if (closestAcrossShadow(el, '[hidden]')) {
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

/**
 * Mọi shadow root **mở** nằm dưới một gốc, kể cả lồng nhau.
 *
 * Phải duyệt từng element chứ không query được: `el.shadowRoot` không phải
 * attribute nên không có selector nào chạm tới nó. Đó là lý do hàm này chỉ
 * được gọi trên gốc quét, không gọi lại trên mỗi mutation.
 *
 * Chỉ đi vào shadow root `open` — spec yêu cầu vậy, và mọi consumer khác của
 * chuẩn (không phải extension) cũng chỉ thấy được `open`. Extension CÓ thể
 * xuyên `closed` bằng `chrome.dom.openOrClosedShadowRoot`, nhưng dùng nó ở đây
 * sẽ khiến trang chạy được với Live MCP mà hỏng với mọi consumer khác — một
 * kiểu bất tuân chuẩn tự mình tạo ra. Chỗ đúng cho API đó là *validator* ở
 * M3.5: phát hiện khai báo nằm trong closed root và báo lỗi tuân thủ, thay vì
 * im lặng không thấy gì (N2).
 */
export function shadowRootsUnder(root: Document | ShadowRoot | Element): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const walk = (scope: Document | ShadowRoot | Element) => {
    for (const el of scope.querySelectorAll<HTMLElement>('*')) {
      const shadow = el.shadowRoot;
      if (!shadow) continue;
      found.push(shadow);
      walk(shadow);
    }
  };
  walk(root);
  return found;
}

/**
 * Quét declarative trong MỘT scope (không đệ quy sang shadow root).
 *
 * Phần tử *slotted* nằm ở light DOM nên `querySelectorAll` của document đã
 * thấy nó rồi — cố ý KHÔNG đi qua `assignedElements`, làm vậy sẽ đếm trùng.
 */
function scanScope(
  scope: Document | ShadowRoot,
  tools: ToolDecl[],
  registry: Map<string, HTMLElement[]>,
): void {
  for (const form of scope.querySelectorAll<HTMLFormElement>(
    'form[toolname], form[livemcp-name]',
  )) {
    if (isIgnored(form)) continue;
    const decl = toolFromForm(form);
    if (!decl || registry.has(decl.name)) continue;
    registry.set(decl.name, [form]);
    tools.push(decl);
  }

  for (const el of scope.querySelectorAll<HTMLElement>('[livemcp-name]')) {
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
}

export function scan(root: Document = document): ScanResult {
  const tools: ToolDecl[] = [];
  const registry = new Map<string, HTMLElement[]>();

  scanScope(root, tools, registry);
  for (const shadow of shadowRootsUnder(root)) {
    scanScope(shadow, tools, registry);
  }

  // TODO(M3): quét [livemcp-resource] → ResourceDecl + trích xuất JSON/table/list.
  const resources: ResourceDecl[] = [];

  return { tools, resources, registry };
}

/**
 * HỢP ĐỒNG TƯƠNG THÍCH NGƯỢC PHÍA CONSUMER (docs/livemcp-roadmap.md R05).
 *
 * Hai vế, và vế nào cũng phải có mặt TRƯỚC KHI tồn tại bất kỳ "trang cũ" nào —
 * tức là bây giờ, lúc số trang áp dụng đúng bằng 0:
 *
 *   1. Attribute `livemcp-*` lạ → BỎ QUA, không bao giờ fail. Đây là hành vi mặc
 *      định của scanner (chỉ đọc các attribute nó biết), nên không cần mã —
 *      nhưng cần được ghi ra để lần sửa sau không ai "chặt chẽ hoá" nó thành lỗi.
 *   2. Major spec lạ → NÓI TO. Im lặng quét bằng luật của major khác là kiểu
 *      hỏng tệ nhất: agent thao tác sai mà không ai biết vì sao (N2).
 */
function warnOnSpecMajorMismatch(raw: string): void {
  const major = specMajorOf(raw);
  if (major === null) {
    console.warn(
      `[Live MCP] <meta name="livemcp" content="${raw}"> không đọc được số phiên bản. ` +
        `Extension này hiểu spec v${SPEC_MAJOR} (${SPEC_VERSION}).`,
    );
    return;
  }
  if (major !== SPEC_MAJOR) {
    console.error(
      `[Live MCP] Trang khai spec v${major}, extension này hiểu v${SPEC_MAJOR} ` +
        `(${SPEC_VERSION}). Vẫn quét tiếp, nhưng hành vi có thể sai — ` +
        'hãy cập nhật extension hoặc kiểm lại meta tag của trang.',
    );
  }
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

  warnOnSpecMajorMismatch(specVersion);

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
