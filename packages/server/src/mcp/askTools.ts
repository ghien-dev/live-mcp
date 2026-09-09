import {
  ASK_CLAIM_TTL_MS,
  ASK_DEFAULT_WAIT_MS,
  ASK_MAX_WAIT_MS,
} from '@livemcp/protocol';
import type { AskQuestion, AskStore } from '../store/ask.js';
import type { McpToolShape } from '../parser/tools.js';
import { scrubWebText, toAgentText } from './agentText.js';

/**
 * Kênh Ask nhìn từ phía agent (docs/livemcp-architecture.md §6.4).
 *
 * Bốn tool, và cái quan trọng nhất là `livemcp_ask_wait` **chặn**. Bản trả về
 * ngay lập tức buộc người dùng phải giục agent từng lượt một; bản chặn biến việc
 * đó thành một vòng lặp agent tự chạy. Khuôn mẫu chặn lấy nguyên từ
 * `systemTools.ts` (`waitForTool`): nghe `store.onChange` chứ không polling, vì
 * mọi thay đổi đều đã đi qua đó rồi.
 */

export const ASK_TOOL_PREFIX = 'livemcp_ask_';

/** Trần số câu hỏi trả về một lượt — giữ cho một lượt agent không bị ngập. */
const MAX_BATCH = 5;

export const askToolShapes: McpToolShape[] = [
  {
    name: 'livemcp_ask_wait',
    description:
      'ĐỢI cho tới khi người dùng gửi câu hỏi từ widget trợ lý trên trình duyệt, rồi nhận ' +
      'các câu hỏi đó về. Tool này CHẶN — nó không trả về ngay, mà nằm chờ tới khi có câu ' +
      'hỏi hoặc hết thời gian. Đó là chủ ý: gọi lại tool này ngay sau mỗi lần trả lời để ' +
      'tạo thành vòng lặp trực. Câu hỏi nhận được đã bị "nhận" (claim) cho phiên này nên ' +
      'phiên khác không trả lời trùng — nhận rồi thì phải trả lời bằng livemcp_ask_answer, ' +
      `nếu không sau ${Math.round(ASK_CLAIM_TTL_MS / 1000)}s nó sẽ quay lại hàng đợi. ` +
      'Hết thời gian mà không có câu hỏi nào là chuyện BÌNH THƯỜNG, không phải lỗi — cứ gọi lại.',
    inputSchema: {
      type: 'object',
      properties: {
        maxWaitMs: {
          type: 'number',
          description: `Thời gian chặn tối đa, ms. Mặc định ${ASK_DEFAULT_WAIT_MS}, trần ${ASK_MAX_WAIT_MS}.`,
        },
        limit: {
          type: 'number',
          description: `Số câu hỏi nhận tối đa một lượt. Mặc định 3, trần ${MAX_BATCH}.`,
        },
      },
    },
  },
  {
    name: 'livemcp_ask_list',
    description:
      'Xem hàng đợi câu hỏi mà KHÔNG chặn và KHÔNG nhận. Dùng để nắm tình hình hoặc gỡ rối. ' +
      'Muốn thực sự trả lời thì dùng livemcp_ask_wait.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'claimed', 'answered', 'all'],
          description: 'Lọc theo trạng thái. Mặc định "all".',
        },
      },
    },
  },
  {
    name: 'livemcp_ask_answer',
    description:
      'Gửi câu trả lời về đúng tab đã hỏi; widget sẽ hiện ngay cho người dùng. ' +
      'Viết bằng Markdown. Trả lời xong hãy gọi lại livemcp_ask_wait để chờ câu tiếp theo.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: {
          type: 'string',
          description: 'Id lấy từ kết quả livemcp_ask_wait.',
        },
        markdown: {
          type: 'string',
          description: 'Nội dung trả lời, Markdown.',
        },
      },
      required: ['questionId', 'markdown'],
    },
  },
  {
    name: 'livemcp_ask_followup',
    description:
      'Hỏi ngược người dùng khi câu hỏi thiếu ngữ cảnh để trả lời cho đúng. ' +
      'Câu hỏi vẫn thuộc về bạn và hạn giữ được gia hạn. Người dùng trả lời bằng một ' +
      'câu hỏi mới trong cùng cuộc trò chuyện — gọi lại livemcp_ask_wait để nhận.',
    inputSchema: {
      type: 'object',
      properties: {
        questionId: { type: 'string', description: 'Id câu hỏi đang xử lý.' },
        text: { type: 'string', description: 'Điều bạn cần người dùng làm rõ.' },
      },
      required: ['questionId', 'text'],
    },
  },
];

const ASK_TOOL_NAMES = new Set(askToolShapes.map((t) => t.name));

export function isAskTool(name: string): boolean {
  return ASK_TOOL_NAMES.has(name);
}

/**
 * Một câu hỏi trình bày cho agent.
 *
 * Mọi trường ở đây đều đến từ trang web hoặc từ ô nhập của người dùng trên trang
 * — tức là **dữ liệu không tin được**. Đi qua đúng một cửa `agentText.ts` như
 * mọi text web khác, và bọc nhãn nguồn để ranh giới hiện rõ trong context.
 */
function formatQuestion(q: AskQuestion): string {
  const host = safeHost(q.url);
  const parts = [
    `id: ${q.id}`,
    `trang: ${scrubWebText(q.title, 200)} — ${scrubWebText(q.url, 500)}`,
    '',
    'CÂU HỎI CỦA NGƯỜI DÙNG:',
    scrubWebText(q.text, 4_000),
  ];
  if (q.selection?.trim()) {
    parts.push('', 'ĐOẠN NGƯỜI DÙNG BÔI ĐEN TRÊN TRANG:', scrubWebText(q.selection, 2_000));
  }
  if (q.followups.length) {
    parts.push(
      '',
      `Bạn đã hỏi lại ${q.followups.length} lần trước đó: ` +
        q.followups.map((f) => `"${scrubWebText(f, 300)}"`).join(' · '),
    );
  }
  return toAgentText(parts.join('\n'), { source: host, limit: 8_000 });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host || 'trang không rõ';
  } catch {
    return 'trang không rõ';
  }
}

/**
 * Chặn tới khi claim được câu hỏi, hoặc hết giờ.
 *
 * Nghe `onChange` thay vì polling — cùng lý do với `waitForTool`: mọi thay đổi
 * hàng đợi đều đã đi qua đó, thêm vòng polling là thêm một nguồn sự thật thứ hai
 * chạy lệch nhịp với nguồn thứ nhất.
 */
function waitForQuestions(
  store: AskStore,
  limit: number,
  timeoutMs: number,
): Promise<AskQuestion[]> {
  const first = store.claim(limit);
  if (first.length > 0) return Promise.resolve(first);

  return new Promise<AskQuestion[]>((resolve) => {
    let finished = false;

    const finish = (questions: AskQuestion[]) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(questions);
    };

    const timer = setTimeout(() => finish([]), timeoutMs);

    const unsubscribe = store.onChange(() => {
      if (finished) return;
      const taken = store.claim(limit);
      if (taken.length > 0) finish(taken);
    });
  });
}

export async function callAskTool(
  name: string,
  args: Record<string, unknown>,
  store: AskStore,
): Promise<string> {
  switch (name) {
    case 'livemcp_ask_wait': {
      const rawWait = typeof args.maxWaitMs === 'number' ? args.maxWaitMs : ASK_DEFAULT_WAIT_MS;
      const timeoutMs = Math.min(Math.max(rawWait, 1_000), ASK_MAX_WAIT_MS);
      const rawLimit = typeof args.limit === 'number' ? args.limit : 3;
      const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_BATCH);

      const questions = await waitForQuestions(store, limit, timeoutMs);
      if (questions.length === 0) {
        return (
          `Không có câu hỏi nào trong ${Math.round(timeoutMs / 1000)} giây vừa rồi. ` +
          'Đây là trạng thái bình thường, không phải lỗi. ' +
          'Gọi lại livemcp_ask_wait để tiếp tục trực, hoặc dừng nếu người dùng đã bảo dừng.'
        );
      }

      const header =
        questions.length === 1
          ? 'Có 1 câu hỏi mới. Trả lời bằng livemcp_ask_answer với đúng id bên dưới.'
          : `Có ${questions.length} câu hỏi mới. Trả lời TỪNG câu bằng livemcp_ask_answer ` +
            'với đúng id của nó.';
      return [header, '', ...questions.map(formatQuestion)].join('\n');
    }

    case 'livemcp_ask_list': {
      store.sweep();
      const filter = typeof args.status === 'string' ? args.status : 'all';
      const all = store.list();
      const rows = filter === 'all' ? all : all.filter((q) => q.status === filter);
      if (rows.length === 0) {
        return filter === 'all'
          ? 'Hàng đợi trống — chưa có câu hỏi nào từ trình duyệt.'
          : `Không có câu hỏi nào ở trạng thái "${filter}".`;
      }
      return rows
        .map((q) => {
          const age = Math.round((Date.now() - q.askedAt) / 1000);
          const preview = scrubWebText(q.text, 100).replace(/\s+/g, ' ');
          return (
            `• ${q.id} · ${q.status}${q.status === 'answered' && !q.delivered ? ' (chưa giao được tới widget)' : ''}` +
            ` · ${age}s trước · tab ${q.tabId} · ${safeHost(q.url)}\n  "${preview}"`
          );
        })
        .join('\n');
    }

    case 'livemcp_ask_answer': {
      const questionId = typeof args.questionId === 'string' ? args.questionId.trim() : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown : '';
      if (!questionId) return 'Thiếu tham số bắt buộc "questionId".';

      const err = store.answer(questionId, markdown);
      if (err) return err;
      return `Đã gửi câu trả lời cho ${questionId}. Gọi livemcp_ask_wait để chờ câu tiếp theo.`;
    }

    case 'livemcp_ask_followup': {
      const questionId = typeof args.questionId === 'string' ? args.questionId.trim() : '';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!questionId) return 'Thiếu tham số bắt buộc "questionId".';

      const err = store.followup(questionId, text);
      if (err) return err;
      return (
        `Đã gửi câu hỏi lại tới người dùng ở tab của ${questionId}. ` +
        'Họ sẽ trả lời bằng một câu hỏi mới — gọi livemcp_ask_wait để nhận.'
      );
    }

    default:
      return `Tool kênh Ask không tồn tại: ${name}`;
  }
}
