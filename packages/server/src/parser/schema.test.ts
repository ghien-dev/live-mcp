import { describe, expect, it } from 'vitest';
import type { FieldDecl } from '@livemcp/protocol';
import { fieldsToSchema } from './schema.js';

const f = (over: Partial<FieldDecl> & { name: string; htmlType: string }): FieldDecl => over;

describe('bảng chuyển đổi HTML → JSON Schema (spec §4)', () => {
  it('number có min/max → integer kèm minimum/maximum', () => {
    const schema = fieldsToSchema([
      f({ name: 'guests', htmlType: 'number', min: '1', max: '20', required: true }),
    ]);
    expect(schema.properties.guests).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 20,
    });
    expect(schema.required).toEqual(['guests']);
  });

  it('number có step thập phân → number chứ không phải integer', () => {
    expect(fieldsToSchema([f({ name: 'weight', htmlType: 'number', step: '0.1' })]).properties
      .weight).toMatchObject({ type: 'number' });
    expect(fieldsToSchema([f({ name: 'qty', htmlType: 'number', step: '2' })]).properties
      .qty).toMatchObject({ type: 'integer' });
    expect(fieldsToSchema([f({ name: 'any', htmlType: 'number', step: 'any' })]).properties
      .any).toMatchObject({ type: 'number' });
  });

  it('date/time/email/url → string + format tương ứng', () => {
    const schema = fieldsToSchema([
      f({ name: 'date', htmlType: 'date' }),
      f({ name: 'at', htmlType: 'time' }),
      f({ name: 'mail', htmlType: 'email' }),
      f({ name: 'site', htmlType: 'url' }),
    ]);
    expect(schema.properties.date).toMatchObject({ type: 'string', format: 'date' });
    expect(schema.properties.at).toMatchObject({ type: 'string', format: 'time' });
    expect(schema.properties.mail).toMatchObject({ type: 'string', format: 'email' });
    expect(schema.properties.site).toMatchObject({ type: 'string', format: 'uri' });
  });

  it('select → string + enum; checkbox → boolean; radio group → string + enum', () => {
    const schema = fieldsToSchema([
      f({ name: 'area', htmlType: 'select', options: ['indoor', 'outdoor'] }),
      f({ name: 'agree', htmlType: 'checkbox' }),
      f({ name: 'size', htmlType: 'radio-group', options: ['S', 'M', 'L'] }),
    ]);
    expect(schema.properties.area).toMatchObject({ type: 'string', enum: ['indoor', 'outdoor'] });
    expect(schema.properties.agree).toEqual({ type: 'boolean' });
    expect(schema.properties.size).toMatchObject({ type: 'string', enum: ['S', 'M', 'L'] });
  });

  it('pattern và maxlength được giữ nguyên; field không required không vào mảng required', () => {
    const schema = fieldsToSchema([
      f({ name: 'code', htmlType: 'text', pattern: '^[A-Z]{3}$', maxLength: 3 }),
    ]);
    expect(schema.properties.code).toMatchObject({ pattern: '^[A-Z]{3}$', maxLength: 3 });
    expect(schema.required).toBeUndefined();
  });

  it('dựng lại đúng schema của ví dụ book_table trong spec §4', () => {
    const schema = fieldsToSchema([
      f({
        name: 'guests',
        htmlType: 'number',
        min: '1',
        max: '20',
        required: true,
        description: 'Số lượng khách, từ 1 đến 20',
      }),
      f({
        name: 'date',
        htmlType: 'date',
        required: true,
        description: 'Ngày đặt bàn, định dạng YYYY-MM-DD',
      }),
      f({
        name: 'area',
        htmlType: 'select',
        options: ['indoor', 'outdoor'],
        description: 'Khu vực ngồi mong muốn',
      }),
    ]);

    expect(schema).toEqual({
      type: 'object',
      properties: {
        guests: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Số lượng khách, từ 1 đến 20',
        },
        date: {
          type: 'string',
          format: 'date',
          description: 'Ngày đặt bàn, định dạng YYYY-MM-DD',
        },
        area: {
          type: 'string',
          enum: ['indoor', 'outdoor'],
          description: 'Khu vực ngồi mong muốn',
        },
      },
      required: ['guests', 'date'],
    });
  });
});
