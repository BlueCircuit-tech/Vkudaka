/**
 * Conteúdo dos planos Essência e Premium conforme o briefing de 2026-11-11
 * (Black Friday): preços "de/por", selos, benefícios e linhas da tabela
 * comparativa. Atualiza pelo slug (essencia / premium) — rodar de novo é seguro.
 *
 *   DATABASE_URL=... npx tsx scripts/planos-essencia-premium.ts
 *
 * Assinaturas já existentes mantêm o preço travado no contrato; o preço novo
 * vale para as próximas concessões/renovações de troca de plano.
 * Depois de rodar, tudo continua editável em CRM › Planos e descontos.
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RENTAL_NOTE = 'Você paga só o frete. Quer alugar mais no trimestre? Vale o preço normal da peça.';

const plans = [
  {
    slug: 'essencia',
    name: 'Essência',
    priceCents: 7_900,
    compareAtPriceCents: 9_900,
    promoLabel: 'Preço Black Friday',
    highlightLabel: null,
    rebatePercent: 10,
    displayOrder: 0,
    benefits: [
      { title: '100% da assinatura em créditos VKUDAKA', compareLabel: 'Crédito VKUDAKA', compareValue: '100%' },
      { title: '1 peça para aluguel a cada trimestre (até 4/ano)', description: RENTAL_NOTE, compareLabel: 'Locação trimestral' },
      { title: '10% de desconto fidelidade nas compras', compareLabel: 'Desconto fidelidade', compareValue: '10%' },
      { title: 'Acesso à agenda de eventos VKUDAKA', compareLabel: 'Agenda de eventos' },
      { title: 'Cupons e benefícios exclusivos de parceiros', compareLabel: 'Benefícios parceiros' },
      { title: 'Lives fechadas para assinantes', compareLabel: 'Lives exclusivas' },
      { title: 'Oportunidades e condições especiais do Clube' },
    ],
  },
  {
    slug: 'premium',
    name: 'Premium',
    priceCents: 9_900,
    compareAtPriceCents: 11_900,
    promoLabel: 'Preço Black Friday',
    highlightLabel: 'Mais popular',
    rebatePercent: 15,
    displayOrder: 1,
    benefits: [
      { title: '100% da assinatura em créditos VKUDAKA', compareLabel: 'Crédito VKUDAKA', compareValue: '100%' },
      { title: '1 peça para aluguel a cada trimestre (até 4/ano)', description: RENTAL_NOTE, compareLabel: 'Locação trimestral' },
      { title: '15% de desconto fidelidade nas compras', compareLabel: 'Desconto fidelidade', compareValue: '15%' },
      { title: 'Acesso à agenda COMPLETA de eventos VKUDAKA', compareLabel: 'Agenda de eventos' },
      { title: 'Cupons e benefícios exclusivos de parceiros', compareLabel: 'Benefícios parceiros' },
      { title: 'Lives fechadas para assinantes', compareLabel: 'Lives exclusivas' },
      { title: 'Prioridade na reserva de peças para aluguel', compareLabel: 'Prioridade na locação' },
      { title: 'Experiências e oportunidades exclusivas Premium', compareLabel: 'Experiências exclusivas' },
    ],
  },
] as const;

async function main() {
  for (const plan of plans) {
    const data = {
      name: plan.name,
      priceCents: plan.priceCents,
      compareAtPriceCents: plan.compareAtPriceCents,
      promoLabel: plan.promoLabel,
      highlightLabel: plan.highlightLabel,
      rebatePercent: new Prisma.Decimal(plan.rebatePercent),
      rebateMode: 'IMMEDIATE_DISCOUNT' as const,
      interval: 'MONTHLY' as const,
      isActive: true,
      displayOrder: plan.displayOrder,
    };
    const benefits = plan.benefits.map((b, index) => ({
      title: b.title,
      description: 'description' in b ? b.description : null,
      compareLabel: 'compareLabel' in b ? b.compareLabel : null,
      compareValue: 'compareValue' in b ? b.compareValue : null,
      displayOrder: index,
    }));

    await prisma.$transaction(async (tx) => {
      const saved = await tx.plan.upsert({
        where: { slug: plan.slug },
        update: data,
        create: { ...data, slug: plan.slug },
      });
      await tx.planBenefit.deleteMany({ where: { planId: saved.id } });
      await tx.planBenefit.createMany({ data: benefits.map((b) => ({ ...b, planId: saved.id })) });
    });
    console.log(`✔ ${plan.name}: ${plan.benefits.length} benefícios`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
