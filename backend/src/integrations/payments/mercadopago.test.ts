import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildManifest, mapMethod, mapStatus, verifyMercadoPagoSignature } from './mercadopago.js';

const SECRET = 'segredo-do-painel';

const sign = (manifest: string, ts: string) =>
  `ts=${ts},v1=${createHmac('sha256', SECRET).update(manifest).digest('hex')}`;

describe('Mercado Pago — assinatura do webhook', () => {
  it('monta o manifesto como o painel documenta', () => {
    expect(buildManifest({ dataId: '123', requestId: 'req-1', ts: '1700000000' })).toBe(
      'id:123;request-id:req-1;ts:1700000000;',
    );
    // alfanumérico vai em minúsculas; partes ausentes somem
    expect(buildManifest({ dataId: 'ABC123', ts: '1' })).toBe('id:abc123;ts:1;');
  });

  it('aceita assinatura válida e recusa adulteração', () => {
    const header = sign('id:123;request-id:req-1;ts:1700000000;', '1700000000');
    expect(verifyMercadoPagoSignature(SECRET, header, { dataId: '123', requestId: 'req-1' })).toBe(true);
    expect(verifyMercadoPagoSignature(SECRET, header, { dataId: '124', requestId: 'req-1' })).toBe(false);
    expect(verifyMercadoPagoSignature('outro', header, { dataId: '123', requestId: 'req-1' })).toBe(false);
    expect(verifyMercadoPagoSignature(SECRET, undefined, { dataId: '123' })).toBe(false);
    expect(verifyMercadoPagoSignature(SECRET, 'ts=1,v1=zz', { dataId: '123' })).toBe(false);
  });
});

describe('Mercado Pago — status', () => {
  it('normaliza para o vocabulário do clube', () => {
    expect(mapStatus('approved')).toBe('PAID');
    expect(mapStatus('rejected')).toBe('FAILED');
    expect(mapStatus('refunded')).toBe('REFUNDED');
    expect(mapStatus('charged_back')).toBe('CHARGEBACK');
    expect(mapStatus('pending')).toBeNull();
    expect(mapStatus('in_process')).toBeNull();
  });
});

describe('mapMethod (Checkout Pro)', () => {
  it('reconhece Pix pelo meio ou pelo tipo', () => {
    expect(mapMethod('bank_transfer', 'pix')).toBe('PIX');
    expect(mapMethod(undefined, 'pix')).toBe('PIX');
  });
  it('separa crédito, débito e saldo Mercado Pago', () => {
    expect(mapMethod('credit_card', 'visa')).toBe('CREDIT_CARD');
    expect(mapMethod('debit_card', 'debvisa')).toBe('DEBIT_CARD');
    expect(mapMethod('account_money', 'account_money')).toBe('ACCOUNT_MONEY');
  });
  it('meio desconhecido vira MANUAL, sem quebrar o webhook', () => {
    expect(mapMethod('crypto', 'x')).toBe('MANUAL');
  });
});
