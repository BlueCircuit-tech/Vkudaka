#!/usr/bin/env node
/**
 * Backup do PostgreSQL de desenvolvimento (container `vkudaka-postgres`).
 *
 * Existe porque em 14/09/2026 o banco de desenvolvimento foi zerado por um
 * `prisma migrate diff` cujo "shadow database" apontava, por engano, para o
 * banco principal — e não havia dump para restaurar. Rode antes de qualquer
 * operação de migração; `npm run db:migrate` já chama este script sozinho.
 *
 *   node scripts/db-backup.mjs            → backups/vkudaka-<data-hora>.sql
 *   node scripts/db-backup.mjs --restore backups/vkudaka-....sql
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTAINER = 'vkudaka-postgres';
const DB = 'vkudaka';
const USER = 'vkudaka';
// Sempre na raiz do repositório, de onde quer que o script seja chamado.
const DIR = fileURLToPath(new URL('../backups/', import.meta.url));
const KEEP = 20;

const args = process.argv.slice(2);
const restoreIndex = args.indexOf('--restore');

if (restoreIndex >= 0) {
  const file = args[restoreIndex + 1];
  if (!file || !existsSync(file)) {
    console.error('✖ informe o arquivo: --restore backups/vkudaka-....sql');
    process.exit(1);
  }
  console.log(`▸ restaurando ${file} em ${CONTAINER}/${DB} …`);
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', USER, '-d', DB, '-q'], {
    input: readFileSync(file),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('✔ restaurado');
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const target = join(DIR, `${DB}-${stamp}.sql`);

try {
  const dump = execFileSync(
    'docker',
    ['exec', CONTAINER, 'pg_dump', '-U', USER, '-d', DB, '--clean', '--if-exists', '--no-owner'],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  writeFileSync(target, dump);
  console.log(`✔ backup: ${target} (${Math.round(dump.length / 1024)} KB)`);
} catch (error) {
  console.error('✖ pg_dump falhou — o container está de pé?', error.message);
  process.exit(1);
}

// Mantém só os últimos N para a pasta não crescer sem fim.
const old = readdirSync(DIR)
  .filter((f) => f.startsWith(`${DB}-`) && f.endsWith('.sql'))
  .map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
  .slice(KEEP);
for (const { f } of old) unlinkSync(join(DIR, f));
