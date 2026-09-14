/** Erros de domínio com código estável — o app decide o comportamento pelo código. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) =>
  new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Não autenticado') =>
  new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'Sem permissão') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (entity: string) =>
  new AppError(404, 'NOT_FOUND', `${entity} não encontrado`);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);

/**
 * RN-01 — 402 é o código que o app intercepta para abrir a tela de
 * redirecionamento ao site externo.
 */
export const subscriptionRequired = (storeUrl: string) =>
  new AppError(
    402,
    'SUBSCRIPTION_REQUIRED',
    'Esta área é exclusiva para assinantes do Clube VKUDAKA.',
    { storeUrl },
  );

export class WalletInsufficientFunds extends AppError {
  constructor(balanceCents: number, requestedCents: number) {
    super(409, 'WALLET_INSUFFICIENT_FUNDS', 'Saldo insuficiente na carteira.', {
      balanceCents,
      requestedCents,
    });
  }
}
