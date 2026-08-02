import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Token pairing giữa Local Server và extension (docs/livemcp-roadmap.md M1.5).
 *
 * Token phải BỀN qua các lần chạy: agent spawn server mỗi phiên, mà bắt người
 * dùng dán lại token mỗi lần thì đó là loại ma sát khiến người ta tắt bảo mật
 * đi cho xong — tức là biện pháp tự phá chính nó.
 */

const TOKEN_FILE = join(homedir(), '.livemcp', 'token');

/** Đủ dài để không đoán được, đủ ngắn để dán tay không thấy nản. */
const TOKEN_BYTES = 24;

/**
 * Lấy token hiện có, hoặc sinh mới lần đầu chạy.
 *
 * `LIVEMCP_TOKEN` ghi đè tất cả — lưới E2E dùng đường này để dựng một stack
 * riêng mà không đụng vào token thật của người dùng.
 */
export function loadOrCreateToken(): { token: string; created: boolean; source: string } {
  const fromEnv = process.env.LIVEMCP_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, created: false, source: 'biến môi trường LIVEMCP_TOKEN' };

  try {
    const existing = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (existing) return { token: existing, created: false, source: TOKEN_FILE };
  } catch {
    // Chưa có file — rơi xuống nhánh sinh mới.
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  // mode 0600: chỉ chủ sở hữu đọc được. Trên Windows bị bỏ qua, không sao —
  // ở đó token vẫn nằm trong thư mục hồ sơ người dùng.
  writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  return { token, created: true, source: TOKEN_FILE };
}
