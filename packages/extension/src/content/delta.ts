import type { ResourceDecl, ToolDecl } from '@livemcp/protocol';

/**
 * So sánh hai lần quét declarative để ra `declarative_delta` (M2).
 *
 * Vì sao tách thành module thuần logic: đây là chỗ quyết định agent **nhìn thấy
 * gì**, và nó sai rất lặng lẽ — một tool bị xếp nhầm vào `changed` thay vì
 * `added` thì mọi thứ vẫn chạy, chỉ là agent không được báo có tool mới. Không
 * có test thì lỗi kiểu đó sống rất lâu (nguyên tắc N2).
 *
 * Nguyên tắc dẫn đường của cả module: **báo khi TOOL LIST đổi, không phải khi
 * DOM đổi.** Trang React re-render liên tục sinh hàng trăm mutation mà tool list
 * không đổi chút nào; báo theo DOM sẽ làm ngộp agent bằng `list_changed` rỗng.
 */

export interface ToolDiff {
  added: ToolDecl[];
  /** Tên tool đã biến mất. */
  removed: string[];
  changed: ToolDecl[];
}

/**
 * Dấu vân tay nội dung của một khai báo.
 *
 * Dùng `JSON.stringify` được vì mọi `ToolDecl` đều do `scanner.ts` dựng từ cùng
 * một object literal, nên thứ tự khoá là tất định. Nếu về sau có đường sinh
 * `ToolDecl` thứ hai thì giả định này gãy — và gãy im lặng, nên ghi ra đây.
 */
function fingerprint(decl: ToolDecl | ResourceDecl): string {
  return JSON.stringify(decl);
}

export function diffTools(prev: readonly ToolDecl[], next: readonly ToolDecl[]): ToolDiff {
  const before = new Map(prev.map((t) => [t.name, t]));
  const after = new Map(next.map((t) => [t.name, t]));

  const added: ToolDecl[] = [];
  const changed: ToolDecl[] = [];
  for (const [name, decl] of after) {
    const old = before.get(name);
    if (!old) {
      added.push(decl);
      continue;
    }
    if (fingerprint(old) !== fingerprint(decl)) changed.push(decl);
  }

  const removed: string[] = [];
  for (const name of before.keys()) {
    if (!after.has(name)) removed.push(name);
  }

  return { added, removed, changed };
}

export function isEmptyDiff(diff: ToolDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

/**
 * Resource đổi thì KHÔNG gửi delta — `declarative_delta` của protocol chỉ chở
 * tool. Trả `true` để lớp gọi phát nguyên một snapshot thay thế: hiếm khi xảy
 * ra, và một snapshot thừa rẻ hơn nhiều so với một nhánh giao thức mới.
 */
export function resourcesDiffer(
  prev: readonly ResourceDecl[],
  next: readonly ResourceDecl[],
): boolean {
  if (prev.length !== next.length) return true;
  const before = prev.map(fingerprint).sort();
  const after = next.map(fingerprint).sort();
  return before.some((v, i) => v !== after[i]);
}
