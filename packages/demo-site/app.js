// Demo-site chỉ là HTML + JS ứng dụng bình thường — không biết Live MCP tồn tại.
// Trách nhiệm duy nhất của nó theo chuẩn: cập nhật `livemcp-state` cho vùng kết quả.

const out = document.getElementById('out');
let count = 0;

document.getElementById('hello-btn').addEventListener('click', (e) => {
  count += 1;
  // `isTrusted` phải là true khi Live MCP điều khiển — đây là bằng chứng CDP hoạt động.
  const source = e.isTrusted ? 'sự kiện thật (trusted)' : 'sự kiện giả lập JS';
  out.setAttribute('livemcp-state', 'ready');
  out.textContent = `Xin chào! Nút đã được bấm ${count} lần — ${source}.`;
});

document.getElementById('invisible-btn').addEventListener('click', () => {
  alert('Nút này không khai báo declarative nên agent không gọi được.');
});
