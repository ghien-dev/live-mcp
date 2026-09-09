import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../log.js';
import { verifyHttpRequest, type GuardOptions } from './guard.js';

/**
 * MCP Streamable HTTP — cửa cho claude.ai (kiến trúc §2.5, roadmap M7 mục 2).
 *
 * Vì sao transport này tồn tại song song với stdio thay vì thay thế nó: stdio là
 * đường của Claude Code (agent tự spawn tiến trình), HTTP là đường của claude.ai
 * (qua tunnel). Hai client, một hàng đợi. Cả hai transport nằm trong CÙNG một
 * tiến trình vì cả hai đều cần WS hub 8787, mà cổng đó chỉ một tiến trình giữ
 * được — chạy hai server là đâm thẳng vào cái bẫy EADDRINUSE mà README đã cảnh báo.
 */

/** Trần body một yêu cầu. Đủ rộng cho mọi lời gọi tool thật, đủ chặt để không ai nhồi bộ nhớ. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Đường dẫn duy nhất phục vụ MCP. Mọi thứ khác trả 404, không tiết lộ gì thêm. */
const MCP_PATH = '/mcp';

export interface HttpServerOptions extends GuardOptions {
  host: string;
  port: number;
  /**
   * Dựng một `Server` MCP MỚI cho mỗi phiên.
   *
   * Một instance `Server` chỉ nối được một transport, nên nhiều client đồng thời
   * bắt buộc phải có nhiều instance. Đây là lý do tham số là factory chứ không
   * phải một server dựng sẵn.
   */
  createMcpServer: () => McpServer;
}

export interface RunningHttpServer {
  port: number;
  close(): Promise<void>;
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: status === 401 || status === 403 ? -32001 : -32000, message },
      id: null,
    }),
  );
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Body vượt trần ${MAX_BODY_BYTES} byte.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Body không phải JSON hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

export function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  /** sessionId → transport đang phục vụ phiên đó. */
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Không có gì ở đây. Endpoint MCP là ${MCP_PATH}.\n`);
      return;
    }

    const verdict = verifyHttpRequest({ headers: req.headers }, opts);
    if (!verdict.ok) {
      // Hỏng ồn ào (N2): từ chối im lặng thì người dùng ngồi nhìn claude.ai báo
      // "không kết nối được connector" mà không có gì để lần.
      log.warn(`HTTP từ chối ${req.method} ${path}: ${verdict.message}`);
      jsonRpcError(res, verdict.status, verdict.message);
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }

    // GET (mở SSE) và DELETE (đóng phiên) đều phải kèm session hợp lệ — tới đây
    // nghĩa là session đã hết hạn hoặc server vừa khởi động lại.
    if (req.method !== 'POST') {
      jsonRpcError(
        res,
        404,
        sessionId
          ? 'Phiên MCP không còn tồn tại (server đã khởi động lại?). Hãy initialize lại.'
          : 'Thiếu header mcp-session-id.',
      );
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      jsonRpcError(res, 400, err instanceof Error ? err.message : String(err));
      return;
    }

    if (sessionId) {
      jsonRpcError(res, 404, 'Phiên MCP không còn tồn tại. Hãy initialize lại.');
      return;
    }
    if (!isInitializeRequest(body)) {
      jsonRpcError(res, 400, 'Yêu cầu không kèm session và cũng không phải initialize.');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
        log.info(`HTTP phiên MCP mới: ${id.slice(0, 8)}… (đang có ${transports.size})`);
      },
    });

    const server = opts.createMcpServer();
    // Dọn theo transport chứ không theo server: transport là thứ biết phiên đã
    // đóng (client gửi DELETE, hoặc kết nối đứt). Không gỡ khỏi map ở đây thì mỗi
    // lần claude.ai nối lại là một phiên chết nằm lại trong bộ nhớ, kèm theo cả
    // listener `store.onChange` mà nó giữ.
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) transports.delete(id);
      void server.close().catch(() => {});
      log.info(`HTTP phiên MCP đóng${id ? ` ${id.slice(0, 8)}…` : ''} (còn ${transports.size})`);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const http: NodeHttpServer = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log.error('HTTP lỗi không bắt được:', err);
      if (!res.headersSent) jsonRpcError(res, 500, 'Lỗi nội bộ server.');
      else res.end();
    });
  });

  return new Promise<RunningHttpServer>((resolve, reject) => {
    http.on('error', reject);
    http.listen(opts.port, opts.host, () => {
      http.removeListener('error', reject);
      const addr = http.address();
      resolve({
        // Cổng THẬT, không phải cổng đã yêu cầu: `--http-port 0` để OS tự chọn,
        // và test cần biết nó chọn cái nào.
        port: typeof addr === 'object' && addr ? addr.port : opts.port,
        async close() {
          for (const t of transports.values()) await t.close().catch(() => {});
          transports.clear();
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
