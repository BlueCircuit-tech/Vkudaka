import { env } from '../../config/env.js';

/**
 * Declaração de conteúdo e etiqueta (3.6).
 * Emitida automaticamente quando o pedido é pago.
 */

export interface DeclarationItem {
  description: string;
  quantity: number;
  valueCents: number;
}

export interface DeclarationRequest {
  orderCode: string;
  sender: { name: string; document: string; address: string; zipCode: string };
  recipient: { name: string; document: string; address: string; zipCode: string };
  items: DeclarationItem[];
  totalCents: number;
  weightGrams: number;
}

export interface DeclarationResult {
  declarationUrl: string | null;
  labelUrl: string | null;
  trackingCode: string | null;
  provider: string;
}

export interface LabelProvider {
  issue(request: DeclarationRequest): Promise<DeclarationResult>;
}

const mockProvider: LabelProvider = {
  async issue(request) {
    return {
      declarationUrl: `${env.API_PUBLIC_URL}/documents/declaracao/${request.orderCode}.pdf`,
      labelUrl: null,
      trackingCode: null,
      provider: 'mock',
    };
  },
};

const externalProvider: LabelProvider = {
  async issue() {
    throw new Error(
      `LabelProvider "${env.LABEL_PROVIDER}" não implementado. Ver docs/INTEGRACOES.md.`,
    );
  },
};

/** Sem emissão de declaração/etiqueta: o pedido segue sem documento gerado. */
const noneProvider: LabelProvider = {
  async issue() {
    return { declarationUrl: null, labelUrl: null, trackingCode: null, provider: 'none' };
  },
};

export const labelProvider: LabelProvider =
  env.LABEL_PROVIDER === 'none'
    ? noneProvider
    : env.LABEL_PROVIDER === 'mock'
      ? mockProvider
      : externalProvider;
