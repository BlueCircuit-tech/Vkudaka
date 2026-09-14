import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn', 'error'] });

/** Tipo do client dentro de uma transação — usado pelos services. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
