// App bình thường, không biết Live MCP tồn tại.
// Trách nhiệm duy nhất theo chuẩn: cập nhật `livemcp-state` cho vùng kết quả.

const form = document.getElementById('booking-form');
const result = document.getElementById('booking-result');
const log = document.getElementById('log');

const lines = [];
function note(text) {
  lines.push(text);
  log.textContent = lines.slice(-12).join('\n');
}

// Chẩn đoán: trình duyệt này đang hiển thị ô ngày theo thứ tự nào?
// `input.value` luôn là ISO YYYY-MM-DD, nhưng thứ tự GÕ lại theo locale giao
// diện của trình duyệt — đây chính là chỗ tự động hoá hay vấp.
{
  const order = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .filter((p) => ['day', 'month', 'year'].includes(p.type))
    .map((p) => ({ day: 'dd', month: 'mm', year: 'yyyy' })[p.type])
    .join('/');
  note(`navigator.language = ${navigator.language} · Intl đoán ô ngày hiển thị: ${order}`);
  note('(Live MCP không tin con số này — nó tự đo bằng một ô date ẩn của riêng nó)');
}

// Ghi lại xem input đến từ bàn phím thật hay bị set bằng JavaScript.
for (const el of form.elements) {
  if (!el.name) continue;
  el.addEventListener('change', (e) => {
    const value = el.type === 'checkbox' ? el.checked : el.value;
    note(`${el.name} = ${JSON.stringify(value)}  (isTrusted: ${e.isTrusted})`);
  });
}

// Máy ghi sự kiện — lưới bảo vệ cho đặt cược trung tâm của cả dự án.
//
// `isTrusted` là thuộc tính readonly do trình duyệt gán, trang không giả mạo
// được, nên listener ở capture phase đọc ra giá trị thật. Khẳng định đáng giá
// nhất ở đây là khẳng định ÂM: sau khi agent điền xong, KHÔNG được tồn tại một
// sự kiện tương tác nào có isTrusted === false. Nó sẽ bắt được cái ngày ai đó
// lỡ thêm một `dispatchEvent` "chỉ lần này thôi" — đúng loại xói mòn triết lý
// mà không review bằng mắt nào thấy.
const recorder = (window.__livemcpEvents = []);
for (const type of ['focusin', 'keydown', 'click', 'input', 'change', 'submit']) {
  document.addEventListener(
    type,
    (e) => {
      const target = e.composedPath()[0];
      recorder.push({
        type,
        isTrusted: e.isTrusted,
        target: target?.name || target?.id || target?.tagName?.toLowerCase() || '?',
      });
      if (!e.isTrusted) note(`⚠ ${type} KHÔNG trusted trên ${recorder.at(-1).target}`);
    },
    { capture: true },
  );
}

// `focusin` đáng chú ý riêng: Live MCP đưa con trỏ bằng `el.focus()` thay vì
// click theo toạ độ. Nếu dòng này in ra `isTrusted: true` thì `focus()` chạy
// focusing steps của spec chứ không dispatch synthetic — nghĩa là đường bàn
// phím không hề đưa sự kiện untrusted nào vào trang.
document.addEventListener(
  'focusin',
  (e) => {
    const t = e.composedPath()[0];
    note(`focus → ${t?.name || t?.tagName?.toLowerCase() || '?'}  (isTrusted: ${e.isTrusted})`);
  },
  { capture: true, once: true },
);

let counter = 1022;

form.addEventListener('submit', (e) => {
  e.preventDefault();

  result.setAttribute('livemcp-state', 'busy');
  result.textContent = 'Đang kiểm tra bàn trống...';
  note(`submit (isTrusted: ${e.isTrusted})`);

  // Giả lập gọi server: chỉ khi xử lý xong mới chuyển sang ready.
  setTimeout(() => {
    const data = new FormData(form);
    const guests = Number(data.get('guests'));

    if (!guests || guests < 1 || guests > 20) {
      result.setAttribute('livemcp-state', 'error');
      result.textContent = 'Số khách phải từ 1 đến 20.';
      return;
    }

    counter += 1;
    const area = { indoor: 'Trong nhà', outdoor: 'Ngoài trời', balcony: 'Ban công' }[
      data.get('area')
    ];
    const parts = [
      `Đặt bàn thành công! Mã đặt bàn: BK-${counter}`,
      `${guests} khách · ${data.get('date')}${data.get('time') ? ` lúc ${data.get('time')}` : ''}`,
      `Khu vực: ${area}${data.get('windowSeat') ? ' · cạnh cửa sổ' : ''}`,
    ];
    if (data.get('note')) parts.push(`Ghi chú: ${data.get('note')}`);

    result.setAttribute('livemcp-state', 'ready');
    result.textContent = parts.join('\n');
  }, 900);
});
