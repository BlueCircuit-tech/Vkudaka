import type { WalletTxType } from '@prisma/client';
import { WalletInsufficientFunds, conflict, notFound } from '../../lib/errors.js';
import type { Tx } from '../../lib/prisma.js';

/**
 * RN-04 — Carteira digital.
 *
 * Invariantes:
 *  • O saldo é a soma do ledger. `Wallet.balanceCents` é cache e é atualizado
 *    na MESMA transação de cada movimento.
 *  • O saldo nunca fica negativo.
 *  • Toda movimentação grava `balanceAfter` para auditoria e extrato.
 *
 * Todas as funções recebem `tx` (client de transação) para poderem compor o
 * checkout: debitar carteira, criar pedido e gerar crédito são atômicos.
 */

export async function getOrCreateWallet(tx: Tx, userId: string) {
  const existing = await tx.wallet.findUnique({ where: { userId } });
  if (existing) return existing;
  return tx.wallet.create({ data: { userId } });
}

interface MovementInput {
  userId: string;
  type: WalletTxType;
  /** Sempre positivo: o sinal é derivado do tipo. */
  amountCents: number;
  description: string;
  orderId?: string;
  paymentId?: string;
  createdById?: string;
}

const CREDIT_TYPES: WalletTxType[] = ['TOPUP', 'REFUND', 'ADJUSTMENT_CREDIT', 'SUBSCRIPTION'];

/**
 * Registra um movimento e atualiza o cache de saldo.
 * Usa `update` com filtro no saldo esperado (optimistic lock) para evitar que
 * duas compras simultâneas gastem o mesmo saldo.
 */
export async function move(tx: Tx, input: MovementInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw conflict('WALLET_INVALID_AMOUNT', 'Valor da movimentação deve ser positivo.');
  }

  const wallet = await getOrCreateWallet(tx, input.userId);
  if (wallet.isBlocked) {
    throw conflict('WALLET_BLOCKED', 'Carteira bloqueada. Fale com o clube.');
  }

  const signed = CREDIT_TYPES.includes(input.type) ? input.amountCents : -input.amountCents;
  const balanceAfter = wallet.balanceCents + signed;

  if (balanceAfter < 0) {
    throw new WalletInsufficientFunds(wallet.balanceCents, input.amountCents);
  }

  // Optimistic lock: só grava se o saldo ainda for o que lemos.
  const updated = await tx.wallet.updateMany({
    where: { id: wallet.id, balanceCents: wallet.balanceCents },
    data: { balanceCents: balanceAfter },
  });
  if (updated.count === 0) {
    throw conflict('WALLET_CONCURRENT_UPDATE', 'Carteira alterada durante a operação. Refaça.');
  }

  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: input.type,
      amountCents: signed,
      balanceAfter,
      description: input.description,
      orderId: input.orderId ?? null,
      paymentId: input.paymentId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return { transaction, balanceAfter, previousBalance: wallet.balanceCents };
}

export const credit = (tx: Tx, input: Omit<MovementInput, 'type'> & { type?: WalletTxType }) =>
  move(tx, { ...input, type: input.type ?? 'TOPUP' });

export const debit = (tx: Tx, input: Omit<MovementInput, 'type'>) =>
  move(tx, { ...input, type: 'PURCHASE' });

export async function getBalance(tx: Tx, userId: string): Promise<number> {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  return wallet?.balanceCents ?? 0;
}

export async function statement(tx: Tx, userId: string, skip = 0, take = 20) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw notFound('Carteira');

  const [transactions, total] = await Promise.all([
    tx.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    tx.walletTransaction.count({ where: { walletId: wallet.id } }),
  ]);

  return { balanceCents: wallet.balanceCents, transactions, total };
}

/**
 * Conferência do cache contra o ledger. Roda em job noturno e no CRM sob demanda.
 * Divergência aqui é incidente financeiro, não bug cosmético.
 */
export async function assertIntegrity(tx: Tx, userId: string) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw notFound('Carteira');

  const sum = await tx.walletTransaction.aggregate({
    where: { walletId: wallet.id },
    _sum: { amountCents: true },
  });
  const ledgerBalance = sum._sum.amountCents ?? 0;

  return {
    ok: ledgerBalance === wallet.balanceCents,
    cachedBalance: wallet.balanceCents,
    ledgerBalance,
    driftCents: wallet.balanceCents - ledgerBalance,
  };
}
