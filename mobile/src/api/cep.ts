/**
 * Endereço a partir do CEP (2026-11-12) — preenche o cadastro sozinho.
 *
 * APIs públicas e gratuitas, chamadas direto do app: ViaCEP primeiro e, se
 * ela falhar ou não responder, a BrasilAPI. Nenhuma das duas pede chave.
 * Falhou tudo? Devolve null e a pessoa digita o endereço como antes.
 */

export interface CepAddress {
  street: string;
  district: string;
  city: string;
  state: string;
}

const withTimeout = async (url: string, ms = 6000): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

async function viaCep(cep: string): Promise<CepAddress | null> {
  const data = (await withTimeout(`https://viacep.com.br/ws/${cep}/json/`)) as {
    erro?: boolean | string;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
  };
  if (data.erro) return null;
  return {
    street: data.logradouro ?? '',
    district: data.bairro ?? '',
    city: data.localidade ?? '',
    state: data.uf ?? '',
  };
}

async function brasilApi(cep: string): Promise<CepAddress | null> {
  const data = (await withTimeout(`https://brasilapi.com.br/api/cep/v1/${cep}`)) as {
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
  if (!data.city) return null;
  return {
    street: data.street ?? '',
    district: data.neighborhood ?? '',
    city: data.city ?? '',
    state: data.state ?? '',
  };
}

/** `null` = CEP não existe ou nenhuma API respondeu. */
export async function lookupCep(rawCep: string): Promise<CepAddress | null> {
  const cep = rawCep.replace(/\D/g, '');
  if (cep.length !== 8) return null;
  try {
    const found = await viaCep(cep);
    if (found) return found;
  } catch {
    // ViaCEP fora do ar: tenta a outra.
  }
  try {
    return await brasilApi(cep);
  } catch {
    return null;
  }
}
