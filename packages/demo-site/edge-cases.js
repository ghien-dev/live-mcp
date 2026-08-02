// Trang thử ca biên. Vẫn là app bình thường, không biết Live MCP tồn tại.

const log = document.getElementById('log');
const lines = [];
function note(text) {
  lines.push(text);
  log.textContent = lines.slice(-12).join('\n');
}

// Máy ghi sự kiện, giống booking.js — lưới E2E đọc window.__livemcpEvents.
const recorder = (window.__livemcpEvents = []);
for (const type of ['focusin', 'keydown', 'click', 'input', 'change', 'submit']) {
  document.addEventListener(
    type,
    (e) => {
      const t = e.composedPath()[0];
      recorder.push({
        type,
        isTrusted: e.isTrusted,
        target: t?.id || t?.name || t?.tagName?.toLowerCase() || '?',
      });
    },
    { capture: true },
  );
}

for (const id of ['buried', 'reachable']) {
  document.getElementById(id).addEventListener('click', (e) => {
    const out = document.getElementById(`${id}-result`);
    out.setAttribute('livemcp-state', 'ready');
    out.textContent = `đã bấm (isTrusted: ${e.isTrusted})`;
    note(`click ${id} (isTrusted: ${e.isTrusted})`);
  });
}

const pickForm = document.getElementById('pick-form');
const pickResult = document.getElementById('pick-result');

pickForm.addEventListener('submit', (e) => {
  e.preventDefault();
  pickResult.setAttribute('livemcp-state', 'busy');
  pickResult.textContent = 'đang xử lý...';

  setTimeout(() => {
    const value = new FormData(pickForm).get('city');
    const label = pickForm.querySelector(`option[value="${value}"]`)?.textContent ?? value;
    pickResult.setAttribute('livemcp-state', 'ready');
    pickResult.textContent = `Đã chọn: ${label} (${value})`;
  }, 200);
});

document.getElementById('city').addEventListener('change', (e) => {
  note(`city = ${e.target.value} (isTrusted: ${e.isTrusted})`);
});

// --- Form trong shadow DOM: fixture cho tính năng chưa có -------------------
// Khai báo đúng chuẩn y hệt form thường; điểm khác duy nhất là nó nằm sau một
// shadow boundary. Scanner hiện không xuyên qua được nên tool này vô hình.
{
  const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  root.innerHTML = `
    <form id="shadow-form"
          toolname="shadow_note"
          tooldescription="Ghi một dòng ghi chú. Form này nằm trong shadow DOM.">
      <label for="s-note">Ghi chú</label>
      <input id="s-note" name="snote" type="text" toolparamdescription="Nội dung ghi chú">
      <button type="submit">Lưu</button>
    </form>
    <div id="shadow-result" livemcp-state="idle">chưa lưu</div>
  `;

  root.getElementById('shadow-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const out = root.getElementById('shadow-result');
    out.setAttribute('livemcp-state', 'ready');
    out.textContent = `Đã lưu: ${root.getElementById('s-note').value}`;
  });
}
