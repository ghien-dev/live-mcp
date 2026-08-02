/**
 * Cổng và đường dẫn riêng của lưới E2E — cố ý khác bản dev.
 *
 * Bản dev dùng WS 8787 và site 5180. Lưới test dùng bộ khác để hai stack chạy
 * song song: đang gỡ lỗi trên Chrome thật vẫn chạy được test, và ngược lại.
 */
export const E2E_WS_PORT = 8799;
export const E2E_SITE_PORT = 5199;

/** Thư mục dist riêng, không đè lên bản dev đang load ở chrome://extensions. */
export const EXT_DIST_DIR = 'dist-e2e';

/**
 * Token pairing cố định của lưới (M1.5). Nướng vào bản extension E2E và truyền
 * cho server qua `LIVEMCP_TOKEN`, để không ai phải bấm popup giữa lúc chạy test.
 *
 * Công khai trong repo là ĐÚNG, không phải sơ suất: nó chỉ mở được stack test ở
 * cổng 8799 trên đúng máy đang chạy test. Token thật của người dùng nằm ở
 * `~/.livemcp/token` và không bao giờ đi vào mã nguồn.
 */
export const E2E_TOKEN = 'e2e-token-khong-phai-bi-mat';
