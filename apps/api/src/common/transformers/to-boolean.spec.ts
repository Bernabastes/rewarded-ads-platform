import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { parseBooleanParam, ToBoolean } from './to-boolean';

class QueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  resolved?: boolean;
}

describe('ToBoolean query transformer', () => {
  it.each([
    ['false', false],
    ['true', true],
    ['0', false],
    ['1', true],
    ['no', false],
    ['yes', true],
    ['FALSE', false],
    [' True ', true],
    [true, true],
    [false, false],
    [0, false],
    [1, true],
  ])('parses %p as %p', (input, expected) => {
    expect(parseBooleanParam(input)).toBe(expected);
  });

  it('transforms "false" query strings to false (regression: Boolean("false") === true)', () => {
    const dto = plainToInstance(QueryDto, { resolved: 'false' });
    expect(dto.resolved).toBe(false);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('keeps undefined for absent params', () => {
    const dto = plainToInstance(QueryDto, {});
    expect(dto.resolved).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects garbage instead of coercing it', () => {
    const dto = plainToInstance(QueryDto, { resolved: 'maybe' });
    expect(dto.resolved).toBe('maybe');
    expect(validateSync(dto).map((e) => e.property)).toEqual(['resolved']);
  });
});
