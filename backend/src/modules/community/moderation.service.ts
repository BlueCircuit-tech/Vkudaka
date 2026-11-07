import { prisma } from '../../lib/prisma.js';

/**
 * Bloqueio entre membros (política de UGC do Google Play / App Store).
 *
 * O feed e os comentários escondem, para quem bloqueou, tudo do bloqueado — e
 * também escondem do bloqueado o que o bloqueador publica. Assim ninguém
 * precisa "saber" que foi bloqueado para o convívio parar.
 */
export async function hiddenUserIdsFor(userId: string): Promise<string[]> {
  const blocks = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const block of blocks) ids.add(block.blockerId === userId ? block.blockedId : block.blockerId);
  return Array.from(ids);
}
