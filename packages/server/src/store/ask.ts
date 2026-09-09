import {
  ASK_CLAIM_TTL_MS,
  ASK_MAX_QUESTIONS,
  ASK_RETENTION_MS,
  type AskQuestionMsg,
  type AskStatus,
} from '@livemcp/protocol';
import { log } from '../log.js';

/**
 * Một câu hỏi người dùng gửi từ widget trên một trang bất kỳ.
 *
 * Vì sao kho này TÁCH khỏi `SessionStore`: `SessionStore` khoá theo site có khai
 * báo `<meta name="livemcp">` và nuôi registry tool động. Kênh Ask chạy trên MỌI
 * trang, kể cả trang không biết Live MCP tồn tại. Trộn hai thứ sẽ kéo tool list
 * thay đổi theo mỗi câu hỏi — tức là phá đúng phần đang chạy đúng.
 */
export interface AskQuestion {
  id: string;
  tabId: number;
  url: string;
  title: string;
  text: string;
  selection?: string;
  askedAt: number;
  status: AskStatus;
  claimedAt?: number;
  answer?: string;
  answeredAt?: number;
  /** Widget đã xác nhận hiển thị chưa. Tách khỏi `status` — xem AskStatus. */
  delivered: boolean;
  /** Câu hỏi ngược từ agent, theo thứ tự. */
  followups: string[];
}

export type AskEvent =
  | { type: 'claimed'; question: AskQuestion }
  | { type: 'answered'; question: AskQuestion }
  | { type: 'followup'; question: AskQuestion; text: string }
  | { type: 'released'; question: AskQuestion };

export interface AskStoreOptions {
  /** Đồng hồ tiêm được để test không phải ngủ thật. */
  now?: () => number;
  claimTtlMs?: number;
  retentionMs?: number;
  maxQuestions?: number;
}

export class AskStore {
  private readonly questions = new Map<string, AskQuestion>();
  private readonly listeners = new Set<() => void>();
  /** Bên đẩy message xuống extension. Gắn ở index.ts sau khi bridge dựng xong. */
  private emitter: ((event: AskEvent) => void) | null = null;

  private readonly now: () => number;
  private readonly claimTtlMs: number;
  private readonly retentionMs: number;
  private readonly maxQuestions: number;

  /**
   * Đang chạy vòng thông báo. `emitChange` gọi lại từ trong listener (chuyện xảy
   * ra thật: long-poll nghe onChange rồi claim ngay trong listener, mà claim lại
   * emitChange) sẽ đệ quy vào chính Set đang duyệt. Cờ này gộp lần gọi lồng
   * thành một lần chạy tiếp theo.
   */
  private notifying = false;
  private notifyAgain = false;

  constructor(opts: AskStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.claimTtlMs = opts.claimTtlMs ?? ASK_CLAIM_TTL_MS;
    this.retentionMs = opts.retentionMs ?? ASK_RETENTION_MS;
    this.maxQuestions = opts.maxQuestions ?? ASK_MAX_QUESTIONS;
  }

  /** Gắn kênh đẩy xuống extension. Gọi một lần lúc khởi động. */
  setEmitter(fn: (event: AskEvent) => void): void {
    this.emitter = fn;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    if (this.notifying) {
      this.notifyAgain = true;
      return;
    }
    this.notifying = true;
    try {
      do {
        this.notifyAgain = false;
        for (const fn of [...this.listeners]) fn();
      } while (this.notifyAgain);
    } finally {
      this.notifying = false;
      this.notifyAgain = false;
    }
  }

  private emitEvent(event: AskEvent): void {
    this.emitter?.(event);
  }

  // -------------------------------------------------------------------------
  // Phía người dùng (extension → server)
  // -------------------------------------------------------------------------

  add(msg: AskQuestionMsg): AskQuestion {
    // Widget gửi lại cùng questionId khi mạng chập chờn — coi là cùng một câu
    // hỏi, không phải câu thứ hai. Trả lại bản đang có để agent không thấy trùng.
    const existing = this.questions.get(msg.questionId);
    if (existing) return existing;

    const question: AskQuestion = {
      id: msg.questionId,
      tabId: msg.tabId,
      url: msg.url,
      title: msg.title,
      text: msg.text,
      selection: msg.selection,
      askedAt: msg.ts || this.now(),
      status: 'pending',
      delivered: false,
      followups: [],
    };
    this.questions.set(question.id, question);
    this.evict();
    log.info(`ask_question tab=${msg.tabId} id=${question.id}`);
    this.emitChange();
    return question;
  }

  /** Người dùng rút lại câu hỏi. Đã trả lời rồi thì thôi, giữ nguyên. */
  cancel(questionId: string): boolean {
    const q = this.questions.get(questionId);
    if (!q || q.status === 'answered') return false;
    this.questions.delete(questionId);
    log.info(`ask_cancel   id=${questionId}`);
    this.emitChange();
    return true;
  }

  markDelivered(questionId: string): void {
    const q = this.questions.get(questionId);
    if (!q || q.delivered) return;
    q.delivered = true;
    this.emitChange();
  }

  /**
   * Widget khởi động lại → phần chưa giao của đúng tab & đúng URL.
   *
   * Kiểm cả URL chứ không chỉ tabId: Chrome tái sử dụng tabId sau khi tab đóng,
   * và giao câu trả lời của trang cũ vào một trang hoàn toàn khác là kiểu lỗi
   * vừa khó hiểu vừa rò rỉ.
   */
  undeliveredFor(tabId: number, url: string): AskQuestion[] {
    return this.list().filter(
      (q) => q.tabId === tabId && q.url === url && q.status === 'answered' && !q.delivered,
    );
  }

  // -------------------------------------------------------------------------
  // Phía agent (MCP tool)
  // -------------------------------------------------------------------------

  list(): AskQuestion[] {
    return [...this.questions.values()].sort((a, b) => a.askedAt - b.askedAt);
  }

  get(id: string): AskQuestion | undefined {
    return this.questions.get(id);
  }

  pending(): AskQuestion[] {
    this.sweep();
    return this.list().filter((q) => q.status === 'pending');
  }

  /**
   * Lấy tối đa `limit` câu hỏi đang chờ và đánh dấu đã nhận.
   *
   * Claim chứ không chỉ đọc: hai phiên agent cùng gọi `ask_wait` mà không claim
   * sẽ trả lời trùng nhau, và người dùng nhận hai câu trả lời cho một câu hỏi.
   */
  claim(limit: number): AskQuestion[] {
    const taken = this.pending().slice(0, Math.max(1, limit));
    if (taken.length === 0) return [];

    const at = this.now();
    for (const q of taken) {
      q.status = 'claimed';
      q.claimedAt = at;
      this.emitEvent({ type: 'claimed', question: q });
    }
    log.info(`ask_claim    ${taken.map((q) => q.id).join(', ')}`);
    this.emitChange();
    return taken;
  }

  /** Trả lời. Trả về thông báo lỗi nếu không trả lời được, `null` nếu xong. */
  answer(questionId: string, markdown: string): string | null {
    this.sweep();
    const q = this.questions.get(questionId);
    if (!q) {
      return (
        `Không có câu hỏi nào mang id "${questionId}". ` +
        'Có thể người dùng đã rút lại, hoặc câu hỏi đã quá cũ và bị dọn. ' +
        'Gọi livemcp_ask_list để xem hàng đợi hiện tại.'
      );
    }
    if (q.status === 'answered') {
      return `Câu hỏi "${questionId}" đã được trả lời rồi — không gửi lại lần hai.`;
    }
    if (!markdown.trim()) {
      return 'Câu trả lời rỗng. Hãy viết nội dung trước khi gọi livemcp_ask_answer.';
    }

    q.status = 'answered';
    q.answer = markdown;
    q.answeredAt = this.now();
    q.delivered = false;
    log.info(`ask_answer   id=${questionId} (${markdown.length} ký tự)`);
    this.emitEvent({ type: 'answered', question: q });
    this.emitChange();
    return null;
  }

  /** Agent hỏi ngược. Không đổi trạng thái — câu hỏi vẫn thuộc về agent đang giữ. */
  followup(questionId: string, text: string): string | null {
    const q = this.questions.get(questionId);
    if (!q) return `Không có câu hỏi nào mang id "${questionId}".`;
    if (q.status === 'answered') {
      return `Câu hỏi "${questionId}" đã kết thúc — không hỏi thêm được nữa.`;
    }
    if (!text.trim()) return 'Nội dung hỏi lại đang rỗng.';

    q.followups.push(text);
    // Người dùng cần thời gian đọc và gõ trả lời → gia hạn claim, nếu không câu
    // hỏi hết hạn ngay giữa lúc đôi bên đang trao đổi.
    q.claimedAt = this.now();
    this.emitEvent({ type: 'followup', question: q, text });
    this.emitChange();
    return null;
  }

  // -------------------------------------------------------------------------
  // Dọn dẹp
  // -------------------------------------------------------------------------

  /**
   * Trả claim quá hạn về hàng đợi và dọn câu hỏi đã xong từ lâu.
   *
   * Gọi được nhiều lần vô hại. `index.ts` chạy định kỳ để một `ask_wait` đang
   * chặn được đánh thức khi claim của phiên khác hết hạn — nếu chỉ dọn lười lúc
   * đọc thì câu hỏi đó nằm im cho tới khi có người gọi tool tiếp theo.
   */
  sweep(): void {
    const at = this.now();
    let changed = false;

    for (const q of this.questions.values()) {
      if (q.status === 'claimed' && at - (q.claimedAt ?? 0) > this.claimTtlMs) {
        q.status = 'pending';
        q.claimedAt = undefined;
        log.warn(`ask_release  id=${q.id} — phiên agent giữ quá ${this.claimTtlMs}ms`);
        this.emitEvent({ type: 'released', question: q });
        changed = true;
      }
    }

    for (const q of [...this.questions.values()]) {
      const done = q.status === 'answered' && q.delivered;
      if (done && at - (q.answeredAt ?? 0) > this.retentionMs) {
        this.questions.delete(q.id);
        changed = true;
      }
    }

    if (changed) this.emitChange();
  }

  /** Vượt trần → bỏ cái cũ nhất đã giao xong; không bao giờ bỏ câu đang chờ. */
  private evict(): void {
    if (this.questions.size <= this.maxQuestions) return;
    const disposable = this.list().filter((q) => q.status === 'answered' && q.delivered);
    for (const q of disposable) {
      if (this.questions.size <= this.maxQuestions) break;
      this.questions.delete(q.id);
    }
    if (this.questions.size > this.maxQuestions) {
      log.warn(
        `hàng đợi Ask đang giữ ${this.questions.size} câu hỏi, vượt trần ${this.maxQuestions} ` +
          'mà không có câu nào dọn được — nhiều khả năng không có phiên agent nào đang nghe.',
      );
    }
  }
}
