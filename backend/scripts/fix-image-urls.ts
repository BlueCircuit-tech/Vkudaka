/**
 * Aponta as imagens do catálogo para a mídia servida pela própria API.
 * Uso pontual: o seed antigo gravou um domínio de CDN que ainda não existe.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const base = process.env.API_PUBLIC_URL ?? 'http://localhost:3333';

const rows = await prisma.productImage.findMany();
for (const image of rows) {
  const file = image.url.split('/').pop();
  await prisma.productImage.update({
    where: { id: image.id },
    data: { url: `${base}/media/looks/${file}` },
  });
}
console.log(`imagens atualizadas: ${rows.length}`);
await prisma.$disconnect();
