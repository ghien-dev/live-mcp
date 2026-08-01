// Build extension bằng esbuild thuần — không framework, manifest viết tay.
import { build, context } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
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
  console.log(`\n✔ extension đã build → ${DIST}`);
  console.log('  Load unpacked thư mục này ở chrome://extensions (bật Developer mode).');
}
