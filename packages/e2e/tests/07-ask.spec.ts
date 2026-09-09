import { test, expect, SITE_URL } from '../fixtures/stack.js';
import type { Page } from '@playwright/test';

/**
 * Kênh Ask đi trọn vòng trên Chrome thật — và đo xem mất bao lâu.
 *
 * **Một ngoại lệ có chủ đích so với luật của lưới.** README của lưới viết
 * "Playwright dựng rạp, không diễn", và luật đó đúng cho đường declarative: ở đó
 * *agent* là bên hành động, nên để Playwright gõ hộ là kiểm nhầm đối tượng.
 * Kênh Ask **đảo chiều**: bên hành động là **người dùng**, còn agent là bên chờ.
 * Nên ở file này Playwright đóng vai người dùng — gõ thật vào widget bằng
 * `page.keyboard` — và `McpAgent` đóng vai phiên Claude đang trực. Không ai diễn
 * hộ ai; mỗi bên vẫn đứng đúng vai của mình trên đường sản phẩm.
 *
 * **Vì sao không dùng locator để bấm widget.** Widget sống trong shadow root
 * `mode: 'closed'` (chủ ý: không đụng DOM trang chủ nhà). Locator của Playwright
 * xuyên được shadow *open*, không xuyên được *closed* — nên:
 *   - mở panel bằng chính đường của phím tắt Alt+A: service worker gửi
 *     `sw_ask_open` xuống tab, widget mở panel và focus ô nhập;
 *   - gõ bằng `page.keyboard`, tức bàn phím thật ở tầng browser, vào đúng phần
 *     tử đang focus — closed shadow không cản được đường này;
 *   - đọc kết quả bằng CDP `DOM.getDocument({pierce:true})`, đường duy nhất nhìn
 *     xuyên được closed shadow root.
 */

const PAGE_URL = `${SITE_URL}/index.html`;
const THREAD_KEY = `ask_thread:${SITE_URL}`;

interface ThreadItem {
  id: string;
  askedAt: number;
  text: string;
  selection?: string;
  status: 'waiting' | 'claimed' | 'answered';
  answer?: string;
  followups: string[];
}

/** Một lượt hỏi–đáp đã đo xong. */
interface Timing {
  question: string;
  /** Người dùng bấm gửi → `livemcp_ask_wait` của agent nhả ra câu hỏi. */
  toAgentMs: number;
  /** Agent gọi `livemcp_ask_answer` → widget nhận được câu trả lời. */
  toWidgetMs: number;
  /** Bấm gửi → thấy câu trả lời. KHÔNG gồm thời gian agent nghĩ. */
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Đóng vai người dùng
// ---------------------------------------------------------------------------

/** Widget mount ở `document_idle`; đợi thẻ host xuất hiện ở light DOM. */
async function waitForWidget(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector('[data-livemcp-ask]'), null, {
    timeout: 15_000,
  });
}

/**
 * Mở panel và đưa con trỏ vào ô nhập — đúng đường mà phím tắt Alt+A đi.
 *
 * Không giả lập được cú nhấn Alt+A thật (`chrome.commands` do tiến trình browser
 * xử lý, không phải renderer), nên bài test nhập vào **ngay sau** chặng đó: SW
 * gửi `sw_ask_open`. Mọi thứ từ đây trở đi là mã sản phẩm.
 */
async function openPanel(page: Page, worker: { evaluate: Function }): Promise<void> {
  await (worker.evaluate as (fn: (url: string) => Promise<void>, arg: string) => Promise<void>)(
    async (url: string) => {
      const [tab] = await chrome.tabs.query({ url });
      if (!tab?.id) throw new Error(`không tìm thấy tab ${url}`);
      await chrome.tabs.sendMessage(tab.id, { type: 'sw_ask_open' }).catch(() => {});
    },
    PAGE_URL,
  );

  // Focus nằm trong closed shadow root, nên `document.activeElement` của trang
  // chỉ trỏ tới thẻ host — và đó chính là tín hiệu ta cần: có focus bên trong.
  await page.waitForFunction(
    () => document.activeElement?.hasAttribute('data-livemcp-ask') === true,
    null,
    { timeout: 10_000 },
  );
}

/** Đọc luồng hội thoại mà widget đã lưu — nguồn để biết widget đã nhận gì. */
async function readThread(worker: { evaluate: Function }): Promise<ThreadItem[]> {
  return (worker.evaluate as (fn: (k: string) => Promise<ThreadItem[]>, a: string) => Promise<ThreadItem[]>)(
    async (key: string) => {
      const s = await chrome.storage.local.get(key);
      return (s[key] as ThreadItem[]) ?? [];
    },
    THREAD_KEY,
  );
}

/** Đợi tới khi widget ghi nhận câu trả lời cho đúng câu hỏi này. */
async function waitAnswered(
  worker: { evaluate: Function },
  questionId: string,
  timeoutMs = 15_000,
): Promise<ThreadItem> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const item = (await readThread(worker)).find((i) => i.id === questionId);
    if (item?.status === 'answered') return item;
    if (Date.now() > deadline) {
      throw new Error(`widget chưa nhận câu trả lời cho ${questionId} sau ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ---------------------------------------------------------------------------
// Nhìn xuyên closed shadow root — chỉ CDP làm được
// ---------------------------------------------------------------------------

interface CdpNode {
  nodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
}

/**
 * Đọc mọi khối câu trả lời đã **render thật** trong widget.
 *
 * Bước này là lý do bài test đáng chạy trên browser thật: `chrome.storage` chỉ
 * chứng minh widget *nhận* được dữ liệu, không chứng minh nó *vẽ ra*. Hai chuyện
 * đó lệch nhau được — và khi lệch thì người dùng ngồi nhìn vòng xoay trong khi
 * mọi tầng phía dưới đều báo thành công.
 */
async function renderedAnswers(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })) as unknown as { root: CdpNode };

    const hits: number[] = [];
    const walk = (n: CdpNode): void => {
      const attrs = n.attributes ?? [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === 'class' && String(attrs[i + 1]).split(/\s+/).includes('lmx-a')) {
          hits.push(n.nodeId);
        }
      }
      for (const c of n.children ?? []) walk(c);
      for (const s of n.shadowRoots ?? []) walk(s);
    };
    walk(root);

    const out: string[] = [];
    for (const nodeId of hits) {
      const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId })) as unknown as {
        outerHTML: string;
      };
      out.push(outerHTML);
    }
    return out;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Bài đo
// ---------------------------------------------------------------------------

const QUESTIONS = [
  'Trang này dùng để làm gì?',
  'Live MCP khác WebMCP gốc ở chỗ nào?',
  'Câu hỏi thứ ba, kèm đoạn tôi bôi đen ở trên.',
];

const ANSWERS = [
  'Đây là **trang demo** của Live MCP.',
  'Khác ở chỗ nó phủ cả phần tử ngoài `<form>`.',
  'Đã đọc đoạn bạn bôi đen.',
];

test('kênh Ask đi trọn vòng, và ask_wait chặn thật', async ({ stack }, testInfo) => {
  const { agent, worker, context } = stack;
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await waitForWidget(page);

  const timings: Timing[] = [];
  const ids: string[] = [];

  for (let i = 0; i < QUESTIONS.length; i++) {
    // Agent vào trực TRƯỚC khi người dùng hỏi — đúng thứ tự đời thật, và cũng là
    // cách duy nhất đo được "câu hỏi mất bao lâu để tới agent".
    const waiting = agent.callTool('livemcp_ask_wait', { maxWaitMs: 20_000 });

    // Luận điểm trung tâm của kênh này: tool CHẶN. Ở lượt đầu, chứng minh nó
    // bằng cách để trống 1.5s và xác nhận chưa có gì trả về.
    if (i === 0) {
      const settledEarly = await Promise.race([
        waiting.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), 1_500)),
      ]);
      expect(
        settledEarly,
        'livemcp_ask_wait trả về khi hàng đợi trống — vòng lặp trực sẽ thành vòng lặp bận',
      ).toBe(false);
    }

    await openPanel(page, worker);

    // Lượt cuối kèm một đoạn bôi đen — đường `selection` của widget.
    if (i === QUESTIONS.length - 1) {
      await page.evaluate(() => {
        const target = document.querySelector('h1') ?? document.body;
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });
      // Panel đang mở nên widget bỏ qua `selectionchange`; mở lại để nó nhặt
      // đoạn vừa bôi đen vào ô soạn — đúng như khi người dùng bấm Alt+A.
      await openPanel(page, worker);
    }

    await page.keyboard.type(QUESTIONS[i]!, { delay: 8 });

    const tSubmit = Date.now();
    await page.keyboard.press('Control+Enter');

    const waitResult = await waiting;
    const toAgentMs = Date.now() - tSubmit;

    expect(waitResult.isError, `ask_wait lỗi: ${waitResult.text}`).toBe(false);
    expect(waitResult.text).toContain(QUESTIONS[i]!);

    const id = /id:\s*(q-[\w-]+)/.exec(waitResult.text)?.[1];
    expect(id, `không đọc được id câu hỏi từ:\n${waitResult.text}`).toBeTruthy();
    ids.push(id!);

    const tAnswer = Date.now();
    const answered = await agent.callTool('livemcp_ask_answer', {
      questionId: id!,
      markdown: ANSWERS[i]!,
    });
    expect(answered.isError, `ask_answer lỗi: ${answered.text}`).toBe(false);

    const item = await waitAnswered(worker, id!);
    const now = Date.now();
    expect(item.answer).toBe(ANSWERS[i]!);

    timings.push({
      question: QUESTIONS[i]!,
      toAgentMs,
      toWidgetMs: now - tAnswer,
      totalMs: now - tSubmit,
    });
  }

  // Đoạn bôi đen phải thực sự đi kèm câu hỏi cuối — nếu không, đường selection
  // hỏng im lặng: agent vẫn trả lời được, chỉ là trả lời thiếu ngữ cảnh.
  const last = (await readThread(worker)).find((i) => i.id === ids[2]);
  expect(last?.selection, 'câu hỏi cuối không mang theo đoạn bôi đen').toBeTruthy();

  // Câu trả lời có VẼ RA trong closed shadow root không — chứ không chỉ "đã nhận".
  const rendered = await renderedAnswers(page);
  expect(rendered.length).toBe(QUESTIONS.length);
  expect(rendered.join('\n')).toContain('<strong>trang demo</strong>');

  const report = [
    '| # | câu hỏi | tới agent | về widget | tổng |',
    '|---|---|---|---|---|',
    ...timings.map(
      (t, i) =>
        `| ${i + 1} | ${t.question} | ${t.toAgentMs} ms | ${t.toWidgetMs} ms | ${t.totalMs} ms |`,
    ),
  ].join('\n');
  console.log(`\n${report}\n`);
  await testInfo.attach('do-tre-kenh-ask.md', { body: report, contentType: 'text/markdown' });

  await page.close();
});
