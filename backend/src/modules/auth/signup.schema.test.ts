import { describe, expect, it } from 'vitest';
import { parseBrDate } from '../../lib/br-date.js';
import { signUpSchema } from './signup.schema.js';

// Exatamente o que o app (build da loja) manda quando a pessoa preenche a tela.
const fromApp = {
  fullName: '  Maria Teste ',
  cpf: '529.982.247-25',
  email: ' Maria@Example.com ',
  phone: '(11) 98765-4321',
  password: 'Senha123',
  birthDate: '15/03/1990',
  instagram: '@maria',
  acceptedTerms: true,
  address: {
    zipCode: '02050-020',
    street: 'Rua Luis Tavares',
    number: '133',
    district: 'Vila Guilherme',
    city: 'São Paulo',
    state: 'sp ',
  },
};

describe('parseBrDate', () => {
  it('aceita DD/MM/AAAA, AAAA-MM-DD e ISO', () => {
    expect(parseBrDate('15/03/1990')?.toISOString()).toBe('1990-03-15T00:00:00.000Z');
    expect(parseBrDate('5-3-1990')?.toISOString()).toBe('1990-03-05T00:00:00.000Z');
    expect(parseBrDate('1990-03-15')?.toISOString()).toBe('1990-03-15T00:00:00.000Z');
    expect(parseBrDate('1990-03-15T00:00:00.000Z')?.toISOString()).toBe('1990-03-15T00:00:00.000Z');
  });

  it('recusa data que não existe', () => {
    expect(parseBrDate('31/02/1990')).toBeNull();
    expect(parseBrDate('15/13/1990')).toBeNull();
    expect(parseBrDate('ontem')).toBeNull();
  });
});

describe('signUpSchema', () => {
  it('aceita o cadastro como o app envia (data DD/MM/AAAA, máscaras, espaços)', () => {
    const result = signUpSchema.safeParse(fromApp);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fullName).toBe('Maria Teste');
    expect(result.data.cpf).toBe('52998224725');
    expect(result.data.email).toBe('maria@example.com');
    expect(result.data.phone).toBe('11987654321');
    expect(result.data.birthDate?.toISOString()).toBe('1990-03-15T00:00:00.000Z');
    expect(result.data.instagram).toBe('maria');
    expect(result.data.address.zipCode).toBe('02050020');
    expect(result.data.address.state).toBe('SP');
  });

  it('opcionais vazios viram undefined', () => {
    const result = signUpSchema.safeParse({
      ...fromApp,
      birthDate: '',
      instagram: '',
      gender: '',
      address: { ...fromApp.address, number: '', complement: '' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.birthDate).toBeUndefined();
    expect(result.data.instagram).toBeUndefined();
    expect(result.data.gender).toBeUndefined();
    expect(result.data.address.complement).toBeUndefined();
  });

  it('mensagens dizem qual campo está errado', () => {
    const firstMessage = (patch: Record<string, unknown>) => {
      const result = signUpSchema.safeParse({ ...fromApp, ...patch });
      return result.success ? null : result.error.issues[0]?.message;
    };
    expect(firstMessage({ birthDate: '31/02/1990' })).toMatch(/Data de nascimento/);
    expect(firstMessage({ cpf: '529.982.247-26' })).toMatch(/CPF/);
    expect(firstMessage({ password: '123' })).toMatch(/senha/i);
    expect(firstMessage({ email: 'maria@' })).toMatch(/E-mail/);
    expect(firstMessage({ address: { ...fromApp.address, state: 'São Paulo' } })).toMatch(/UF/);
    expect(firstMessage({ address: { ...fromApp.address, zipCode: '0205' } })).toMatch(/CEP/);
  });
});
