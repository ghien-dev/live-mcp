/**
 * Dựng sẵn mọi thứ lưới E2E cần, để `npm run test:e2e` là **một lệnh duy nhất**.
 *
 * Kỷ luật này không phải cầu kỳ: một lưới đòi setup tay sẽ không ai chạy, và
 * lưới không ai chạy thì bằng không. Mọi bước dưới đây phải tự động.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { E2E_TOKEN, E2E_WS_PORT, EXT_DIST_DIR } from './fixtures/ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

console.log('› build protocol + server…');
run('npm', ['run', 'build', '-w', '@livemcp/protocol'], ROOT);
run('npm', ['run', 'build', '-w', '@livemcp/server'], ROOT);

// Bản extension riêng cho test, nướng cổng WS khác bản dev — nhờ vậy lưới chạy
// được trong khi server dev vẫn đang bật, không phải tắt gì bằng tay.
console.log(`› build extension cho E2E (cổng ${E2E_WS_PORT}) → ${EXT_DIST_DIR}…`);
run(
  'node',
  [
    'build.mjs',
    '--outdir',
    EXT_DIST_DIR,
    '--ws-port',
    String(E2E_WS_PORT),
    // Nướng token vào bản test: không có ai bấm popup giữa lúc chạy Playwright.
    '--token',
    E2E_TOKEN,
  ],
  join(ROOT, 'packages', 'extension'),
);

// Mã test cũng là mã. Kiểm kiểu ở đây vì Playwright chạy TS qua esbuild —
// nó *transpile* chứ không type-check, nên lỗi kiểu sẽ lọt qua im lặng.
console.log('› type-check lưới E2E…');
run('npx', ['tsc', '-p', 'tsconfig.json', '--noEmit'], HERE);

console.log('✔ sẵn sàng chạy Playwright\n');
