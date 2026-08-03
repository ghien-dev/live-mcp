import { describe, expect, it } from 'vitest';
import type { ResourceDecl, ToolDecl } from '@livemcp/protocol';
import { diffTools, isEmptyDiff, resourcesDiffer } from './delta.js';

const tool = (name: string, over: Partial<ToolDecl> = {}): ToolDecl => ({
  name,
  description: `mô tả ${name}`,
  kind: 'element',
  action: 'click',
  available: true,
  ...over,
});

describe('diffTools', () => {
  it('DOM đổi mà tool list y nguyên → delta rỗng', () => {
    const before = [tool('a'), tool('b')];
    const after = [tool('a'), tool('b')];
    expect(isEmptyDiff(diffTools(before, after))).toBe(true);
  });

  it('tool mới → added, không phải changed', () => {
    const diff = diffTools([tool('a')], [tool('a'), tool('b')]);
    expect(diff.added.map((t) => t.name)).toEqual(['b']);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('tool biến mất → removed theo tên', () => {
    const diff = diffTools([tool('a'), tool('b')], [tool('a')]);
    expect(diff.removed).toEqual(['b']);
    expect(diff.added).toEqual([]);
  });

  it('cùng tên nhưng nội dung khác → changed', () => {
    const diff = diffTools([tool('a')], [tool('a', { description: 'mô tả mới' })]);
    expect(diff.changed.map((t) => t.name)).toEqual(['a']);
    expect(diff.added).toEqual([]);
  });

  it('chỉ đổi available (nút bị disabled) cũng là changed — agent cần biết', () => {
    const diff = diffTools(
      [tool('a')],
      [tool('a', { available: false, unavailableReason: 'phần tử đang bị disabled' })],
    );
    expect(diff.changed).toHaveLength(1);
  });

  it('đổi thứ tự trong DOM KHÔNG phải là thay đổi', () => {
    const diff = diffTools([tool('a'), tool('b')], [tool('b'), tool('a')]);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('thay hẳn một tool bằng tool khác → vừa added vừa removed', () => {
    const diff = diffTools([tool('a')], [tool('b')]);
    expect(diff.added.map((t) => t.name)).toEqual(['b']);
    expect(diff.removed).toEqual(['a']);
    expect(diff.changed).toEqual([]);
  });

  it('từ rỗng lên có tool — ca của dropdown vừa mở', () => {
    const diff = diffTools([], [tool('chon_danh_muc')]);
    expect(diff.added).toHaveLength(1);
    expect(isEmptyDiff(diff)).toBe(false);
  });
});

describe('resourcesDiffer', () => {
  const res = (name: string): ResourceDecl => ({ name, description: name, format: 'text' });

  it('giống nhau → false, kể cả khác thứ tự', () => {
    expect(resourcesDiffer([res('a'), res('b')], [res('b'), res('a')])).toBe(false);
  });

  it('thêm/bớt/đổi → true', () => {
    expect(resourcesDiffer([res('a')], [res('a'), res('b')])).toBe(true);
    expect(resourcesDiffer([res('a')], [])).toBe(true);
    expect(resourcesDiffer([res('a')], [{ ...res('a'), format: 'json' }])).toBe(true);
  });
});
