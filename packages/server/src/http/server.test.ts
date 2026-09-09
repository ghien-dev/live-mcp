import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ExtensionBridge } from '../bridge/hub.js';
import { AskStore } from '../store/ask.js';
import { SessionStore } from '../store/sessions.js';
import { createMcpServer } from '../mcp/server.js';
import { startHttpServer, type RunningHttpServer } from './server.js';

/**
 * Một bài đi hết đường HTTP bằng chính client MCP thật.
 *
 * Vì sao đáng công dựng cả server thật thay vì mock: A3 là lớp mà mọi lỗi đều
 * hiện ra ở phía người dùng dưới đúng một câu — claude.ai báo "không kết nối
 * được connector" — và không nói gì thêm. Sai `Accept`, sai vòng đời session,
 * sai chỗ đặt cửa xác thực đều cho ra cùng một triệu chứng đó. Bài test này
 * biến "connector không chạy" thành một dòng lỗi cụ thể, ngay trên máy, không
 * cần tunnel và không cần trình duyệt.
 */

const TOKEN = 'test-http-token';

let running: RunningHttpServer | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {});
  await running?.close();
  running = null;
});

/** Bridge chỉ được dùng khi gọi tool của SITE; các bài dưới đây không chạm tới. */
const fakeBridge = {} as ExtensionBridge;

async function serve(token: string | null = TOKEN) {
  const store = new SessionStore();
  const askStore = new AskStore();
  running = await startHttpServer({
    host: '127.0.0.1',
    port: 0, // để OS chọn cổng — chạy song song với server thật trên 8788
    token,
    allowedHosts: [],
    createMcpServer: () => createMcpServer(store, fakeBridge, askStore),
  });
  return { askStore, url: `http://127.0.0.1:${running.port}/mcp` };
}

async function connect(url: string, token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe('MCP Streamable HTTP', () => {
  it('client MCP thật nối được và thấy đủ tool kênh Ask', async () => {
    const { url } = await serve();
    const client = await connect(url);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('livemcp_ask_wait');
    expect(names).toContain('livemcp_ask_answer');
    expect(names).toContain('livemcp_list_sites');
  });

  it('đi trọn vòng: câu hỏi vào hàng đợi → ask_wait nhận → ask_answer trả lời', async () => {
    const { askStore, url } = await serve();
    const client = await connect(url);

    askStore.add({
      type: 'ask_question',
      tabId: 3,
      questionId: 'q-http',
      url: 'https://vidu.com/bai',
      title: 'Bài',
      text: 'câu hỏi đi qua HTTP',
      ts: Date.now(),
    });

    const waited = await client.callTool({
      name: 'livemcp_ask_wait',
      arguments: { maxWaitMs: 3_000 },
    });
    const text = JSON.stringify(waited.content);
    expect(text).toContain('q-http');
    expect(text).toContain('câu hỏi đi qua HTTP');
    expect(askStore.get('q-http')?.status).toBe('claimed');

    await client.callTool({
      name: 'livemcp_ask_answer',
      arguments: { questionId: 'q-http', markdown: 'đây là câu trả lời' },
    });
    expect(askStore.get('q-http')?.answer).toBe('đây là câu trả lời');
  });

  it('ask_wait chặn thật rồi hết giờ mà không làm đứt kết nối HTTP', async () => {
    const { url } = await serve();
    const client = await connect(url);

    const started = Date.now();
    const res = await client.callTool({
      name: 'livemcp_ask_wait',
      arguments: { maxWaitMs: 1_500 },
    });

    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(JSON.stringify(res.content)).toContain('không phải lỗi');
  });

  it('không token thì không vào được, và lời từ chối nói rõ vì sao', async () => {
    const { url } = await serve();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toContain('Authorization');
  });

  it('đường dẫn khác /mcp trả 404, không tiết lộ gì thêm', async () => {
    const { url } = await serve();
    const res = await fetch(url.replace('/mcp', '/'), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it('session lạ bị từ chối kèm hướng dẫn initialize lại, không im lặng', async () => {
    const { url } = await serve();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
        'mcp-session-id': 'khong-ton-tai',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toContain('initialize');
  });
});
