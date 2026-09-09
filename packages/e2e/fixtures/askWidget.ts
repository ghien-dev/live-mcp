import type { Page, Worker } from '@playwright/test';

/**
 * Bộ đồ nghề để lái widget kênh Ask từ bài test.
 *
 * Ba việc ở đây đều xuất phát từ một sự thật: widget sống trong shadow root
 * `mode: 'closed'`. Locator của Playwright xuyên được shadow *open*, không xuyên
 * được *closed* — nên mọi thao tác phải đi vòng qua đường khác, và mỗi hàm dưới
 * đây là một đường vòng như vậy.
 */

export interface ThreadItem {
  id: string;
  askedAt: number;
  text: string;
  selection?: string;
  status: 'waiting' | 'claimed' | 'answered';
  answer?: string;
  followups: string[];
}

/** Widget lưu hội thoại theo từng origin. */
export const threadKeyFor = (origin: string): string => `ask_thread:${origin}`;

/** Widget mount ở `document_idle`; đợi thẻ host xuất hiện ở light DOM. */
export async function waitForWidget(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector('[data-livemcp-ask]'), null, {
    timeout: 15_000,
  });
}

/**
 * Mở panel và đưa con trỏ vào ô nhập — đúng đường mà phím tắt Alt+A đi.
 *
 * Không giả lập được cú nhấn Alt+A thật (`chrome.commands` do tiến trình browser
 * xử lý, không phải renderer), nên bài test nhập vào ngay sau chặng đó: SW gửi
 * `sw_ask_open`. Mọi thứ từ đây trở đi là mã sản phẩm.
 */
export async function openPanel(page: Page, worker: Worker, url: string): Promise<void> {
  const focused = () =>
    page.evaluate(() => document.activeElement?.hasAttribute('data-livemcp-ask') === true);

  const deadline = Date.now() + 20_000;
  let lastError = '';

  // Gửi LẠI chứ không gửi một lần rồi chờ dài.
  //
  // `chrome.tabs.sendMessage` tới một MV3 service worker vừa ngủ dậy có thể rơi,
  // và widget nuốt lỗi đó (đúng như sản phẩm phải làm — không được ném lỗi vào
  // console của trang chủ nhà). Bản đầu của hàm này gửi một lần rồi chờ 10 giây,
  // nên mỗi message rơi biến thành một lần bài test đỏ ngẫu nhiên. Lưới chập
  // chờn còn hại hơn lưới đỏ: nó dạy người ta chạy lại cho tới khi xanh.
  while (Date.now() < deadline) {
    try {
      await worker.evaluate(async (target: string) => {
        const [tab] = await chrome.tabs.query({ url: target });
        if (!tab?.id) throw new Error(`không tìm thấy tab ${target}`);
        await chrome.tabs.sendMessage(tab.id, { type: 'sw_ask_open' });
      }, url);
    } catch (err) {
      lastError = String(err);
    }

    // Focus nằm trong closed shadow root, nên `document.activeElement` của trang
    // chỉ trỏ tới thẻ host — và đó chính là tín hiệu ta cần: có focus bên trong.
    for (let i = 0; i < 10; i++) {
      if (await focused()) return;
      await page.waitForTimeout(100);
    }
  }

  throw new Error(
    `panel không mở sau 20s — widget không nhận được sw_ask_open. ${lastError}`.trim(),
  );
}

/** Đọc luồng hội thoại widget đã lưu — nguồn để biết widget đã nhận được gì. */
export async function readThread(worker: Worker, key: string): Promise<ThreadItem[]> {
  return worker.evaluate(async (k: string) => {
    const s = await chrome.storage.local.get(k);
    return (s[k] as ThreadItem[]) ?? [];
  }, key);
}

/** Đợi tới khi widget ghi nhận câu trả lời cho đúng câu hỏi này. */
export async function waitAnswered(
  worker: Worker,
  key: string,
  questionId: string,
  timeoutMs = 15_000,
): Promise<ThreadItem> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const item = (await readThread(worker, key)).find((i) => i.id === questionId);
    if (item?.status === 'answered') return item;
    if (Date.now() > deadline) {
      throw new Error(`widget chưa nhận câu trả lời cho ${questionId} sau ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface CdpNode {
  nodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
}

/**
 * Đọc HTML của mọi phần tử mang class đã cho, **kể cả bên trong closed shadow root**.
 *
 * `DOM.getDocument({pierce:true})` là đường duy nhất còn lại: mã chạy trong trang
 * không thấy gì bên trong closed root, mà đó lại đúng là chỗ widget sống. Bước
 * này cũng là lý do bài test đáng chạy trên browser thật — `chrome.storage` chỉ
 * chứng minh widget *nhận* được dữ liệu, không chứng minh nó *vẽ ra*.
 */
export async function pierceHtml(page: Page, className: string): Promise<string[]> {
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
        if (attrs[i] === 'class' && String(attrs[i + 1]).split(/\s+/).includes(className)) {
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

/** Gõ một câu hỏi vào panel đang mở và gửi. Bàn phím thật, không dispatch giả. */
export async function askQuestion(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press('Control+Enter');
}
