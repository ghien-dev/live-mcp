// Build extension bằng esbuild thuần — không framework, manifest viết tay.
import { build, context } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Cổng WS được nướng vào lúc build thay vì đọc lúc chạy.
 *
 * Lý do: lưới E2E cần một stack riêng (server + extension) chạy song song với
 * bản dev mà không giành cổng của nhau — nếu không thì mỗi lần chạy test lại
 * phải tắt server dev bằng tay, đúng thứ ma sát làm một lưới test chết yểu.
 */
const DIST = join(ROOT, flag('outdir', 'dist'));
const WS_PORT = Number(flag('ws-port', 8787));

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  define: { __LIVEMCP_WS_PORT__: String(WS_PORT) },
};

const entries = [
  { in: join(ROOT, 'src/sw/index.ts'), out: join(DIST, 'sw.js') },
  { in: join(ROOT, 'src/content/index.ts'), out: join(DIST, 'content.js') },
];

async function copyStatic() {
  await mkdir(DIST, { recursive: true });
  await copyFile(join(ROOT, 'manifest.json'), join(DIST, 'manifest.json'));
}

await rm(DIST, { recursive: true, force: true });
await copyStatic();

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...common, entryPoints: [e.in], outfile: e.out });
    await ctx.watch();
  }
  console.log('watching... (nhớ bấm Reload ở chrome://extensions sau mỗi lần build)');
} else {
  for (const e of entries) {
    await build({ ...common, entryPoints: [e.in], outfile: e.out });
  }
  console.log(`\n✔ extension đã build → ${DIST}  (WS cổng ${WS_PORT})`);
  console.log('  Load unpacked thư mục này ở chrome://extensions (bật Developer mode).');
}
