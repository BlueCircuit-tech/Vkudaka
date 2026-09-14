import { env } from '../../config/env.js';

/**
 * Adapter de frete (RN-08). A interface é nossa; o fornecedor é detalhe.
 * Trocar Correios por Melhor Envio não deve tocar em nenhuma regra de negócio.
 */

export interface FreightRequest {
  originZip?: string;
  destinationZip: string;
  service: 'PAC' | 'SEDEX';
  weightGrams: number;
  declaredValueCents: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface FreightQuote {
  service: 'PAC' | 'SEDEX';
  priceCents: number;
  estimatedDays: number;
}

export interface FreightProvider {
  quote(request: FreightRequest): Promise<FreightQuote>;
}

/**
 * Tabela aproximada para desenvolvimento e testes: preço por faixa de peso e
 * por região de destino (primeiro dígito do CEP). Substituída em produção.
 */
const mockProvider: FreightProvider = {
  async quote(request) {
    const region = Number(request.destinationZip[0] ?? '0');
    const base = request.service === 'SEDEX' ? 2800 : 1800;
    const weightFactor = Math.ceil(request.weightGrams / 500) * (request.service === 'SEDEX' ? 450 : 280);
    const distanceFactor = region * (request.service === 'SEDEX' ? 260 : 150);
    const insurance = Math.round(request.declaredValueCents * 0.006);

    return {
      service: request.service,
      priceCents: base + weightFactor + distanceFactor + insurance,
      estimatedDays: request.service === 'SEDEX' ? 2 + Math.floor(region / 3) : 5 + region,
    };
  },
};

/**
 * Implementação real: chamar a API dos Correios (CWS) ou do intermediador.
 * Mantida como stub explícito para que o ponto de integração seja evidente.
 */
const correiosProvider: FreightProvider = {
  async quote(request) {
    void env.CORREIOS_USER;
    void request;
    throw new Error(
      'FreightProvider "correios" não implementado. Configure CORREIOS_* e implemente a chamada CWS.',
    );
  },
};

export const freightProvider: FreightProvider =
  env.CORREIOS_PROVIDER === 'mock' ? mockProvider : correiosProvider;
