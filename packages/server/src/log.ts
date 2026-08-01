/**
 * Logger của server.
 *
 * QUAN TRỌNG: transport stdio dùng stdout làm kênh JSON-RPC — ghi bất cứ thứ gì
 * ra stdout sẽ làm hỏng giao thức MCP. Mọi log BẮT BUỘC đi qua stderr.
 */

const VERBOSE = process.env.LIVEMCP_VERBOSE !== '0';

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  info(...args: unknown[]): void {
    if (VERBOSE) console.error(`[${stamp()}]`, ...args);
  },
  warn(...args: unknown[]): void {
    console.error(`[${stamp()}] ⚠ `, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`[${stamp()}] ✖ `, ...args);
  },
};
