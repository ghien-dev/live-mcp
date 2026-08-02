import { defineConfig } from '@playwright/test';
import type { UiLocaleOptions } from './fixtures/stack.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { E2E_SITE_PORT } from './fixtures/ports.mjs';

const SITE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-site');

/**
 * Lưới E2E — ít ca, mỗi ca bắt một lớp lỗi mà tầng dưới mù hoàn toàn.
 *
 * Lý do lưới này tồn tại: lỗi đau nhất của dự án (toạ độ / layout / focus) sống
 * *trong* browser. Mọi contract test với DOM giả đều mù trước nó, vì DOM giả
 * chính là kẻ nói dối `getBoundingClientRect` — jsdom trả về toàn số 0, nên
 * test xanh trong khi sản phẩm hỏng. Browser chính là layout engine: thuê nó,
 * đừng giả nó.
 *
 * Kỷ luật: chạy bằng MỘT lệnh, không setup tay. Lưới chết vì ma sát, không phải
 * vì thiếu ca.
 */
export default defineConfig<UiLocaleOptions>({
  testDir: './tests',
  // Extension + chrome.debugger là tài nguyên độc quyền theo profile; chạy song
  // song nhiều Chrome cùng attach debugger chỉ tổ nhiễu.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  retries: 0,
  use: {
    trace: 'retain-on-failure',
  },
  /**
   * Static server của demo-site: một tiến trình cho cả lượt chạy, Playwright tự
   * dựng và tự dọn. Trước đây bật/tắt trong fixture, nhưng `afterAll` chạy theo
   * TỪNG file spec nên file thứ hai mất server — đúng loại lỗi hạ tầng test làm
   * người ta mất niềm tin vào lưới.
   */
  webServer: {
    command: `node serve.mjs`,
    cwd: SITE_DIR,
    env: { PORT: String(E2E_SITE_PORT) },
    url: `http://localhost:${E2E_SITE_PORT}/booking.html`,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  /**
   * Ma trận locale: mỗi project là một bản Chrome với `--lang` khác nhau.
   *
   * Chỉ ca ngày chạy trên cả ba — các ca còn lại không phụ thuộc locale nên
   * nhân ba chúng chỉ tốn thời gian mà không thêm thông tin.
   *
   * Ba locale chọn có chủ đích, phủ đúng ba nhánh của `dateOrder`:
   *   en-US → MDY · de-DE → DMY · ja → YMD (nhánh hiếm nhất, dễ sai nhất)
   */
  projects: [
    {
      name: 'chromium',
      use: { uiLocale: 'en-US' },
    },
    {
      name: 'locale-de-DMY',
      use: { uiLocale: 'de-DE' },
      testMatch: /03-locale\.spec\.ts/,
    },
    {
      name: 'locale-ja-YMD',
      use: { uiLocale: 'ja' },
      testMatch: /03-locale\.spec\.ts/,
    },
  ],
});
