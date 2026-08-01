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
