/**
 * DynamicDemo — trang chứng minh vòng lặp trung tâm của chuẩn Live MCP.
 *
 * Điều đáng chú ý về file này: nó KHÔNG biết gì về Live MCP. Không import,
 * không đăng ký tool, không gọi API nào. Nó chỉ là một trang web bình thường
 * render DOM sau tương tác — và vì DOM đó mang attribute `livemcp-*`, tool tự
 * xuất hiện. Đó chính là điều "thuần declarative" nghĩa là gì.
 */

const CATEGORIES = [
  { slug: 'mon_chinh', label: 'Món chính', count: 12 },
  { slug: 'do_uong', label: 'Đồ uống', count: 8 },
  { slug: 'trang_mieng', label: 'Tráng miệng', count: 5 },
];

const menu = document.getElementById('menu');
const chosen = document.getElementById('chosen');

/** Độ trễ giả lập gọi mạng — để `livemcp-state="busy"` có ý nghĩa thật. */
const FAKE_LATENCY_MS = 300;

document.getElementById('open-menu').addEventListener('click', () => {
  if (menu.dataset.open === 'yes') return;

  // busy → trang tự nhận "tôi đang làm việc". Waiter dùng tín hiệu này để kết
  // thúc sớm và chính xác, thay vì đoán qua độ lắng của DOM.
  menu.setAttribute('livemcp-state', 'busy');
  menu.hidden = false;
  menu.textContent = 'Đang tải danh mục…';

  setTimeout(() => {
    menu.textContent = '';
    for (const cat of CATEGORIES) {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.textContent = `${cat.label} (${cat.count} món)`;

      // Các attribute này là toàn bộ "đăng ký tool". Chúng đi vào DOM cùng lúc
      // với phần tử, nên MutationObserver của extension thấy ngay.
      item.setAttribute('livemcp-name', `chon_${cat.slug}`);
      item.setAttribute('livemcp-action', 'click');
      item.setAttribute(
        'livemcp-description',
        `Chọn danh mục "${cat.label}". Chỉ gọi được khi menu đang mở.`,
      );
      item.setAttribute('livemcp-result', '#chosen');
      item.setAttribute('livemcp-wait', "#chosen[livemcp-state='ready']");

      item.addEventListener('click', () => choose(cat));
      menu.appendChild(item);
    }
    menu.dataset.open = 'yes';
    menu.setAttribute('livemcp-state', 'ready');
  }, FAKE_LATENCY_MS);
});

function choose(cat) {
  chosen.setAttribute('livemcp-state', 'busy');

  setTimeout(() => {
    chosen.textContent = `Đã chọn: ${cat.label} — ${cat.count} món.`;
    chosen.setAttribute('livemcp-state', 'ready');

    // Menu đóng lại → ba tool `chon_*` biến mất khỏi danh sách của agent.
    // Đây là nửa còn lại của vòng lặp: tool có sinh thì phải có tử.
    menu.textContent = '';
    menu.hidden = true;
    delete menu.dataset.open;
    menu.setAttribute('livemcp-state', 'idle');
  }, FAKE_LATENCY_MS);
}

// ---------------------------------------------------------------------------
// Nút có state mục — CỐ Ý HỎNG
// ---------------------------------------------------------------------------

const rottenResult = document.getElementById('rotten-result');
let rottenRuns = 0;

document.getElementById('rotten').addEventListener('click', () => {
  rottenRuns += 1;
  rottenResult.setAttribute('livemcp-state', 'busy');
  rottenResult.textContent = 'Đang chạy…';

  setTimeout(() => {
    rottenResult.textContent = `Xong lượt ${rottenRuns}.`;
    // CỐ Ý KHÔNG đặt lại state về 'ready'. Đây là mô phỏng chính xác lỗi mà
    // dev hay mắc và không bao giờ tự thấy: trang chạy đúng với người dùng
    // thật (họ nhìn bằng mắt), chỉ hỏng với agent.
  }, FAKE_LATENCY_MS);
});
