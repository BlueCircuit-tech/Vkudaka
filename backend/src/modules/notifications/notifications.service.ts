import type { NotificationTrigger } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { pushProvider, type PushMessage } from '../../integrations/push/push.js';

/**
 * RN-09 — mensageria.
 *
 * Um único caminho para todo push, manual ou automático: cria a campanha,
 * resolve o público, dispara e grava a entrega por usuário. Assim o CRM mostra
 * histórico e taxa de falha inclusive dos gatilhos automáticos.
 */

interface NotifyInput {
  title: string;
  body: string;
  deepLink?: string;
  imageUrl?: string;
  /** Público específico. Ausente ⇒ segmentação por plano/status. */
  userIds?: string[];
  targetPlanId?: string;
  targetActiveOnly?: boolean;
  createdById?: string;
}

async function resolveAudience(input: NotifyInput): Promise<string[]> {
  if (input.userIds) return input.userIds;

  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      role: 'MEMBER',
      ...(input.targetActiveOnly !== false || input.targetPlanId
        ? {
            subscriptions: {
              some: {
                status: { in: ['ACTIVE', 'TRIALING'] },
                currentPeriodEnd: { gte: new Date() },
                ...(input.targetPlanId ? { planId: input.targetPlanId } : {}),
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  return users.map((u) => u.id);
}

export async function dispatch(trigger: NotificationTrigger, input: NotifyInput) {
  const userIds = await resolveAudience(input);

  const campaign = await prisma.notificationCampaign.create({
    data: {
      title: input.title,
      body: input.body,
      trigger,
      status: 'SENDING',
      deepLink: input.deepLink,
      imageUrl: input.imageUrl,
      targetPlanId: input.targetPlanId ?? null,
      targetActiveOnly: input.targetActiveOnly ?? true,
      totalTargets: userIds.length,
      createdById: input.createdById ?? null,
    },
  });

  if (userIds.length === 0) {
    return prisma.notificationCampaign.update({
      where: { id: campaign.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  const devices = await prisma.device.findMany({
    where: { userId: { in: userIds }, isActive: true },
    select: { token: true, userId: true },
  });

  const messages: PushMessage[] = devices.map((d) => ({
    to: d.token,
    title: input.title,
    body: input.body,
    data: input.deepLink ? { deepLink: input.deepLink } : undefined,
    imageUrl: input.imageUrl,
  }));

  const results = await pushProvider.send(messages);
  const byToken = new Map(results.map((r) => [r.token, r]));

  await prisma.notificationDelivery.createMany({
    data: devices.map((d) => ({
      campaignId: campaign.id,
      userId: d.userId,
      deviceToken: d.token,
      success: byToken.get(d.token)?.success ?? false,
      error: byToken.get(d.token)?.error?.slice(0, 240),
    })),
  });

  // Token recusado pelo provedor não é retentado: desativa e espera novo registro.
  const failedTokens = results.filter((r) => !r.success).map((r) => r.token);
  if (failedTokens.length > 0) {
    await prisma.device.updateMany({
      where: { token: { in: failedTokens } },
      data: { isActive: false },
    });
  }

  return prisma.notificationCampaign.update({
    where: { id: campaign.id },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      totalSent: results.filter((r) => r.success).length,
      totalFailed: failedTokens.length,
    },
  });
}

/** Atalho usado pelos gatilhos automáticos espalhados pelos módulos. */
export const notifyTrigger = (trigger: NotificationTrigger, input: NotifyInput) =>
  dispatch(trigger, input).catch((error) => {
    // Push nunca derruba a operação de negócio que o originou.
    console.error(`[push] falha no gatilho ${trigger}:`, error);
    return null;
  });
