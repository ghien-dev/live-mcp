import { expect, test } from '../fixtures/stack.js';

/**
 * Ca 5 — những chỗ CHƯA hỗ trợ, ghi thành test thay vì ghi vào một tài liệu.
 *
 * `test.fixme` nghĩa là: bài này *nên* xanh nhưng hiện đỏ vì tính năng chưa có.
 * Ghi ở đây thay vì trong file TODO vì một lý do đơn giản: người ta đọc kết quả
 * test, còn file TODO thì không.
 *
 * ⚠ **Đính chính (03/08/2026).** Bản đầu của chú thích này khẳng định Playwright
 * *"tự động đỏ ngược lại nếu bài fixme bất ngờ xanh"*. **Sai** — `test.fixme`
 * KHÔNG chạy bài test, nên nó không phát hiện được gì cả. Hành vi đó thuộc về
 * `test.fail()`, thứ có chạy và bắt lỗi nếu bài lại xanh.
 *
 * Hệ quả thực tế: một `fixme` ở đây **không** tự nhắc khi tính năng xong — phải
 * nhớ mà gỡ bằng tay. Ghi lại nguyên văn chỗ sai thay vì lặng lẽ xoá, vì đây
 * đúng loại phát biểu mà cả dự án đang học cách không tin: nghe hợp lý, không ai
 * kiểm, sống rất lâu (xem `docs/livemcp-roadmap.md` R08).
 */

test('form trong shadow DOM phải được phát hiện', async ({ stack, edgeCases }) => {
  // Không phải ca hiếm: design system nào dùng web component (Lit, Stencil,
  // Shoelace, Material Web, LWC…) cũng đặt form trong shadow DOM — và đó lại là
  // hệ sinh thái enterprise, đúng tệp khách hàng sớm nhất của chuẩn này ([R01]).
  //
  // Bài này kiểm cả hai vế: scanner đệ quy vào `shadowRoot`, và thao tác thật
  // (focus + gõ phím qua CDP) vẫn tới đúng phần tử sau ranh giới shadow.
  await stack.agent.waitForTool('edgecases__shadow_note', 5_000);

  const res = await stack.agent.callTool('edgecases__shadow_note', { snote: 'xin chào' });
  expect(res.isError, res.text).toBe(false);

  const value = await edgeCases.evaluate(
    () =>
      (document.getElementById('shadow-host') as HTMLElement).shadowRoot!.getElementById(
        'shadow-result',
      )!.textContent,
  );
  expect(value).toContain('xin chào');
});

test.fixme('ô time ở locale 12 giờ phải được đo thay vì suy từ Intl', async ({ stack }) => {
  // `timeKeys()` hiện hỏi `Intl.DateTimeFormat(...).hour12`, tức suy luận qua
  // CLDR thay vì đo. Đó đúng là lỗi nguyên tắc đã sửa cho ô NGÀY nhưng chưa sửa
  // cho ô GIỜ (xem docs/consult/Q02 câu 5).
  //
  // Nặng hơn: có locale đặt AM/PM ĐỨNG TRƯỚC giờ (ko-KR "오전 07:05"), nên giả
  // định "field AM/PM ở cuối" cũng sai. Lời giải là mở phép dò sang type="time".
  //
  // Bài này cần một project `--lang=ko` để có ý nghĩa; thêm vào lúc làm tính năng.
  expect(stack).toBeTruthy();
});
