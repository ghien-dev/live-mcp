import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Bí mật bền của Local Server (docs/livemcp-roadmap.md M1.5).
 *
 * Có HAI bí mật, cố ý không dùng chung một giá trị:
 *   • token pairing  → cửa vào WS hub, người dùng dán vào popup extension.
 *   • token HTTP     → cửa vào MCP Streamable HTTP, dán vào connector claude.ai.
 *
 * Tách vì hai cái có bán kính phơi nhiễm khác hẳn nhau: token pairing chỉ nằm
 * trên máy này, còn token HTTP đi qua tunnel ra internet và nằm trong cấu hình
 * của một dịch vụ bên ngoài. Dùng chung thì lộ cái sau là mất luôn cái trước,
 * và xoay một cái sẽ bắt xoay cả cái kia.
 *
 * Cả hai phải BỀN qua các lần chạy: agent spawn server mỗi phiên, mà bắt người
 * dùng dán lại token mỗi lần thì đó là loại ma sát khiến người ta tắt bảo mật đi
 * cho xong — tức là biện pháp tự phá chính nó.
 */

const DIR = join(homedir(), '.livemcp');

/** Đủ dài để không đoán được, đủ ngắn để dán tay không thấy nản. */
const TOKEN_BYTES = 24;

export interface TokenResult {
  token: string;
  created: boolean;
  source: string;
}

function loadOrCreate(file: string, envVar: string): TokenResult {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return { token: fromEnv, created: false, source: `biến môi trường ${envVar}` };

  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return { token: existing, created: false, source: file };
  } catch {
    // Chưa có file — rơi xuống nhánh sinh mới.
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  mkdirSync(dirname(file), { recursive: true });
  // mode 0600: chỉ chủ sở hữu đọc được. Trên Windows bị bỏ qua, không sao —
  // ở đó token vẫn nằm trong thư mục hồ sơ người dùng.
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, created: true, source: file };
}

/**
 * Token pairing cho WS hub.
 *
 * `LIVEMCP_TOKEN` ghi đè tất cả — lưới E2E dùng đường này để dựng một stack
 * riêng mà không đụng vào token thật của người dùng.
 */
export function loadOrCreateToken(): TokenResult {
  return loadOrCreate(join(DIR, 'token'), 'LIVEMCP_TOKEN');
}

/** Token bearer cho MCP Streamable HTTP. Ghi đè bằng `LIVEMCP_HTTP_TOKEN`. */
export function loadOrCreateHttpToken(): TokenResult {
  return loadOrCreate(join(DIR, 'http-token'), 'LIVEMCP_HTTP_TOKEN');
}
