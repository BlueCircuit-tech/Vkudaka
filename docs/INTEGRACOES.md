# Integrações

Todas as integrações vivem em `backend/src/integrations/<parceiro>/` atrás de uma interface
própria. Nenhum módulo de negócio importa SDK de terceiro — trocar de fornecedor é escrever
outro adapter e mudar uma variável de ambiente.

---

## 1. Gateway de pagamento — Mercado Pago (Pix e cartão)

`integrations/payments/gateway.ts` · `integrations/payments/mercadopago.ts` ·
`integrations/payments/settings.ts` · `PAYMENT_PROVIDER`

Interface: `charge()`, `refund()`, `parseWebhook()`.

| Provedor | Situação |
|---|---|
| `mercadopago` | **implementado** (API de Pagamentos / Checkout Transparente, sem SDK, via `fetch`) |
| `pagarme` \| `asaas` | encaixe pronto — implementação é a etapa seguinte |
| `mock` | apenas desenvolvimento; o boot recusa em qualquer outro ambiente |

### Configurado pelo CRM, não pelo código

A tela **CRM › Financeiro › Pagamentos** (`/pagamentos`, só ADMIN) traz o passo a passo do painel
do Mercado Pago e um formulário com Access Token, Public Key, assinatura secreta do webhook e a
conta recebedora (RN-10). Ao salvar:

* os segredos vão para a tabela `payment_settings` cifrados (AES-256-GCM, `lib/secrets.ts`, chave
  derivada de `SETTINGS_ENCRYPTION_KEY` ou, na falta, de `JWT_SECRET`);
* `settings.ts` invalida o cache e a **próxima cobrança já usa o novo valor** — sem deploy, sem
  variável de ambiente, e vale para iOS e Android ao mesmo tempo porque quem cobra é o servidor;
* `GET /payments/methods` (público) passa a anunciar `["PIX"]` (ou `["PIX","CREDIT_CARD"]` se a
  diretoria marcar cartão); o app só mostra os botões que o servidor anuncia.

Ordem de precedência em `settings.ts`: CRM ativo → variáveis `PAYMENT_*` (quando
`PAYMENT_PROVIDER` não é `crm`) → `mock` (só desenvolvimento) → nada configurado (toda cobrança
responde `503 PAYMENT_NOT_CONFIGURED` com a mensagem “acesse CRM › Pagamentos”).

`PAYMENT_PROVIDER=crm` é o padrão. Em produção ele dispensa `PAYMENT_API_KEY`,
`PAYMENT_WEBHOOK_SECRET` e `PAYMENT_RECIPIENT_*` no ambiente — a validação acontece ao salvar a
tela (não dá para ativar sem token, assinatura e conta recebedora completos).

### Cartão

O app **não** tokeniza cartão (não há SDK do Mercado Pago embarcado). Por isso o padrão é só Pix:
`charge()` com `CREDIT_CARD` sem `cardToken` responde `400 CARD_NOT_AVAILABLE`. Quando o SDK
entrar no app, basta marcar “Oferecer cartão” no CRM: o adapter já cobra com `token` +
`installments` + bandeira obtida por BIN.

### Webhook do Mercado Pago

URL a cadastrar no painel (Webhooks → Modo produção → evento *Pagamentos*):
`POST {API_PUBLIC_URL}/webhooks/payments`. O CRM mostra a URL pronta com botão de copiar.

A assinatura vem no cabeçalho `x-signature` (`ts=…,v1=…`) e é o HMAC-SHA256, com a “assinatura
secreta” do painel, do texto `id:{data.id};request-id:{x-request-id};ts:{ts};` (partes ausentes
saem; `data.id` alfanumérico vai em minúsculas). O aviso não traz o status: após validar, o adapter
consulta `GET /v1/payments/{id}` e normaliza (`approved`→PAID, `rejected|cancelled`→FAILED,
`refunded`→REFUNDED, `charged_back`→CHARGEBACK; pendentes são ignorados com 200). O aviso de
teste do painel (id inexistente) responde 200 sem casar com nada.

A rota `/webhooks/payments` é registrada antes do `express.json()` para preservar os bytes
originais, e recusa com **401** qualquer requisição sem cabeçalho de assinatura fora de
desenvolvimento — aviso anônimo dizendo "pagamento aprovado" não passa.

### Idempotência

O webhook é reenviado pelo provedor. A trava é dupla:
`Payment.status` já `PAID` encerra o processamento, e a recarga de carteira confere a
existência de um `WalletTransaction` do tipo `TOPUP` para o mesmo `paymentId`.

### Como conferir depois de integrar

1. CRM › Pagamentos → **Testar conexão** mostra a conta dona do token.
2. Recarga Pix de valor baixo no app → `Payment` criado como `PENDING` com copia-e-cola do MP.
3. Pagar → o webhook chega assinado, `Payment` vira `PAID` e o saldo entra uma única vez.
4. Reenviar o mesmo webhook → nada muda (idempotência).
5. Enviar um webhook sem assinatura → **401**.
6. `GET /wallet/integrity` → `ok: true`.

---

## 2. In-App Purchase (fase de publicação)

Apple StoreKit e Google Play Billing entram como mais dois `PaymentProvider`, com
`PaymentMethod.APPLE_IAP` / `GOOGLE_IAP`.

Pontos de atenção antes da submissão:

* Bens digitais consumidos dentro do app — assinatura do clube e recarga de carteira —
  precisam usar o billing nativo nas duas lojas.
* Venda de peça física e ingresso de evento presencial pode continuar em Pix/cartão: são
  bens e serviços do mundo real, fora da obrigatoriedade de IAP.
* A validação de recibo (`verifyReceipt` / `purchases.subscriptions.get`) é feita no backend,
  nunca no app.

---

## 3. Correios — frete

`integrations/correios/correios.ts` · `CORREIOS_PROVIDER`, `CORREIOS_ORIGIN_ZIP`

Interface: `quote({ destinationZip, service, weightGrams, declaredValueCents })`.

O provedor `mock` usa tabela aproximada por faixa de peso e região do CEP, e só roda em
desenvolvimento — fora dele o boot para. A implementação real é contra a API CWS dos Correios
ou um intermediador (Melhor Envio, Frenet); peso e dimensões saem do cadastro da peça
(`Product.weightGrams` etc.). Enquanto não existir, o adapter lança em vez de inventar preço:
frete errado vira prejuízo por pedido.

---

## 4. Declaração de conteúdo e etiqueta

`integrations/labels/declaration.ts` · `LABEL_PROVIDER`

Emitida automaticamente quando o pedido é pago (`webhooks.routes.ts → issueDeclarationIfNeeded`).
Falha na emissão **não** desfaz a venda: o pedido segue pago e `Shipment.declarationIssuedAt`
permanece nulo para reprocessamento.

Fornecedores avaliados no briefing: Nuvemshop e geradores de etiqueta de mercado. A escolha
não afeta o restante do sistema — apenas este arquivo.

---

## 5. Push notifications

`integrations/push/push.ts` · `PUSH_PROVIDER`

Expo cobre iOS e Android com um único token por dispositivo, em lotes de até 100 mensagens.
Token recusado pelo provedor é desativado (`Device.isActive = false`) e volta a valer quando o
app registra um novo.

Gatilhos automáticos estão em RN-09; o disparo manual e o histórico ficam no CRM.

---

## 6. Storage de mídia

`STORAGE_PROVIDER` (`local` | `s3`). Fotos de perfil, imagens de produto, mídias da comunidade
e a arte de fundo do ingresso. Em produção, S3 compatível com CDN à frente.
