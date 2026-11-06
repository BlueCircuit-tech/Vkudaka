import { useEffect, useState } from 'react';
import { api } from './client';

/**
 * Meios de pagamento disponíveis AGORA, segundo o servidor.
 *
 * Quem decide é a tela "Pagamentos" do CRM: enquanto o cartão não tiver o SDK
 * do gateway no app, o servidor só anuncia Pix e o botão de cartão nem
 * aparece. Sem resposta (offline, servidor dormindo), mostramos Pix — é o
 * único meio que funciona sem tokenização de qualquer jeito.
 */
export type PaymentMethod = 'PIX' | 'CREDIT_CARD';

export interface PaymentMethods {
  provider: string;
  configured: boolean;
  methods: PaymentMethod[];
  publicKey: string | null;
}

const FALLBACK: PaymentMethod[] = ['PIX'];

export function usePaymentMethods(): PaymentMethod[] {
  const [methods, setMethods] = useState<PaymentMethod[]>(FALLBACK);

  useEffect(() => {
    let alive = true;
    api
      .get<PaymentMethods>('/payments/methods')
      .then((data) => {
        if (alive && data.methods.length > 0) setMethods(data.methods);
      })
      .catch(() => {
        /* fica no fallback */
      });
    return () => {
      alive = false;
    };
  }, []);

  return methods;
}
