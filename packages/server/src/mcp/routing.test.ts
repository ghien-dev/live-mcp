import { describe, expect, it } from 'vitest';
import { parseQualifiedName, qualifyToolName, slugifyApp } from '@livemcp/protocol';
import { isSystemTool } from './systemTools.js';
import { buildInputSchema } from '../parser/tools.js';
import type { ToolDecl } from '@livemcp/protocol';

/**
 * Định tuyến tên tool là chỗ dễ sai lặng lẽ: agent nhận đúng tool list nhưng gọi
 * thì rơi vào nhánh xử lý sai. Kiểm bằng mắt không bắt được — nên có test.
 */
describe('định tuyến tên tool', () => {
  it('không nhận nhầm tool của site thành tool hệ thống (namespace bắt đầu bằng livemcp_)', () => {
    // Site tên "LiveMCP Demo" → namespace 'livemcp_demo'. Nếu kiểm bằng prefix
    // 'livemcp_' thì mọi tool của site này bị nuốt vào nhánh tool hệ thống.
    const namespace = slugifyApp('LiveMCP Demo');
    expect(namespace).toBe('livemcp_demo');

    const qualified = qualifyToolName(namespace, 'say_hello');
    expect(qualified).toBe('livemcp_demo__say_hello');
    expect(isSystemTool(qualified)).toBe(false);

    expect(isSystemTool('livemcp_list_sites')).toBe(true);
    expect(isSystemTool('livemcp_get_tools')).toBe(true);
  });

  it('tách được namespace kể cả khi namespace hoặc tên tool có gạch dưới', () => {
    expect(parseQualifiedName('shop_viet__add_to_cart')).toEqual({
      namespace: 'shop_viet',
      toolName: 'add_to_cart',
    });
    expect(parseQualifiedName('khong_co_namespace')).toBeNull();
  });

  it('slugify bỏ dấu tiếng Việt', () => {
    expect(slugifyApp('Đặt Bàn Nhà Hàng')).toBe('dat_ban_nha_hang');
    expect(slugifyApp('!!!')).toBe('site');
  });
});

describe('buildInputSchema', () => {
  const base: ToolDecl = {
    name: 'x',
    description: 'x',
    kind: 'element',
    action: 'click',
    available: true,
  };

  it('tool click không tham số → schema rỗng', () => {
    expect(buildInputSchema(base)).toEqual({ type: 'object', properties: {} });
  });

  it('livemcp-arg → enum bắt buộc', () => {
    const schema = buildInputSchema({
      ...base,
      args: [{ name: 'item', values: ['iPhone 17', 'Galaxy S26'] }],
    });
    expect(schema.required).toEqual(['item']);
    expect(schema.properties.item).toMatchObject({
      type: 'string',
      enum: ['iPhone 17', 'Galaxy S26'],
    });
  });

  it('action=type → param text bắt buộc', () => {
    const schema = buildInputSchema({ ...base, action: 'type', submitKey: 'Enter' });
    expect(schema.required).toContain('text');
    expect(String((schema.properties.text as { description: string }).description)).toContain(
      'Enter',
    );
  });
});
