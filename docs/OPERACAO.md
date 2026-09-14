# Operação

## Ambientes

| Ambiente | API | Banco | Gateway |
|---|---|---|---|
| Desenvolvimento | localhost:3333 | Postgres local (docker compose) | `mock` |
| Homologação | api-hml.vkudaka… | instância dedicada | sandbox do provedor |
| Produção | api.vkudaka… | instância gerenciada com backup diário | produção |

O boot valida as variáveis de ambiente (`backend/src/config/env.ts`) e **recusa subir** em
produção sem conta recebedora configurada ou com `PAYMENT_PROVIDER=mock`.

## Contas e credenciais (definido pela Valéria em 14/09/2026)

* **E-mail das contas de infraestrutura** (Vercel, Supabase, lojas): `Clubevkudaka@gmail.com`.
* **Gateway de pagamento:** Mercado Pago (`PAYMENT_PROVIDER=mercadopago`).
* **CPF da conta recebedora:** fornecido em privado; entra **somente** em
  `PAYMENT_RECIPIENT_DOCUMENT` no ambiente de produção. Não versionar, não colar em issue,
  não mandar em grupo.

## RN-10 — conta recebedora

Todos os recebimentos (gateway hoje, IAP na publicação) são roteados para a conta bancária
titular. Os dados são fornecidos pela diretoria e configurados **apenas no ambiente de
produção**:

```
PAYMENT_RECIPIENT_NAME=
PAYMENT_RECIPIENT_DOCUMENT=
PAYMENT_RECIPIENT_BANK=
PAYMENT_RECIPIENT_AGENCY=
PAYMENT_RECIPIENT_ACCOUNT=
PAYMENT_RECIPIENT_PIX_KEY=
```

Regras:

* Nenhum desses valores entra no repositório, em log, em resposta de API ou no app.
* O que trafega é `Payment.recipientRef`, uma referência mascarada suficiente para auditoria.
* Alterar a conta é mudança de infraestrutura (secret manager), não de código.

## Rotinas periódicas

| Rotina | Frequência | O que faz |
|---|---|---|
| Geração de faturas | diária | cria a `SubscriptionInvoice` do período e aplica os créditos de abatimento (FIFO, sem teto, sem expiração) |
| Cobrança de assinatura | diária | envia a fatura ao gateway e atualiza o status |
| Conferência de carteiras | diária | `walletService.assertIntegrity` — divergência entre cache e ledger é incidente financeiro |
| Push agendado | a cada 5 min | dispara campanhas com `scheduledFor` vencido |
| Aluguéis em atraso | diária | marca `RETURN_PENDING` vencido e notifica |

## Backup e retenção

* Backup diário do PostgreSQL com retenção de 30 dias; teste de restauração mensal.
* **Desenvolvimento:** `npm run db:backup` (em `backend/`) gera `backups/vkudaka-<data>.sql`
  via `pg_dump` no container; `node scripts/db-backup.mjs --restore <arquivo>` restaura.
  `npm run db:migrate` faz o backup sozinho antes de migrar.
* **Nunca** passe `--shadow-database-url` derivada de `DATABASE_URL` por manipulação de
  texto: em 14/09/2026 a URL montada assim apontou para o banco principal e o Prisma o
  zerou (o shadow é recriado do zero por definição). Sem terminal interativo, gere a
  migration com `prisma migrate diff --from-schema-datasource … --to-schema-datamodel …`,
  que só lê, e aplique com `prisma migrate deploy`.
* Nada com rastro financeiro é apagado fisicamente: pedidos, pagamentos, movimentos de
  carteira e créditos usam soft delete ou status.
* `AuditLog` registra alteração de plano, ajuste manual de carteira e mudança de status de
  usuário — quem fez, quando e o valor anterior.

## LGPD

* Exclusão de conta: `User.deletedAt` + anonimização de nome, e-mail e telefone, preservando
  os registros contábeis exigidos por lei.
* Dados de medidas e preferências são do titular e saem na exclusão.
* O formulário público de modelos coleta dado pessoal: exibir aviso de privacidade no link
  divulgado.

## Publicação nas lojas

1. `expo prebuild` e build via EAS.
2. Trocar o gateway web pelo billing nativo nos fluxos de assinatura e recarga (ver
   `docs/INTEGRACOES.md`, seção 2).
3. Preencher as políticas de privacidade e o formulário de coleta de dados das duas lojas —
   o app coleta CPF, endereço, medidas corporais e mídia enviada pelo usuário.
4. Conta de teste para revisão da Apple: usar um assinante ativo do ambiente de homologação,
   já que o app é fechado para não assinantes (RN-01) e a revisão precisa ver o conteúdo.
