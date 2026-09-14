import { describe, expect, it } from 'vitest';
import { isValidCPF, onlyDigits } from './cpf.js';

describe('CPF', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224725')).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    expect(isValidCPF('529.982.247-26')).toBe(false);
  });

  it('rejeita sequências repetidas e tamanho errado', () => {
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('1234567890')).toBe(false);
  });

  it('normaliza para dígitos', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725');
  });
});
