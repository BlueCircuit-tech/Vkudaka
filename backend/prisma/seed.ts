import { PrismaClient, Prisma } from '@prisma/client';
import argon2 from 'argon2';
import dayjs from 'dayjs';
import * as walletService from '../src/domain/wallet/wallet.service.js';

/**
 * Seed de desenvolvimento.
 *
 * Cria o mínimo para o app e o CRM abrirem funcionando: dois planos com
 * percentuais distintos (para exercitar a RN-02), catálogo, um evento e os
 * textos editáveis. Nenhum dado sensível — as credenciais são de dev.
 */
const prisma = new PrismaClient();

const MEDIA_BASE = process.env.API_PUBLIC_URL ?? 'http://localhost:3333';
const IMAGE = (file: string) => `${MEDIA_BASE}/media/looks/${file}`;

async function main() {
  console.log('▸ Planos');
  // Valores e benefícios enviados pela Valéria (14/09/2026). Tudo editável em
  // "Planos e descontos" — o seed só dá o ponto de partida.
  const essence = await prisma.plan.upsert({
    where: { slug: 'essencia' },
    update: {},
    create: {
      name: 'Essência',
      slug: 'essencia',
      description: 'Seu primeiro passo para um guarda-roupa mais inteligente.',
      priceCents: 8_900,
      interval: 'MONTHLY',
      rebatePercent: new Prisma.Decimal(10),
      rebateMode: 'IMMEDIATE_DISCOUNT',
      displayOrder: 1,
      benefits: {
        create: [
          {
            title: '👗 1 peça para aluguel a cada trimestre, custo zero — até 4 peças por ano',
            description: 'Você paga só o frete. Quer alugar mais no trimestre? Vale o preço normal da peça.',
            displayOrder: 0,
          },
          { title: '✨ 10% de desconto de fidelidade nas compras', displayOrder: 1 },
          { title: '🎟️ Acesso à agenda de eventos VKUDAKA', displayOrder: 2 },
          { title: '💄 Cupons e benefícios exclusivos de parceiros de moda e beleza', displayOrder: 3 },
          { title: '🎥 Lives fechadas exclusivas para assinantes', displayOrder: 4 },
          { title: '⭐ Acesso a oportunidades e condições especiais do Clube', displayOrder: 5 },
        ],
      },
    },
  });

  const signature = await prisma.plan.upsert({
    where: { slug: 'premium' },
    update: {},
    create: {
      name: 'Premium',
      slug: 'premium',
      description: 'Mais exclusividade, mais benefícios e mais experiências VKUDAKA.',
      priceCents: 11_900,
      interval: 'MONTHLY',
      rebatePercent: new Prisma.Decimal(15),
      rebateMode: 'IMMEDIATE_DISCOUNT',
      displayOrder: 0,
      benefits: {
        create: [
          {
            title: '👗 1 peça para aluguel a cada trimestre, custo zero — até 4 peças por ano',
            description: 'Você paga só o frete. Quer alugar mais no trimestre? Vale o preço normal da peça.',
            displayOrder: 0,
          },
          { title: '✨ 15% de desconto de fidelidade nas compras', displayOrder: 1 },
          { title: '🎟️ Acesso à agenda completa de eventos VKUDAKA', displayOrder: 2 },
          { title: '💄 Cupons e benefícios exclusivos de parceiros de moda e beleza', displayOrder: 3 },
          { title: '🎥 Lives fechadas exclusivas para assinantes', displayOrder: 4 },
          { title: '⭐ Prioridade na reserva de peças para aluguel', displayOrder: 5 },
          { title: '🥂 Experiências e oportunidades exclusivas para membros Premium', displayOrder: 6 },
        ],
      },
    },
  });

  console.log('▸ Usuários');
  const passwordHash = await argon2.hash('vkudaka123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@vkudaka.local' },
    update: {},
    create: {
      fullName: 'Administração VKUDAKA',
      cpf: '52998224725',
      email: 'admin@vkudaka.local',
      phone: '5511999990000',
      role: 'ADMIN',
      passwordHash,
      acceptedTermsAt: new Date(),
      wallet: { create: { balanceCents: 0 } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'portaria@vkudaka.local' },
    update: {},
    create: {
      fullName: 'Portaria VKUDAKA',
      cpf: '39053344705',
      email: 'portaria@vkudaka.local',
      phone: '5511999990001',
      role: 'GATE',
      passwordHash,
      acceptedTermsAt: new Date(),
    },
  });

  const member = await prisma.user.upsert({
    where: { email: 'assinante@vkudaka.local' },
    update: {},
    create: {
      fullName: 'Assinante Teste',
      cpf: '16899535009',
      email: 'assinante@vkudaka.local',
      phone: '5511988887777',
      instagram: 'assinante.teste',
      gender: 'FEMININO',
      passwordHash,
      acceptedTermsAt: new Date(),
      wallet: { create: { balanceCents: 0 } },
      measurements: { create: { dressSize: '38', shoeSize: '37', heightCm: 168 } },
      addresses: {
        create: {
          zipCode: '01310100',
          street: 'Avenida Paulista',
          number: '1000',
          district: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
          isDefault: true,
        },
      },
    },
  });

  // R$ 100 para exercitar a RN-02 — entram pelo razão da carteira, não como
  // saldo solto. `GET /wallet/integrity` compara o saldo com a soma dos
  // lançamentos: um saldo inicial sem lançamento acusaria diferença para
  // sempre e o alarme perderia o sentido.
  const openingBalance = await prisma.walletTransaction.findFirst({
    where: { wallet: { userId: member.id } },
  });
  if (!openingBalance) {
    await walletService.credit(prisma, {
      userId: member.id,
      type: 'ADJUSTMENT_CREDIT',
      amountCents: 10_000,
      description: 'Saldo inicial de demonstração',
    });
  }

  const hasSubscription = await prisma.subscription.findFirst({ where: { userId: member.id } });
  if (!hasSubscription) {
    await prisma.subscription.create({
      data: {
        userId: member.id,
        planId: signature.id,
        status: 'ACTIVE',
        currentPeriodStart: dayjs().startOf('month').toDate(),
        currentPeriodEnd: dayjs().add(1, 'month').startOf('month').toDate(),
        priceCents: signature.priceCents,
      },
    });
  }

  console.log('▸ Catálogo');
  // Categorias de roupa (2026-11-11): valem para venda e locação.
  const alfaiataria = await prisma.category.upsert({
    where: { slug: 'alfaiataria' },
    update: {},
    create: { name: 'Alfaiataria', slug: 'alfaiataria', scope: 'BOTH', displayOrder: 0 },
  });
  const modaFesta = await prisma.category.upsert({
    where: { slug: 'moda-festa' },
    update: {},
    create: { name: 'Moda Festa', slug: 'moda-festa', scope: 'BOTH', displayOrder: 1 },
  });

  const products = [
    {
      sku: 'VK-CELESTE',
      name: 'Conjunto Celeste',
      slug: 'conjunto-celeste',
      salePriceCents: 89_900,
      rentalPriceCents: 24_900,
      availability: 'BOTH' as const,
      image: 'prod1.jpg',
    },
    {
      sku: 'VK-SIENA',
      name: 'Vestido Siena',
      slug: 'vestido-siena',
      salePriceCents: 129_900,
      rentalPriceCents: 34_900,
      availability: 'BOTH' as const,
      image: 'prod2.jpg',
    },
    {
      sku: 'VK-ROSE',
      name: 'Essência Rosé',
      slug: 'essencia-rose',
      salePriceCents: 99_900,
      rentalPriceCents: null,
      availability: 'SALE' as const,
      image: 'prod3.jpg',
    },
    {
      sku: 'VK-BLAZER',
      name: 'Calça + Blazer',
      slug: 'calca-blazer',
      salePriceCents: 149_900,
      rentalPriceCents: null,
      availability: 'SALE' as const,
      image: 'prod4.jpg',
    },
    {
      sku: 'VK-IMPONENCIA',
      name: 'Imponência Clássica',
      slug: 'imponencia-classica',
      salePriceCents: null,
      rentalPriceCents: 39_900,
      availability: 'RENTAL' as const,
      image: 'prod5.jpg',
    },
  ];

  for (const item of products) {
    await prisma.product.upsert({
      where: { sku: item.sku },
      update: {},
      create: {
        sku: item.sku,
        name: item.name,
        slug: item.slug,
        description: 'Peça oficial VKUDAKA.',
        categoryId: item.availability === 'SALE' ? alfaiataria.id : modaFesta.id,
        availability: item.availability,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        salePriceCents: item.salePriceCents,
        rentalPriceCents: item.rentalPriceCents,
        weightGrams: 800,
        images: { create: [{ url: IMAGE(item.image), isCover: true, displayOrder: 0 }] },
        variants: {
          create: ['36', '38', '40', '42'].map((size) => ({
            size,
            color: 'Único',
            sku: `${item.sku}-${size}`,
            stock: item.salePriceCents ? 5 : 0,
            rentalStock: item.rentalPriceCents ? 2 : 0,
          })),
        },
      },
    });
  }

  console.log('▸ Evento');
  await prisma.event.upsert({
    where: { slug: 'fashion-week-vkudaka' },
    update: {},
    create: {
      title: 'Fashion Week VKUDAKA',
      slug: 'fashion-week-vkudaka',
      description: 'Três dias de desfiles e o lançamento da coleção anual.',
      venueName: 'Casa VKUDAKA',
      venueAddress: 'São Paulo, SP',
      startsAt: dayjs().add(45, 'day').hour(20).toDate(),
      endsAt: dayjs().add(47, 'day').hour(23).toDate(),
      capacity: 300,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      subscribersFree: true,
      sellsPublicTickets: true,
      ticketTypes: {
        create: [
          { name: 'Inteira', priceCents: 12_000, quantity: 150 },
          { name: 'Mesa (4 lugares)', priceCents: 40_000, quantity: 20 },
        ],
      },
    },
  });

  console.log('▸ Regras de frete e cupons');
  const freeShippingRule = await prisma.shippingRule.findFirst({
    where: { name: 'Frete grátis acima de R$ 600' },
  });
  if (!freeShippingRule) {
    await prisma.shippingRule.create({
      data: { name: 'Frete grátis acima de R$ 600', minSubtotalCents: 60_000, priority: 10 },
    });
  }

  await prisma.coupon.upsert({
    where: { code: 'BEMVINDA' },
    update: {},
    create: {
      code: 'BEMVINDA',
      description: 'R$ 50 na primeira compra',
      type: 'FIXED',
      value: new Prisma.Decimal(5_000),
      minSubtotalCents: 30_000,
      perUserLimit: 1,
    },
  });

  console.log('▸ Textos do app');
  await prisma.appContent.upsert({
    where: { key: 'purchase_rules' },
    update: {},
    create: {
      key: 'purchase_rules',
      title: 'Regras de compra',
      body:
        '1. As compras no app são exclusivas para assinantes do Clube VKUDAKA com assinatura ativa.\n\n' +
        '2. Devolução: você tem 7 dias corridos, contados do recebimento, para solicitar a devolução de uma peça. ' +
        'A peça deve estar sem uso, com etiqueta e na embalagem original. O contato é pelo WhatsApp do clube.\n\n' +
        '3. Créditos e desconto fidelidade: 100% da sua mensalidade vira crédito VKUDAKA na carteira, e você pode usá-lo nas compras. ' +
        'O desconto fidelidade do seu plano vale em toda compra, inclusive pagando com créditos. Peças em promoção não recebem o desconto.\n\n' +
        '4. Frete: calculado pelos Correios no fechamento do pedido, conforme CEP e peso. ' +
        'Peças e cupons com frete grátis são indicados na loja.\n\n' +
        '5. Pagamento: Pix, cartão ou créditos da carteira. O pedido é confirmado após a aprovação do pagamento.',
      updatedById: admin.id,
    },
  });

  // Regra de locação — texto oficial da Valéria (14/09/2026).
  await prisma.appContent.upsert({
    where: { key: 'rental_rules' },
    update: {},
    create: {
      key: 'rental_rules',
      title: 'Regra de locação',
      body:
        'A peça deverá ser devolvida na mesma condição em que foi entregue, dentro do prazo combinado e com os devidos cuidados durante o uso.\n\n' +
        'Em caso de manchas, rasgos, furos, perda de aviamentos ou qualquer outra danificação que comprometa a peça, a cliente será responsável pelo pagamento do valor integral da peça.\n\n' +
        'VKUDAKA — Moda com essência. Vista sua melhor versão.',
      updatedById: admin.id,
    },
  });

  // Texto dos créditos — regra de 2026-11-11 (100% da mensalidade vira
  // crédito; desconto fidelidade vale também pagando com créditos). Editável no CRM.
  await prisma.appContent.upsert({
    where: { key: 'rebate_rules' },
    update: {},
    create: {
      key: 'rebate_rules',
      title: 'Como funcionam os créditos',
      body:
        '100% da sua mensalidade vira crédito VKUDAKA. A cada mensalidade paga, o valor integral entra na sua carteira para você usar em peças da marca.\n\n' +
        'Os créditos se acumulam mês a mês: planeje, acumule e escolha suas peças quando quiser.\n\n' +
        'Desconto fidelidade: em toda compra de peça você tem o desconto do seu plano (hoje 10% no Essência e 15% no Premium), inclusive quando paga com os créditos.\n\n' +
        'Peças em promoção já estão com preço reduzido e não recebem o desconto fidelidade.\n\n' +
        'Você também pode comprar créditos avulsos na carteira, por Pix ou cartão.',
      updatedById: admin.id,
    },
  });

  console.log('\n✔ Seed concluído');
  console.log('  admin@vkudaka.local / vkudaka123      (ADMIN)');
  console.log('  portaria@vkudaka.local / vkudaka123   (GATE)');
  console.log('  assinante@vkudaka.local / vkudaka123  (Premium, saldo de demonstração na carteira)');
  console.log(`  planos: ${essence.name} 10% · ${signature.name} 15%`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
