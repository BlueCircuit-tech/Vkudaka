import { Prisma } from '@prisma/client';
import type { Tx } from '../../lib/prisma.js';
import { decimalToNumber } from '../../lib/money.js';

/**
 * RN-02 / RN-05 — Crédito de mensalidade.
 *
 * Este ledger é SEPARADO da carteira de propósito: crédito de abatimento abate
 * mensalidade, não vira poder de compra na loja. Misturar os dois quebraria a
 * regra "só ativa quando o usuário não utiliza créditos da carteira" — o
 * abatimento viraria saldo e o saldo bloquearia o próximo abatimento.
 *
 * Sem teto e sem expiração: nenhuma função aqui aplica limite ou data de corte
 * a créditos de origem de compra (`expiresAt` fica NULL).
 */

interface GrantInput {
  userId: string;
  subscriptionId: string | null;
  orderId: string;
  amountCents: number;
  rebatePercent: number;
  baseCents: number;
  reason?: string;
}

/**
 * Cria o crédito gerado por uma compra.
 * `originOrderId` é UNIQUE no schema: um pedido gera no máximo um crédito —
 * é assim que "não acumulativo" fica garantido no banco, não só no código.
 */
export async function grantFromOrder(tx: Tx, input: GrantInput) {
  if (input.amountCents <= 0) return null;

  return tx.subscriptionCredit.create({
    data: {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      originOrderId: input.orderId,
      amountCents: input.amountCents,
      rebatePercent: new Prisma.Decimal(input.rebatePercent),
      baseCents: input.baseCents,
      reason: input.reason ?? `Abatimento de ${input.rebatePercent}% sobre a compra`,
      expiresAt: null, // RN-02: não expira
    },
  });
}

/** Soma disponível para abater a próxima mensalidade. */
export async function availableBalance(tx: Tx, userId: string): Promise<number> {
  const credits = await tx.subscriptionCredit.findMany({
    where: { userId, status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } },
    select: { amountCents: true, usedCents: true },
  });
  return credits.reduce((sum, c) => sum + (c.amountCents - c.usedCents), 0);
}

/**
 * RN-05 — consome créditos na geração da fatura, do mais antigo para o mais novo
 * (FIFO), até zerar a mensalidade. A sobra permanece AVAILABLE.
 *
 * Retorna quanto foi efetivamente abatido.
 */
export async function applyToInvoice(
  tx: Tx,
  params: { userId: string; invoiceId: string; grossCents: number },
): Promise<number> {
  const credits = await tx.subscriptionCredit.findMany({
    where: { userId: params.userId, status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } },
    orderBy: { createdAt: 'asc' }, // FIFO
  });

  let remaining = params.grossCents;
  let applied = 0;

  for (const credit of credits) {
    if (remaining <= 0) break;

    const usable = credit.amountCents - credit.usedCents;
    if (usable <= 0) continue;

    const take = Math.min(usable, remaining);
    const newUsed = credit.usedCents + take;

    await tx.subscriptionCredit.update({
      where: { id: credit.id },
      data: {
        usedCents: newUsed,
        status: newUsed >= credit.amountCents ? 'APPLIED' : 'PARTIALLY_APPLIED',
      },
    });

    await tx.creditApplication.create({
      data: { creditId: credit.id, invoiceId: params.invoiceId, amountCents: take },
    });

    remaining -= take;
    applied += take;
  }

  if (applied > 0) {
    await tx.subscriptionInvoice.update({
      where: { id: params.invoiceId },
      data: { creditCents: applied, netCents: Math.max(0, params.grossCents - applied) },
    });
  }

  return applied;
}

/**
 * Extrato de créditos para a tela de plano no app: o que entrou, de onde veio
 * e quanto ainda vale.
 */
export async function history(tx: Tx, userId: string, take = 30) {
  const credits = await tx.subscriptionCredit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      originOrder: { select: { code: true, totalCents: true, createdAt: true } },
      applications: { select: { amountCents: true, invoiceId: true, createdAt: true } },
    },
  });

  return credits.map((c) => ({
    id: c.id,
    amountCents: c.amountCents,
    remainingCents: c.amountCents - c.usedCents,
    rebatePercent: decimalToNumber(c.rebatePercent),
    baseCents: c.baseCents,
    status: c.status,
    reason: c.reason,
    orderCode: c.originOrder?.code ?? null,
    createdAt: c.createdAt,
    applications: c.applications,
  }));
}

/** Estorno de pedido cancela o crédito que ele gerou, se ainda não foi usado. */
export async function revokeFromOrder(tx: Tx, orderId: string) {
  const credit = await tx.subscriptionCredit.findUnique({ where: { originOrderId: orderId } });
  if (!credit || credit.status === 'CANCELED') return null;

  if (credit.usedCents > 0) {
    // Já abateu mensalidade: não se desfaz retroativamente, apenas bloqueia o saldo restante.
    return tx.subscriptionCredit.update({
      where: { id: credit.id },
      data: { amountCents: credit.usedCents, status: 'APPLIED' },
    });
  }

  return tx.subscriptionCredit.update({
    where: { id: credit.id },
    data: { status: 'CANCELED' },
  });
}
