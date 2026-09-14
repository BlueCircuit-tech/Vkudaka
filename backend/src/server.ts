import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Clube VKUDAKA API · porta ${env.PORT} · ${env.NODE_ENV}`);
});

const shutdown = async (signal: string) => {
  console.log(`\n${signal} recebido, encerrando...`);
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
  // Não deixa conexão pendurada segurar o container.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
