import { qualifyToolName, type ResourceDecl, type ToolDecl } from '@livemcp/protocol';
import { fieldsToSchema } from './schema.js';

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

/** Mô tả agent nhìn thấy: mô tả của trang + các ghi chú vận hành do server thêm. */
export function buildDescription(decl: ToolDecl): string {
  const parts = [decl.description?.trim() || decl.name];

  if (!decl.available) {
    parts.push(
      `[HIỆN KHÔNG KHẢ DỤNG: ${decl.unavailableReason ?? 'phần tử đang bị vô hiệu hoá hoặc ẩn'}]`,
    );
  }
  if (decl.confirm) {
    parts.push(`[CẦN XÁC NHẬN NGƯỜI DÙNG: ${decl.confirm}]`);
  }
  if (decl.navigate) {
    parts.push('[Hành động này chuyển sang trang khác; danh sách tool sẽ thay đổi.]');
  }
  if (decl.group) {
    parts.push(`[Thuộc nhóm workflow: ${decl.group}]`);
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
  return {
    name: qualifyToolName(namespace, `read_${res.name}`),
    description: `${res.description?.trim() || res.name} [Chỉ đọc, không thay đổi gì trên trang.]`,
    inputSchema: { ...EMPTY_SCHEMA },
  };
}
