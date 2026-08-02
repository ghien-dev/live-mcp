import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_RESULT_CHARS,
  type FieldDecl,
  type ToolDecl,
} from '@livemcp/protocol';
import type { ActionStep, AfterActionReply, ContentToSw, PlanReply, SwToContent } from '../messages.js';
import { readPageInfo, scan, type ScanResult } from './scanner.js';
import {
  buildProbePlan,
  DATE_LIKE,
  fieldsToFill,
  hitCheckError,
  planElement,
  planField,
  PlanError,
  probeStageBSteps,
  retryDateSteps,
  retrySelectSteps,
  submitSteps,
  verify,
  type ExpectedField,
} from './plan.js';
import {
  currentOrder,
  guessOrderFromIntl,
  interpretProbe,
  isOrderKnown,
  MARKER_A,
  MARKER_B,
  nextCandidate,
  probeInput,
  rememberOrder,
  removeProbe,
  sameOrder,
  uiLanguage,
  type DateOrder,
} from './dateOrder.js';

/**
 * Content script — "con mắt và bàn tay chỉ đường" của Live MCP trên trang.
 *
 * Nó KHÔNG tự thi hành click/type thật (việc đó của CDP trong service worker);
 * nhiệm vụ của nó là quét declarative, lập kế hoạch thao tác, và đọc kết quả.
 */

const page = readPageInfo();
if (page) {
  let current: ScanResult = scan();
  let seq = 0;

  /**
   * Hành động đang chạy, dưới dạng máy trạng thái điền từng ô một:
   *
   *   probe → field(0) → field(1) → … → submit → (đợi + đọc kết quả)
   *
   * Mỗi lượt chỉ đo toạ độ đúng một ô và xác minh ngay ô đó sau khi dispatch.
   * Đây là điểm khác cốt lõi so với bản trước — bản trước đo cả form một mẻ nên
   * toạ độ đã cũ trước khi kịp dùng.
   */
  let pending: {
    tool: string;
    form: HTMLFormElement | null;
    queue: Array<{ field: FieldDecl; value: unknown }>;
    index: number;
    /** Ô vừa điền, để xác minh ngay ở lượt kế tiếp. */
    current: ExpectedField[];
    triedOrders: DateOrder[];
    /** Số lần đã bấm thêm cho một `<select>` chưa tới đúng option. */
    selectRounds: number;
    phase: 'probe-a' | 'probe-b' | 'field' | 'submit';
  } | null = null;

  /** Trần số vòng bấm-rồi-xác-minh cho một select, để không lặp vô hạn. */
  const MAX_SELECT_ROUNDS = 6;

  const send = (msg: ContentToSw) => {
    chrome.runtime.sendMessage(msg).catch(() => {
      // SW đang ngủ hoặc extension vừa reload — không sao, SW sẽ xin resync.
    });
  };

  const announce = () => {
    current = scan();
    seq += 1;
    send({
      type: 'cs_site_ready',
      site: {
        url: location.href,
        app: page.app,
        description: page.description,
        specVersion: page.specVersion,
      },
      seq,
      tools: current.tools,
      resources: current.resources,
    });
  };

  announce();
  console.info(`[Live MCP] "${page.app}" — phát hiện ${current.tools.length} tool declarative.`);

  window.addEventListener('pagehide', () => send({ type: 'cs_site_gone' }), { once: true });

  // TODO(M2): MutationObserver → declarative_delta + cơ chế đợi livemcp-wait.

  chrome.runtime.onMessage.addListener((msg: SwToContent, _sender, sendResponse) => {
    switch (msg.type) {
      case 'sw_request_resync':
        announce();
        sendResponse({ ok: true });
        return false;

      case 'sw_plan_action':
        planAction(msg.tool, msg.args).then(sendResponse);
        return true; // giữ kênh mở cho phản hồi bất đồng bộ

      case 'sw_after_action':
        afterAction(msg.tool).then(sendResponse);
        return true;

      default:
        return false;
    }
  });

  /** Tìm phần tử của tool trong registry; quét lại một lần nếu registry đã cũ. */
  function findElement(tool: string): HTMLElement | null {
    let candidates = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
    if (candidates.length === 0) {
      current = scan();
      candidates = (current.registry.get(tool) ?? []).filter((el) => el.isConnected);
    }
    // TODO(M3): chọn phần tử theo cặp livemcp-arg thay vì luôn lấy cái đầu.
    return candidates[0] ?? null;
  }

  /** Hành động này có chạm vào ô ngày/giờ nào không? */
  function touchesDateField(decl: ToolDecl, args: Record<string, unknown>): boolean {
    return (decl.fields ?? []).some(
      (f) => DATE_LIKE.has(f.htmlType) && args[f.name] !== undefined && args[f.name] !== '',
    );
  }

  async function planAction(tool: string, args: Record<string, unknown>): Promise<PlanReply> {
    const decl = current.tools.find((t) => t.name === tool);
    const el = findElement(tool);
    if (!decl || !el) {
      return { ok: false, error: `Không tìm thấy phần tử nào mang tool "${tool}" trên trang.` };
    }

    try {
      if (decl.kind !== 'form') {
        const plan = await planElement(el, decl, args);
        pending = {
          tool,
          form: null,
          queue: [],
          index: 0,
          current: plan.expected,
          triedOrders: [currentOrder()],
          selectRounds: 0,
          phase: 'submit',
        };
        return { ok: true, steps: plan.steps };
      }

      const form = el as HTMLFormElement;
      pending = {
        tool,
        form,
        queue: fieldsToFill(decl, args),
        index: 0,
        current: [],
        triedOrders: [currentOrder()],
        selectRounds: 0,
        phase: 'field',
      };

      // Chưa biết trình duyệt xếp segment ngày theo thứ tự nào thì ĐO trước,
      // trên ô của riêng extension — để ứng dụng của trang không bao giờ nhận
      // một ngày sai rồi mới được sửa.
      if (!isOrderKnown() && pending.queue.some((q) => DATE_LIKE.has(q.field.htmlType))) {
        pending.phase = 'probe-a';
        return { ok: true, steps: await buildProbePlan() };
      }

      return { ok: true, steps: await nextFieldSteps() };
    } catch (err) {
      pending = null;
      removeProbe();
      return { ok: false, error: err instanceof PlanError ? err.message : String(err) };
    }
  }

  /**
   * Lập kế hoạch cho ô kế tiếp trong hàng đợi; hết ô thì chuyển sang bấm submit.
   * Toạ độ đo ở đây được dùng ngay ở lượt dispatch liền sau, nên luôn tươi.
   */
  async function nextFieldSteps(): Promise<ActionStep[]> {
    const p = pending!;
    const next = p.queue[p.index];

    if (!next) {
      p.phase = 'submit';
      p.current = [];
      return p.form ? await submitSteps(p.form) : [{ kind: 'keys', keys: ['Enter'] }];
    }

    p.phase = 'field';
    p.triedOrders = [currentOrder()];
    p.selectRounds = 0;
    const plan = await planField(p.form!, next.field, next.value, currentOrder());
    p.current = plan.expected;
    return plan.steps;
  }

  /**
   * Sau khi CDP dispatch xong: xác minh giá trị đã vào đúng ô, rồi đọc
   * `livemcp-result`.
   *
   * M0/M1 dùng độ trễ cố định; M2 sẽ thay bằng waiter thật (livemcp-wait /
   * livemcp-state / wait-gone) theo thứ tự ưu tiên ở spec §7.2.
   */
  async function afterAction(tool: string): Promise<AfterActionReply> {
    // --- vòng dò: đọc kết quả trên ô của extension, chưa đụng gì tới trang ---
    if (pending?.tool === tool && (pending.phase === 'probe-a' || pending.phase === 'probe-b')) {
      try {
        return await stepProbe(pending.phase);
      } catch (err) {
        pending = null;
        removeProbe();
        return { status: 'error', error: err instanceof PlanError ? err.message : String(err) };
      }
    }

    // Cú click vừa rồi có trúng đích không? Kiểm tại thời điểm thật, bịt nốt
    // khoảng trống giữa lúc đo toạ độ và lúc CDP bấm.
    const missed = hitCheckError();
    if (missed) {
      pending = null;
      return { status: 'error', error: missed };
    }

    const decl = current.tools.find((t) => t.name === tool);

    // --- vừa điền xong một ô: xác minh NGAY, chưa đụng tới khâu đợi ---------
    // Xác minh từng ô ngay sau khi gõ là điểm mấu chốt. Nó bắt được cú click
    // trượt ngay tại ô gây lỗi, thay vì để cả chuỗi phím đổ nhầm sang ô khác
    // rồi mãi sau mới phát hiện qua một cái timeout vô nghĩa.
    if (pending?.tool === tool && pending.phase === 'field') {
      try {
        return await afterField();
      } catch (err) {
        pending = null;
        return { status: 'error', error: err instanceof PlanError ? err.message : String(err) };
      }
    }

    const timedOut = decl ? await waitForSettle(decl) : (await sleep(200), false);

    const mismatched = pending?.tool === tool ? verify(pending.current) : [];
    pending = null;

    const lines: string[] = [];

    if (decl?.resultSelector) {
      const target = document.querySelector(decl.resultSelector);
      if (target) {
        lines.push(cleanText((target as HTMLElement).innerText ?? target.textContent ?? ''));
      } else {
        lines.push(`(không tìm thấy vùng kết quả "${decl.resultSelector}")`);
      }
    }

    // Báo thật thà: giá trị nào không vào đúng ô, thay vì im lặng coi như xong.
    if (mismatched.length > 0) {
      lines.push(
        `⚠ Các ô sau không nhận đúng giá trị: ` +
          mismatched
            .map(
              (f) =>
                `${f.name} (yêu cầu "${String(f.value)}", thực tế "${
                  (f.el as HTMLInputElement).value ?? ''
                }")`,
            )
            .join('; '),
      );
    }

    const stateEl = decl?.resultSelector ? document.querySelector(decl.resultSelector) : null;
    return {
      status: timedOut ? 'timeout' : 'ok',
      resultText: lines.length ? lines.join('\n') : undefined,
      stateSnapshot: stateEl?.getAttribute('livemcp-state') ?? undefined,
      error: timedOut
        ? `Quá ${decl?.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS}ms mà điều kiện đợi chưa thoả.`
        : undefined,
    };
  }

  /**
   * Xử lý sau khi vừa điền một ô: đúng thì đi tiếp, sai thì sửa hoặc dừng hẳn.
   *
   * Không bao giờ "kệ nó, đi tiếp": một ô nhận sai giá trị mà vẫn submit là
   * cách tệ nhất — người dùng nhận về một đơn đặt sai chứ không phải một lỗi.
   */
  async function afterField(): Promise<AfterActionReply> {
    const p = pending!;
    const bad = verify(p.current);

    if (bad.length === 0) {
      const done = p.current[0];
      if (done && DATE_LIKE.has(done.htmlType)) {
        // Thứ tự vừa dùng cho kết quả đúng → ghi nhớ, lần sau khỏi dò lại.
        rememberOrder(p.triedOrders[p.triedOrders.length - 1]!);
      }
      if (done) console.info(`[Live MCP] ✓ ${done.name} = ${JSON.stringify(readValue(done))}`);
      p.index += 1;
      return { status: 'retry', steps: await nextFieldSteps() };
    }

    const field = bad[0]!;
    const actual = readValue(field);

    // Select chưa tới đúng option: bấm tiếp từ vị trí THẬT hiện tại.
    //
    // Không dùng số học Δindex một phát ăn ngay, vì mũi tên bỏ qua option
    // `disabled` nên phép trừ sai ngay khi form có option bị khoá. Vòng
    // bấm-rồi-xác-minh chậm hơn không đáng kể và đúng tuyệt đối — nó cũng tự
    // miễn nhiễm với `<optgroup>` mà không cần nhánh riêng.
    if (field.htmlType === 'select' && p.selectRounds < MAX_SELECT_ROUNDS) {
      p.selectRounds += 1;
      console.info(
        `[Live MCP] ${field.name} đang là ${JSON.stringify(actual)} — bấm tiếp ` +
          `(vòng ${p.selectRounds}/${MAX_SELECT_ROUNDS}).`,
      );
      return { status: 'retry', steps: await retrySelectSteps(field) };
    }

    // Ô ngày lệch thì thử thứ tự segment khác — đây là chỗ locale hay đánh lừa.
    if (DATE_LIKE.has(field.htmlType)) {
      const candidate = nextCandidate(p.triedOrders);
      if (candidate) {
        p.triedOrders.push(candidate);
        console.info(
          `[Live MCP] ${field.name} nhận ${JSON.stringify(actual)} thay vì ` +
            `${JSON.stringify(String(field.value))} — gõ lại theo thứ tự ${candidate.join('-')}.`,
        );
        return { status: 'retry', steps: await retryDateSteps(field, candidate) };
      }
    }

    pending = null;
    return {
      status: 'error',
      error:
        `Ô "${field.name}" không nhận được giá trị yêu cầu: cần ${JSON.stringify(
          String(field.value),
        )} nhưng ô đang là ${JSON.stringify(actual)}. ` +
        `Đã dừng trước khi gửi form để không tạo dữ liệu sai.`,
    };
  }

  function readValue(field: ExpectedField): string | boolean {
    const el = field.el as HTMLInputElement;
    return field.htmlType === 'checkbox' ? el.checked : (el.value ?? '');
  }

  /**
   * Phép dò hai lượt. Lượt 1 cho biết **thứ tự segment**; lượt 2 (ArrowLeft về
   * đầu rồi gõ mốc khác) kiểm chứng luôn hai giả định mà cả nhánh ô ngày đang
   * dựa vào: `focus()` đặt con trỏ ở segment đầu, và ArrowLeft ở segment đầu
   * clamp chứ không wrap.
   *
   * Đo cả ba thứ trong một phép dò là cố ý: chúng chỉ đúng "theo cài đặt hiện
   * tại của Blink", không có gì trong spec bảo đảm. Đo trên đúng bản Chrome
   * đang chạy vẫn rẻ hơn nhiều so với tin rồi sai âm thầm trên ô thật.
   */
  async function stepProbe(phase: 'probe-a' | 'probe-b'): Promise<AfterActionReply> {
    const p = pending!;
    const probe = probeInput();
    const raw = probe?.value ?? '';

    if (phase === 'probe-a') {
      const measured = interpretProbe(raw, MARKER_A);
      if (!measured || !probe) {
        removeProbe();
        console.warn(
          `[Live MCP] không đọc được thứ tự ô ngày từ phép dò (value="${raw}") — ` +
            `tạm dùng phỏng đoán ${currentOrder().join('-')} rồi tự sửa nếu lệch.`,
        );
        return { status: 'retry', steps: await nextFieldSteps() };
      }

      p.triedOrders = [measured];
      p.phase = 'probe-b';
      return { status: 'retry', steps: await probeStageBSteps(probe) };
    }

    // --- lượt 2: xác nhận focus-về-đầu + clamp, rồi mới tin kết quả lượt 1 ---
    removeProbe();
    const stageA = p.triedOrders[0]!;
    const stageB = interpretProbe(raw, MARKER_B);

    if (stageB && sameOrder(stageA, stageB)) {
      rememberOrder(stageA);
      crossCheckWithLocale(stageA);
    } else {
      // Hai lượt không khớp: hoặc ArrowLeft wrap, hoặc focus không về segment
      // đầu. Không được tin kết quả lượt 1 nữa — để vòng xác minh từng ô tự vét
      // cạn các thứ tự, vì nó đọc giá trị thật chứ không dựa vào giả định nào.
      console.warn(
        `[Live MCP] phép dò không nhất quán: lượt 1 → ${stageA.join('-')}, ` +
          `lượt 2 đọc được "${raw}"${stageB ? ` → ${stageB.join('-')}` : ' (không hiểu được)'}. ` +
          `Không ghi nhớ thứ tự nào; sẽ xác minh và thử lần lượt trên từng ô.`,
      );
    }

    p.triedOrders = [currentOrder()];
    return { status: 'retry', steps: await nextFieldSteps() };
  }

  /**
   * Đối chiếu kết quả đo với locale giao diện trình duyệt.
   *
   * `chrome.i18n.getUILanguage()` là nguồn *đúng chỗ* (khác `navigator.language`
   * vốn là Accept-Language), nhưng vẫn là suy luận qua ba mắt xích
   * getUILanguage → CLDR → cách Blink render. Phép dò mới là nguồn sự thật; chỗ
   * này chỉ ghi lại khi hai bên lệch nhau, vì đó là dữ liệu đáng biết.
   */
  function crossCheckWithLocale(measured: DateOrder): void {
    const guessed = guessOrderFromIntl();
    if (sameOrder(guessed, measured)) return;
    console.info(
      `[Live MCP] locale giao diện (${uiLanguage() ?? 'không rõ'}) gợi ý ` +
        `${guessed.join('-')} nhưng đo được ${measured.join('-')} — tin số đo.`,
    );
  }

  /**
   * Đợi trang ổn định sau hành động. Bản tối giản của spec §7.2 — polling
   * `livemcp-wait` / `livemcp-wait-gone`; M2 sẽ thay bằng MutationObserver để
   * bắt cả tool mới sinh ra và xử lý ưu tiên `livemcp-state`.
   *
   * @returns true nếu hết thời gian mà điều kiện chưa thoả.
   */
  /** Điều kiện đợi của tool đã thoả chưa (trang đã phản ứng chưa)? */
  function waitSatisfied(decl: ToolDecl): boolean {
    if (decl.wait && document.querySelector(decl.wait)) return true;
    if (decl.waitGone && !document.querySelector(decl.waitGone)) return true;
    return false;
  }

  async function waitForSettle(decl: ToolDecl): Promise<boolean> {
    if (!decl.wait && !decl.waitGone) {
      await sleep(200); // không khai báo wait → đợi DOM lắng một nhịp ngắn
      return false;
    }

    const satisfied = () => waitSatisfied(decl);

    if (satisfied()) return false;

    // Nghe DOM thay vì polling bằng setTimeout: tab ẩn / cửa sổ bị che làm
    // timer bị kẹp về 1s (sau 5 phút là 1 phút), trong khi MutationObserver
    // vẫn nổ ngay khi trang đổi `livemcp-state`. Timer chỉ còn làm lưới chốt hạn.
    return new Promise<boolean>((resolve) => {
      const deadline = Date.now() + (decl.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS);
      let done = false;

      const finish = (timedOut: boolean) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(ticker);
        resolve(timedOut);
      };

      const check = () => {
        if (satisfied()) finish(false);
        else if (Date.now() >= deadline) finish(true);
      };

      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const ticker = setInterval(check, 250);
    });
  }
}

/** Chuẩn hoá whitespace + cắt trần để không phá context window của agent (§5.4). */
function cleanText(raw: string): string {
  const text = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n…(đã cắt bớt)`
    : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
