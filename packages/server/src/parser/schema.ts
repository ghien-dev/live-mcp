import type { FieldDecl } from '@livemcp/protocol';
import type { JsonSchema } from './tools.js';
import { scrubWebText } from '../mcp/agentText.js';

/**
 * Bảng chuyển đổi HTML → JSON Schema (docs/livemcp-declarative-spec.md §4).
 *
 * "Nguyên tắc vàng" của chuẩn: viết HTML form đúng ngữ nghĩa (đúng `type`, có
 * `min/max/required/pattern`) là đã có 80% schema chất lượng. Module này hiện
 * thực hoá nguyên tắc đó — thuần logic, nhiều nhánh, sai rất lặng lẽ nên có test.
 */

/** `type` của input → `format` trong JSON Schema. */
const FORMAT_BY_TYPE: Record<string, string> = {
  date: 'date',
  time: 'time',
  'datetime-local': 'date-time',
  month: 'date',
  week: 'date',
  email: 'email',
  url: 'uri',
  tel: 'phone',
};

function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Số nguyên khi không khai báo step, hoặc step là số nguyên (vd min=1 max=20). */
function isIntegerField(field: FieldDecl): boolean {
  if (field.step === undefined) return true;
  if (field.step.trim().toLowerCase() === 'any') return false;
  const step = Number(field.step);
  return Number.isInteger(step);
}

function fieldToProperty(field: FieldDecl): Record<string, unknown> {
  const prop: Record<string, unknown> = {};
  if (field.description) prop.description = scrubWebText(field.description, 400);

  switch (field.htmlType) {
    case 'number':
    case 'range': {
      prop.type = isIntegerField(field) ? 'integer' : 'number';
      const min = toNumber(field.min);
      const max = toNumber(field.max);
      if (min !== undefined) prop.minimum = min;
      if (max !== undefined) prop.maximum = max;
      break;
    }

    case 'checkbox':
      prop.type = 'boolean';
      break;

    case 'select':
    case 'radio-group':
      prop.type = 'string';
      // KHÔNG scrub `enum`: đây là giá trị định danh phải khớp chính xác với
      // option trên trang, và với `validateArgs` phía server. Làm sạch ở đây mà
      // không làm sạch ở nguồn sẽ khiến agent gửi giá trị đã bị sửa rồi bị chính
      // ta từ chối. Chỗ đúng để chuẩn hoá là content script — ghi ở bảng nợ kỹ
      // thuật của lộ trình, thuộc M4.
      if (field.options?.length) prop.enum = [...field.options];
      break;

    default: {
      prop.type = 'string';
      const format = FORMAT_BY_TYPE[field.htmlType];
      if (format) prop.format = format;
      // Với date/time, min/max của HTML là biên hợp lệ — giữ lại làm gợi ý cho agent.
      if (format && (field.min || field.max)) {
        const bounds = [field.min && `từ ${field.min}`, field.max && `đến ${field.max}`]
          .filter(Boolean)
          .join(' ');
        prop.description = [prop.description, `(${bounds})`].filter(Boolean).join(' ');
      }
      if (field.pattern) prop.pattern = field.pattern;
      if (field.maxLength !== undefined) prop.maxLength = field.maxLength;
      break;
    }
  }

  return prop;
}

/** Các field của một `<form>` → inputSchema của tool. */
export function fieldsToSchema(fields: FieldDecl[]): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (!field.name) continue;
    properties[field.name] = fieldToProperty(field);
    if (field.required) required.push(field.name);
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}
