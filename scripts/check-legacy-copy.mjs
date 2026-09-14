#!/usr/bin/env node
/**
 * Guard de limpeza de escopo (RN-11).
 * Falha o build se qualquer texto/serviço removido do legado reaparecer no código novo.
 * O protótipo antigo vive em legacy/ e é intencionalmente ignorado.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['backend/src', 'crm-web/src', 'mobile/src', 'docs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'legacy', 'coverage']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.html', '.sql', '.prisma']);

/** Cada entrada: [rótulo, regex]. Acentos e caixa são normalizados antes do teste. */
const FORBIDDEN = [
  // "Look do trimestre" saiu desta lista em 14/09/2026: a Valéria trouxe o
  // benefício de volta (1 peça de aluguel por trimestre, RN-12). O nome de
  // menu "Alugar um look" continua fora — virou "Escolha seu Look".
  // RN-02 — a direção corrigiu: o abatimento NÃO é acumulativo; é x% da peça,
  // só quando o saldo da carteira não é usado.
  ['Abatimento acumulativo (RN-02: nao e acumulativo)', /abatimento acumulativ/],
  ['Abatimento acumulado no trimestre', /acumulad[oa] no trimestre/],
  ['Alugar um look', /alugar um look/],
  ['Personal stylist por estacao', /personal stylist/],
  ['Consultoria "sua melhor versao" 1x por colecao', /consultoria[^.]{0,40}melhor vers/],
  ['Ajustes de costura cortesia', /ajustes de costura/],
  ['Sala do clube na flagship', /sala do clube/],
  ['Provador reservado / guarda-volumes', /guarda-volumes/],
];

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(entry))) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    // O próprio guard e a doc de regras citam os termos para documentá-los.
    if (file.includes('check-legacy-copy')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const flat = normalize(line);
      for (const [label, re] of FORBIDDEN) {
        if (re.test(flat)) violations.push({ file, line: i + 1, label, text: line.trim().slice(0, 120) });
      }
    });
  }
}

if (violations.length) {
  console.error('\x1b[31m✖ Escopo removido reapareceu no código (RN-11):\x1b[0m\n');
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    [${v.label}]\n    ${v.text}\n`);
  process.exit(1);
}
console.log('✔ Limpeza de escopo OK — nenhum texto/serviço removido encontrado.');
