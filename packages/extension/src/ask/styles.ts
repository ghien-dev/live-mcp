/**
 * CSS của widget, nhúng thẳng vào shadow root.
 *
 * Shadow DOM **closed** nên CSS của trang không với tới đây được, nhưng thuộc
 * tính kế thừa (font, color, line-height, direction) thì vẫn chảy vào qua ranh
 * giới shadow. Vì thế `.lmx-root` đặt lại đủ bộ thay vì tin vào mặc định — nếu
 * không, widget sẽ đổi hình trên mỗi trang và không cách nào đoán trước.
 */
export const WIDGET_CSS = `
:host { all: initial; }
.lmx-root {
  position: fixed; inset: auto 20px 20px auto; z-index: 2147483647;
  font: 14px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  color: #1a1a1a; direction: ltr; text-align: left; letter-spacing: normal;
  color-scheme: light;
}
.lmx-dot {
  width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer;
  background: #1a1a1a; color: #fff; font-size: 19px; line-height: 44px;
  box-shadow: 0 4px 16px rgba(0,0,0,.28); transition: transform .12s ease;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.lmx-dot:hover { transform: scale(1.06); }
.lmx-dot[data-unread="1"]::after {
  content: ""; position: absolute; top: 2px; right: 2px;
  width: 11px; height: 11px; border-radius: 50%; background: #e5484d; border: 2px solid #fff;
}
.lmx-panel {
  width: 380px; max-width: calc(100vw - 40px); max-height: min(560px, calc(100vh - 40px));
  background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.24);
  display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e4e4e4;
}
.lmx-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid #eee; background: #fafafa;
}
.lmx-title { font-weight: 600; flex: 1; font-size: 13px; }
.lmx-link {
  background: none; border: none; cursor: pointer; color: #666; font-size: 12px;
  padding: 4px 6px; border-radius: 6px;
}
.lmx-link:hover { background: #ececec; color: #1a1a1a; }
.lmx-turn { display: flex; flex-direction: column; gap: 6px; }
.lmx-thread { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.lmx-empty { color: #888; font-size: 13px; text-align: center; padding: 28px 12px; }
.lmx-q { background: #f1f4f9; border-radius: 10px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
.lmx-sel {
  border-left: 3px solid #c8ccd4; padding: 4px 0 4px 8px; margin-top: 6px;
  color: #555; font-size: 12.5px; max-height: 84px; overflow: hidden; white-space: pre-wrap;
}
.lmx-status { font-size: 12px; color: #777; display: flex; align-items: center; gap: 6px; }
.lmx-status[data-tone="warn"] { color: #b45309; }
.lmx-spin {
  width: 10px; height: 10px; border: 2px solid #c9c9c9; border-top-color: #555;
  border-radius: 50%; animation: lmx-spin .8s linear infinite;
}
@keyframes lmx-spin { to { transform: rotate(360deg); } }
.lmx-a { word-break: break-word; }
.lmx-a p { margin: 0 0 8px; }
.lmx-a p:last-child { margin-bottom: 0; }
.lmx-a ul, .lmx-a ol { margin: 0 0 8px; padding-left: 20px; }
.lmx-a h3, .lmx-a h4, .lmx-a h5, .lmx-a h6 { margin: 10px 0 6px; font-size: 14px; }
.lmx-a code { background: #f0f0f0; border-radius: 4px; padding: 1px 4px; font-size: 12.5px; }
.lmx-a pre {
  background: #f6f6f6; border-radius: 8px; padding: 10px; overflow-x: auto; margin: 0 0 8px;
}
.lmx-a pre code { background: none; padding: 0; }
.lmx-a a { color: #0b5fd0; }
.lmx-followup {
  background: #fff7e6; border: 1px solid #f0dfb8; border-radius: 10px;
  padding: 8px 10px; font-size: 13px;
}
.lmx-compose { border-top: 1px solid #eee; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.lmx-chip {
  display: flex; gap: 6px; align-items: flex-start; background: #f1f4f9;
  border-radius: 8px; padding: 6px 8px; font-size: 12.5px; color: #444;
}
.lmx-chip span { flex: 1; max-height: 48px; overflow: hidden; }
.lmx-ta {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 62px; max-height: 180px;
  border: 1px solid #ddd; border-radius: 9px; padding: 8px 10px; font: inherit; color: inherit;
  background: #fff;
}
.lmx-ta:focus { outline: 2px solid #1a1a1a; outline-offset: -1px; }
.lmx-row { display: flex; align-items: center; gap: 8px; }
.lmx-hint { flex: 1; font-size: 11.5px; color: #999; }
.lmx-send {
  border: none; border-radius: 8px; background: #1a1a1a; color: #fff;
  padding: 7px 14px; font: inherit; font-weight: 600; cursor: pointer;
}
.lmx-send:disabled { background: #c4c4c4; cursor: default; }
.lmx-ask-chip {
  position: fixed; z-index: 2147483647; transform: translate(-50%, 6px);
  background: #1a1a1a; color: #fff; border: none; border-radius: 8px;
  padding: 6px 11px; font: 600 12.5px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3);
}
@media (prefers-color-scheme: dark) {
  .lmx-root { color: #ededed; color-scheme: dark; }
  .lmx-panel { background: #1c1c1e; border-color: #333; }
  .lmx-head { background: #232326; border-bottom-color: #333; }
  .lmx-link { color: #aaa; }
  .lmx-link:hover { background: #333; color: #fff; }
  .lmx-q, .lmx-chip { background: #2b2f36; }
  .lmx-sel { border-left-color: #4a4f58; color: #b4b4b4; }
  .lmx-compose { border-top-color: #333; }
  .lmx-ta { background: #232326; border-color: #3a3a3a; color: inherit; }
  .lmx-ta:focus { outline-color: #ededed; }
  .lmx-a code, .lmx-a pre { background: #2a2a2d; }
  .lmx-a a { color: #6aa9ff; }
  .lmx-followup { background: #3a3021; border-color: #574728; }
  .lmx-dot { background: #ededed; color: #1a1a1a; }
  .lmx-send { background: #ededed; color: #1a1a1a; }
  .lmx-send:disabled { background: #4a4a4a; color: #8a8a8a; }
}
`;
