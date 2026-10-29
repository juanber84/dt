import { describe, expect, it } from 'vitest';
import { StrengthError, StrengthErrorCode, setText } from '../src/index.js';

describe('contrato de las apps de fuerza', () => {
  it('setText: reps x kg, sin peso o por tiempo', () => {
    expect(setText({ reps: 8, weightKg: 70 })).toBe('8x70');
    expect(setText({ reps: 12, weightKg: 0 })).toBe('12');
    expect(setText({ reps: 10, weightKg: 49.8951 })).toBe('10x49.9');
    expect(setText({ timeS: 45 })).toBe('45s');
    expect(setText({ timeS: 30, weightKg: 10 })).toBe('30s x10');
    expect(setText({})).toBe('?');
  });

  it('StrengthError lleva su código', () => {
    const err = new StrengthError(StrengthErrorCode.NOT_OURS, 'es del usuario');
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'StrengthError', code: 'NOT_OURS' });
  });
});
