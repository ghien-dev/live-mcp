import { expect, test } from '../fixtures/stack.js';

/**
 * Ca 5 — những chỗ CHƯA hỗ trợ, ghi thành test thay vì ghi vào một tài liệu.
 *
 * `test.fixme` nghĩa là: bài này *nên* xanh nhưng hiện đỏ vì tính năng chưa có.
 * Playwright báo cáo nó riêng một mục, và **tự động đỏ ngược lại nếu nó bất ngờ
 * xanh** — tức là ngày ai đó làm xong tính năng, lưới sẽ nhắc gỡ `fixme` chứ
 * không im lặng.
 *
 * Ghi ở đây thay vì trong file TODO vì một lý do đơn giản: người ta đọc kết quả
 * test, còn file TODO thì không.
 */

test.fixme('form trong shadow DOM phải được phát hiện', async ({ stack, edgeCases }) => {
  // Scanner hiện dùng `root.querySelectorAll`, vốn KHÔNG xuyên qua shadow root,
  // nên form khai báo đúng chuẩn nằm trong shadow DOM vẫn vô hình với agent.
  //
  // Đây là thiếu sót thật, không phải ca hiếm: design system nào dùng web
  // component (Lit, Stencil, Shoelace…) cũng đặt form trong shadow DOM.
  //
  // Khi làm: scanner phải đệ quy vào `shadowRoot` của mọi phần tử, và
  // MutationObserver cũng phải observe từng shadow root riêng — observer của
  // document KHÔNG thấy thay đổi bên trong shadow tree.
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
