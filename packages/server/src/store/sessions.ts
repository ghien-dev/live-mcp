import {
  slugifyApp,
  type DeclarativeDeltaMsg,
  type DeclarativeSnapshotMsg,
  type ResourceDecl,
  type SiteAnnounceMsg,
  type ToolDecl,
} from '@livemcp/protocol';
import { log } from '../log.js';

/**
 * Một tab chuẩn Live MCP đang mở = một namespace tool (docs/livemcp-architecture.md §2.4).
 */
export interface SiteSession {
  tabId: number;
  /** Lần load trang hiện tại. Message mang pageId khác = tàn dư của trang cũ. */
  pageId: string;
  url: string;
  app: string;
  /** Namespace duy nhất, ví dụ 'shopviet' → tool 'shopviet__add_to_cart'. */
  namespace: string;
  description: string;
  specVersion: string;
  tools: Map<string, ToolDecl>;
  resources: Map<string, ResourceDecl>;
  /** seq lớn nhất đã nhận của tab này; message cũ hơn bị bỏ (§6.2). */
  lastSeq: number;
}

/**
 * Kho phiên. Nguồn sự thật duy nhất về "agent đang nhìn thấy tool gì".
 * Mọi thay đổi phát `onChange` để lớp MCP bắn `notifications/tools/list_changed`.
 */
export class SessionStore {
  private readonly sessions = new Map<number, SiteSession>();
  private readonly listeners = new Set<() => void>();

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  list(): SiteSession[] {
    return [...this.sessions.values()];
  }

  get(tabId: number): SiteSession | undefined {
    return this.sessions.get(tabId);
  }

  findByNamespace(namespace: string): SiteSession | undefined {
    return this.list().find((s) => s.namespace === namespace);
  }

  /**
   * Tìm namespace theo tên app hoặc namespace (agent có thể gọi cách nào cũng được).
   */
  resolveSite(hint: string): SiteSession | undefined {
    const needle = hint.trim().toLowerCase();
    return (
      this.findByNamespace(needle) ??
      this.list().find((s) => s.app.toLowerCase() === needle) ??
      this.list().find((s) => s.url.toLowerCase().includes(needle))
    );
  }

  /** Namespace chưa bị tab khác chiếm; đụng độ → thêm hậu tố _2, _3... (§9). */
  private allocateNamespace(app: string, tabId: number): string {
    const base = slugifyApp(app);
    let candidate = base;
    let n = 1;
    while (this.list().some((s) => s.namespace === candidate && s.tabId !== tabId)) {
      n += 1;
      candidate = `${base}_${n}`;
    }
    return candidate;
  }

  announce(msg: SiteAnnounceMsg): SiteSession {
    const existing = this.sessions.get(msg.tabId);
    const namespace = existing?.app === msg.app
      ? existing.namespace
      : this.allocateNamespace(msg.app, msg.tabId);

    const session: SiteSession = {
      tabId: msg.tabId,
      pageId: msg.pageId,
      url: msg.url,
      app: msg.app,
      namespace,
      description: msg.description,
      specVersion: msg.specVersion,
      // Navigation trong cùng tab = phiên mới: tool cũ phải bay hết, chờ snapshot mới.
      tools: new Map(),
      resources: new Map(),
      lastSeq: 0,
    };
    this.sessions.set(msg.tabId, session);
    log.info(`site_announce  tab=${msg.tabId}  ns=${namespace}  ${msg.url}`);
    this.emitChange();
    return session;
  }

  /**
   * Message có thuộc về lần load trang đang hiện hành không?
   *
   * Kiểm pageId TRƯỚC seq, vì hai điều kiện này bắt hai chuyện khác nhau:
   * pageId bắt "của trang khác", seq bắt "cũ hơn trong cùng trang". Đảo thứ tự
   * là sai: delta trễ của trang cũ có seq lớn hơn seq của trang mới.
   */
  private isStale(msg: { tabId: number; pageId: string; seq: number }, kind: string): boolean {
    const session = this.sessions.get(msg.tabId);
    if (!session) return true;
    if (msg.pageId !== session.pageId) {
      log.warn(
        `bỏ ${kind} của lần load trang đã cũ  tab=${msg.tabId} ` +
          `pageId=${msg.pageId.slice(0, 8)}… (đang dùng ${session.pageId.slice(0, 8)}…)`,
      );
      return true;
    }
    if (msg.seq <= session.lastSeq) {
      log.warn(`bỏ ${kind} cũ tab=${msg.tabId} seq=${msg.seq} <= ${session.lastSeq}`);
      return true;
    }
    return false;
  }

  applySnapshot(msg: DeclarativeSnapshotMsg): void {
    const session = this.sessions.get(msg.tabId);
    if (!session) {
      log.warn(`snapshot cho tab lạ ${msg.tabId} — bỏ qua (chưa có site_announce)`);
      return;
    }
    if (this.isStale(msg, 'snapshot')) return;
    session.lastSeq = msg.seq;
    session.tools = new Map(msg.tools.map((t) => [t.name, t]));
    session.resources = new Map(msg.resources.map((r) => [r.name, r]));
    log.info(
      `snapshot     tab=${msg.tabId}  seq=${msg.seq}  ` +
        `tools=${session.tools.size}  resources=${session.resources.size}`,
    );
    this.emitChange();
  }

  applyDelta(msg: DeclarativeDeltaMsg): void {
    const session = this.sessions.get(msg.tabId);
    if (!session) return;
    if (this.isStale(msg, 'delta')) return;
    session.lastSeq = msg.seq;
    for (const name of msg.removed) session.tools.delete(name);
    for (const tool of [...msg.added, ...msg.changed]) session.tools.set(tool.name, tool);
    log.info(
      `delta        tab=${msg.tabId}  seq=${msg.seq}  ` +
        `+${msg.added.length} -${msg.removed.length} ~${msg.changed.length}`,
    );
    this.emitChange();
  }

  remove(tabId: number): void {
    if (this.sessions.delete(tabId)) {
      log.info(`site_gone    tab=${tabId}`);
      this.emitChange();
    }
  }

  /** Extension mất kết nối quá grace period → gỡ toàn bộ phiên. */
  clear(): void {
    if (this.sessions.size === 0) return;
    this.sessions.clear();
    log.info('xoá toàn bộ phiên (extension mất kết nối)');
    this.emitChange();
  }
}
