import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_RESULT_CHARS,
  type FieldDecl,
  type ToolDecl,
} from '@livemcp/protocol';
import type { ActionStep, AfterActionReply, ContentToSw, PlanReply, SwToContent } from '../messages.js';
import { readPageInfo, scan, type ScanResult } from './scanner.js';
import { diffTools, isEmptyDiff, resourcesDiffer, type ToolDiff } from './delta.js';
import { evaluateWait, explainWait, type WaitOutcome, type WaitSignals } from './waiter.js';
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
  PROBE_HOST_ID,
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
   * Danh tính của đúng lần load này.
   *
   * Sinh ở đây chứ không ở service worker là có lý do: SW không biết chắc lúc
   * nào một context content script chết đi và cái mới sinh ra (bfcache, SPA
   * navigation, prerender). Chỉ chính content script mới biết "tôi vừa mới bắt
   * đầu" — và đó đúng là sự kiện cần đánh dấu.
   */
  const pageId: string = crypto.randomUUID();

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
        pageId,
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

  // -------------------------------------------------------------------------
  // M2 — DOM động: MutationObserver → declarative_delta
  // -------------------------------------------------------------------------

  /**
   * Gộp một chùm mutation thành một lần quét. Trang React re-render sinh hàng
   * trăm mutation trong vài ms; không gộp thì quét cháy CPU và agent nhận bão
   * `list_changed`.
   */
  const DELTA_DEBOUNCE_MS = 150;

  let deltaTimer: number | null = null;

  /**
   * Quét lại, cập nhật `current`, và báo server NẾU tool list thật sự đổi.
   *
   * Dùng chung cho hai đường: observer (trang tự đổi) và cuối mỗi hành động
   * (agent làm trang đổi). Phải chung một cửa, vì nếu `afterAction` tự quét rồi
   * gán `current` mà không báo, thì lượt observer kế tiếp sẽ so với bản MỚI và
   * thấy delta rỗng — server không bao giờ biết có tool mới. Đó đúng là kiểu
   * hỏng im lặng mà N2 cấm.
   */
  const publishDelta = (): ToolDiff => {
    const next = scan();

    // Resource đổi thì phát nguyên snapshot — `declarative_delta` chỉ chở tool.
    if (resourcesDiffer(current.resources, next.resources)) {
      const diff = diffTools(current.tools, next.tools);
      current = next;
      seq += 1;
      send({
        type: 'cs_site_ready',
        site: {
          pageId,
          url: location.href,
          app: page.app,
          description: page.description,
          specVersion: page.specVersion,
        },
        seq,
        tools: current.tools,
        resources: current.resources,
      });
      return diff;
    }

    const diff = diffTools(current.tools, next.tools);

    // Điểm mấu chốt: đổi DOM KHÔNG có nghĩa là đổi tool list. Cập nhật registry
    // (element ref có thể đã bị thay) nhưng im lặng với server.
    current = next;
    if (isEmptyDiff(diff)) return diff;

    seq += 1;
    send({ type: 'cs_declarative_delta', pageId, seq, ...diff });
    return diff;
  };

  const emitDelta = () => {
    deltaTimer = null;

    // Đang thi hành một hành động thì đừng báo giữa chừng: form đang được điền
    // dở, tool list lúc đó chưa phải trạng thái nào có thật với agent. Cuối
    // hành động sẽ có một lượt `publishDelta` riêng.
    if (pending) return;

    publishDelta();
  };

  const observer = new MutationObserver((records) => {
    // Ô dò locale của chính extension cũng là mutation — bỏ qua để không tự
    // đánh thức mình (nó nằm trong shadow root của một host ẩn, không mang
    // attribute livemcp nào nên delta sẽ rỗng, nhưng vẫn tốn một lượt quét).
    const meaningful = records.some(
      (r) => !(r.target instanceof Element && r.target.closest(`#${PROBE_HOST_ID}`)),
    );
    if (!meaningful) return;

    if (deltaTimer !== null) clearTimeout(deltaTimer);
    deltaTimer = setTimeout(emitDelta, DELTA_DEBOUNCE_MS) as unknown as number;
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    // KHÔNG dùng attributeFilter: `checkAvailability` gọi `checkVisibility()`,
    // nên một đổi `class` hay `style` cũng đổi được `available` của tool. Lọc
    // theo danh sách attribute sẽ bỏ sót đúng nhóm đó — im lặng. Chi phí đổi
    // lại được debounce + so sánh nội dung gánh.
    attributes: true,
  });

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

    const outcome: WaitOutcome = decl
      ? await waitForSettle(decl)
      : { done: true, reason: 'dom-quiet', timedOut: false };

    const mismatched = pending?.tool === tool ? verify(pending.current) : [];
    pending = null;

    // Trang đã phản ứng xong → quét lại và BÁO NGAY. Đây là mảnh khép vòng
    // "hành động → đợi → declarative mới → hành động tiếp": agent thấy hệ quả
    // của chính mình trong cùng một lượt trả về, không phải hỏi lại.
    const diff = publishDelta();

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

    const timeoutMs = decl?.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    return {
      status: outcome.timedOut ? 'timeout' : 'ok',
      resultText: lines.length ? lines.join('\n') : undefined,
      stateSnapshot: decl ? (stateOf(decl) ?? undefined) : undefined,
      newTools: diff.added.length ? diff.added.map((t) => t.name) : undefined,
      goneTools: diff.removed.length ? [...diff.removed] : undefined,
      error: explainWait(outcome, timeoutMs),
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
   * Vùng mang `livemcp-state` liên quan tới hành động này.
   *
   * Tìm theo thứ tự hẹp → rộng: vùng kết quả, vùng đợi, rồi bất kỳ vùng nào
   * trên trang. Cố ý KHÔNG bịa ra một "vùng mặc định": nếu trang có nhiều vùng
   * state mà tool không chỉ rõ vùng nào thì lấy vùng đầu tiên là đoán bừa —
   * thà không có tín hiệu còn hơn có tín hiệu sai.
   */
  function stateOf(decl: ToolDecl): string | null {
    const selectors = [decl.resultSelector, decl.wait].filter(Boolean) as string[];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const state =
        el?.getAttribute('livemcp-state') ?? el?.closest('[livemcp-state]')?.getAttribute('livemcp-state');
      if (state) return state;
    }
    const all = document.querySelectorAll('[livemcp-state]');
    return all.length === 1 ? all[0]!.getAttribute('livemcp-state') : null;
  }

  /**
   * Đợi trang phản ứng xong sau hành động (spec §7.2).
   *
   * Toàn bộ phần quyết định nằm ở `evaluateWait` — ở đây chỉ thu tín hiệu.
   * Nghe DOM thay vì polling: tab ẩn làm `setTimeout` bị kẹp về 1s (sau 5 phút
   * là 1 phút), trong khi MutationObserver vẫn nổ ngay khi trang đổi. Timer chỉ
   * còn làm lưới chốt hạn.
   */
  function waitForSettle(decl: ToolDecl): Promise<WaitOutcome> {
    const timeoutMs = decl.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    const started = Date.now();
    let lastMutation = started;

    const signals = (): WaitSignals => ({
      waitSelectorPresent: decl.wait ? document.querySelector(decl.wait) !== null : null,
      waitGonePresent: decl.waitGone ? document.querySelector(decl.waitGone) !== null : null,
      state: stateOf(decl),
      quietMs: Date.now() - lastMutation,
      elapsedMs: Date.now() - started,
      timeoutMs,
    });

    return new Promise<WaitOutcome>((resolve) => {
      let finished = false;

      const finish = (outcome: WaitOutcome) => {
        if (finished) return;
        finished = true;
        watcher.disconnect();
        clearInterval(ticker);
        if (outcome.staleState) {
          // Hỏng ồn ào (N2): nếu im lặng, dev sẽ không bao giờ biết
          // `livemcp-state` của mình đã mục — mà đây là lỗi vô hình với chính
          // người viết, y hệt ARIA hỏng khi không ai chạy screen reader.
          console.warn(
            `[Live MCP] tool "${decl.name}": điều kiện đợi đã thoả và DOM đã lắng, ` +
              'nhưng livemcp-state vẫn là "busy". Trang có quên cập nhật state không? ' +
              'Đi tiếp theo tín hiệu DOM.',
          );
        }
        resolve(outcome);
      };

      const check = () => {
        const outcome = evaluateWait(signals());
        if (outcome) finish(outcome);
      };

      const watcher = new MutationObserver(() => {
        lastMutation = Date.now();
        check();
      });
      watcher.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });

      // Nhịp đủ mau để phát hiện "DOM đã lắng" đúng lúc: chính sự VẮNG MẶT của
      // mutation mới là tín hiệu, mà vắng mặt thì observer không bao giờ báo.
      const ticker = setInterval(check, 80);
      check();
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
