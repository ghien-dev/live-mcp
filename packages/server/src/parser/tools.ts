import { qualifyToolName, type ResourceDecl, type ToolDecl } from '@livemcp/protocol';
import { fieldsToSchema } from './schema.js';
import { scrubWebText } from '../mcp/agentText.js';

/** Trần cho chuỗi nằm trong dòng: mô tả tool không được nuốt cả context window. */
const INLINE_LIMIT = 600;

/**
 * Dịch `ToolDecl` (sự thật DOM do content script chuẩn hoá) sang tool MCP.
 *
 * Ranh giới trách nhiệm (docs/livemcp-architecture.md §3.3): mọi hiểu biết về
 * attribute nằm ở content script; mọi hiểu biết về MCP nằm ở đây. Module này
 * thuần logic, không đụng WebSocket/DOM — đơn vị chính có unit test.
 */

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpToolShape {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

const EMPTY_SCHEMA: JsonSchema = { type: 'object', properties: {} };

export function buildInputSchema(decl: ToolDecl): JsonSchema {
  // Form là đơn vị tool tự nhiên nhất: nhiều input → một submit → một kết quả.
  if (decl.kind === 'form') {
    return fieldsToSchema(decl.fields ?? []);
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  // Tool tham số hoá: mỗi `livemcp-arg` gộp thành một enum (spec §5.3).
  for (const arg of decl.args ?? []) {
    properties[arg.name] = {
      type: 'string',
      enum: [...arg.values],
      description: `Giá trị khai báo trên trang qua livemcp-arg="${arg.name}: ..."`,
    };
    required.push(arg.name);
  }

  // Input tự do ngoài form: một param `text` (spec §5.4).
  if (decl.kind === 'element' && decl.action === 'type') {
    properties.text = {
      type: 'string',
      description: decl.submitKey
        ? `Nội dung cần gõ. Sau khi gõ xong sẽ bấm phím ${decl.submitKey}.`
        : 'Nội dung cần gõ vào ô này.',
    };
    required.push('text');
  }

  if (Object.keys(properties).length === 0) return { ...EMPTY_SCHEMA };
  return { type: 'object', properties, required };
}

/**
 * Mô tả agent nhìn thấy: mô tả của trang + các ghi chú vận hành do server thêm.
 *
 * Mọi mảnh đến từ trang phải qua `scrubWebText` (M1.5). Ghi chú do server tự
 * thêm thì không — chúng là lời của server, và trộn lẫn hai nguồn ở đây chính là
 * thứ khiến sau này không ai biết câu nào do ai viết.
 */
export function buildDescription(decl: ToolDecl): string {
  const parts = [scrubWebText(decl.description?.trim() || decl.name, INLINE_LIMIT)];

  if (!decl.available) {
    const reason = decl.unavailableReason
      ? scrubWebText(decl.unavailableReason, 200)
      : 'phần tử đang bị vô hiệu hoá hoặc ẩn';
    parts.push(`[HIỆN KHÔNG KHẢ DỤNG: ${reason}]`);
  }
  if (decl.confirm) {
    parts.push(`[CẦN XÁC NHẬN NGƯỜI DÙNG: ${scrubWebText(decl.confirm, 300)}]`);
  }
  if (decl.navigate) {
    parts.push('[Hành động này chuyển sang trang khác; danh sách tool sẽ thay đổi.]');
  }
  if (decl.group) {
    parts.push(`[Thuộc nhóm workflow: ${scrubWebText(decl.group, 100)}]`);
  }
  return parts.join(' ');
}

export function toolDeclToMcpTool(decl: ToolDecl, namespace: string): McpToolShape {
  return {
    name: qualifyToolName(namespace, decl.name),
    description: buildDescription(decl),
    inputSchema: buildInputSchema(decl),
  };
}

/** Vùng `livemcp-resource` → tool `read_*` không tham số (spec §6). */
export function resourceDeclToMcpTool(res: ResourceDecl, namespace: string): McpToolShape {
  const description = scrubWebText(res.description?.trim() || res.name, INLINE_LIMIT);
  return {
    name: qualifyToolName(namespace, `read_${res.name}`),
    description: `${description} [Chỉ đọc, không thay đổi gì trên trang.]`,
    inputSchema: { ...EMPTY_SCHEMA },
  };
}
