import { describe, expect, it } from 'vitest';
import type {
  DeclarativeDeltaMsg,
  DeclarativeSnapshotMsg,
  SiteAnnounceMsg,
  ToolDecl,
} from '@livemcp/protocol';
import { SessionStore } from './sessions.js';

/**
 * Race sau điều hướng (kiến trúc §6.2) — lớp lỗi hỏng im lặng đúng nghĩa:
 * tool của trang CŨ lẻn vào phiên trang MỚI, agent thấy một tool trông hợp lệ
 * rồi gọi vào hư không. Không log, không lỗi, không có gì để lần.
 *
 * Kiến trúc gốc chống race này bằng `seq` tăng dần. Giả định đó **không đứng
 * được**: `seq` sống trong content script, mà content script chết theo mỗi lần
 * điều hướng nên trang mới đếm lại từ 0 — delta trễ của trang cũ (seq=7) luôn
 * lớn hơn seq của trang mới (seq=1). Các bài dưới đây khoá lại `pageId`, thứ
 * phân biệt được "của trang khác" với "cũ hơn trong cùng trang".
 */

const TAB = 42;

const tool = (name: string): ToolDecl => ({
  name,
  description: name,
  kind: 'element',
  action: 'click',
  available: true,
});

const announce = (pageId: string, url: string): SiteAnnounceMsg => ({
  type: 'site_announce',
  tabId: TAB,
  pageId,
  url,
  app: 'Demo',
  description: 'demo',
  specVersion: '0',
});

const snapshot = (pageId: string, seq: number, names: string[]): DeclarativeSnapshotMsg => ({
  type: 'declarative_snapshot',
  tabId: TAB,
  pageId,
  seq,
  tools: names.map(tool),
  resources: [],
});

const delta = (pageId: string, seq: number, added: string[]): DeclarativeDeltaMsg => ({
  type: 'declarative_delta',
  tabId: TAB,
  pageId,
  seq,
  added: added.map(tool),
  removed: [],
  changed: [],
});

const toolNames = (store: SessionStore): string[] =>
  [...(store.get(TAB)?.tools.keys() ?? [])].sort();

describe('race sau điều hướng', () => {
  it('delta trễ của trang CŨ không được lọt vào phiên trang MỚI', () => {
    const store = new SessionStore();

    store.announce(announce('page-1', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-1', 1, ['tool_cua_trang_cu']));
    expect(toolNames(store)).toEqual(['tool_cua_trang_cu']);

    // Điều hướng: trang mới, pageId mới, và seq ĐẾM LẠI TỪ ĐẦU.
    store.announce(announce('page-2', 'https://a.example/two'));
    store.applySnapshot(snapshot('page-2', 1, ['tool_cua_trang_moi']));

    // Delta của trang cũ về muộn. seq=7 của nó LỚN HƠN seq=1 của trang mới,
    // nên kiểm bằng seq sẽ cho lọt — đây chính là chỗ `seq` một mình thất bại.
    store.applyDelta(delta('page-1', 7, ['ma_cua_trang_cu']));

    expect(toolNames(store)).toEqual(['tool_cua_trang_moi']);
  });

  it('snapshot trễ của trang cũ cũng không ghi đè được', () => {
    const store = new SessionStore();
    store.announce(announce('page-1', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-1', 1, ['cu']));

    store.announce(announce('page-2', 'https://a.example/two'));
    store.applySnapshot(snapshot('page-2', 1, ['moi']));

    store.applySnapshot(snapshot('page-1', 99, ['cu_a', 'cu_b']));
    expect(toolNames(store)).toEqual(['moi']);
  });

  it('delta HỢP LỆ của trang hiện tại vẫn phải được áp — đừng chặn nhầm', () => {
    const store = new SessionStore();
    store.announce(announce('page-1', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-1', 1, ['goc']));

    store.applyDelta(delta('page-1', 2, ['moi_sinh']));
    expect(toolNames(store)).toEqual(['goc', 'moi_sinh']);
  });

  it('trong CÙNG một trang, seq vẫn chặn được message về sai thứ tự', () => {
    const store = new SessionStore();
    store.announce(announce('page-1', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-1', 5, ['goc']));

    // seq=3 < 5: message này rời hàng đợi muộn hơn nhưng mang trạng thái cũ hơn.
    store.applyDelta(delta('page-1', 3, ['den_muon']));
    expect(toolNames(store)).toEqual(['goc']);
  });

  it('reload cùng URL vẫn là một lần load khác — pageId phải khác nhau', () => {
    const store = new SessionStore();
    store.announce(announce('page-1', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-1', 1, ['truoc_reload']));

    store.announce(announce('page-2', 'https://a.example/one'));
    store.applySnapshot(snapshot('page-2', 1, ['sau_reload']));
    store.applyDelta(delta('page-1', 9, ['tan_du']));

    expect(toolNames(store)).toEqual(['sau_reload']);
  });
});
