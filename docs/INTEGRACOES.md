# Integrações

Todas as integrações vivem em `backend/src/integrations/<parceiro>/` atrás de uma interface
própria. Nenhum módulo de negócio importa SDK de terceiro — trocar de fornecedor é escrever
outro adapter e mudar uma variável de ambiente.

---

## 1. Gateway de pagamento — Pix e cartão

`integrations/payments/gateway.ts` · `PAYMENT_PROVIDER`

Interface: `charge()`, `refund()`, `parseWebhook()`.

| Provedor | Situação |
|---|---|
| `mercadopago` \| `pagarme` \| `asaas` | encaixe pronto — **implementação é a etapa seguinte** |
| `mock` | apenas desenvolvimento; o boot recusa em qualquer outro ambiente |

### Nada simula pagamento fora de desenvolvimento

Três travas, todas em código:

* `config/env.ts` derruba o boot se `PAYMENT_PROVIDER=mock` (ou qualquer outro `mock`)
  aparecer com `NODE_ENV` diferente de `development`, dizendo qual variável está simulando o quê.
* Escolher um provedor real sem `PAYMENT_API_KEY` e `PAYMENT_WEBHOOK_SECRET` também derruba o
  boot fora de desenvolvimento — dentro dele vira aviso, para conseguir programar o adapter
  antes das chaves chegarem.
* Enquanto o adapter não existir, `charge()`, `refund()` e `parseWebhook()` lançam com a
  mensagem do que falta. Nenhuma cobrança é dada como aprovada por engano.

### O que precisamos do gateway contratado

1. Chave de API do ambiente de produção → `PAYMENT_API_KEY`.
2. Segredo de assinatura de webhook → `PAYMENT_WEBHOOK_SECRET`.
3. Dados da conta recebedora da Valéria (RN-10) → `PAYMENT_RECIPIENT_*`. Nunca versionados;
   entram só no ambiente de produção.
4. URL de webhook registrada no painel do provedor: `POST {API_PUBLIC_URL}/webhooks/payments`.
5. Credencial de tokenização do cartão para o app (chave pública do SDK).

### O que o adapter precisa entregar

| Método | Contrato |
|---|---|
| `charge()` | recebe centavos e, no cartão, apenas `cardToken` — o backend nunca vê o número, e não pode entrar no escopo PCI. Devolve `externalId` (chave que o webhook usa para reencontrar o pagamento), status normalizado e, no Pix, o copia-e-cola |
| `refund()` | estorno parcial ou total, em centavos |
| `parseWebhook()` | valida a assinatura sobre o **corpo bruto** e normaliza o evento. Assinatura inválida deve lançar, nunca devolver evento |
| `recipientRef` | RN-10 — referência opaca da conta recebedora, gravada em cada pagamento para auditoria |

Para assinatura HMAC-SHA256 (formato mais comum), use `verifySignature()` do próprio
`gateway.ts`: compara em tempo constante e trata comprimento diferente como falha. Provedores
com esquema próprio (Mercado Pago usa `ts` + `v1` no cabeçalho `x-signature`) montam a string
de acordo com a documentação e chamam a mesma função no final.

A rota `/webhooks/payments` é registrada antes do `express.json()` para preservar os bytes
originais, e recusa com **401** qualquer requisição sem cabeçalho de assinatura fora de
desenvolvimento — aviso anônimo dizendo "pagamento aprovado" não passa.

### Idempotência

O webhook é reenviado pelo provedor. A trava é dupla:
`Payment.status` já `PAID` encerra o processamento, e a recarga de carteira confere a
existência de um `WalletTransaction` do tipo `TOPUP` para o mesmo `paymentId`.

### Como conferir depois de integrar

1. Cobrança Pix de valor baixo → `Payment` criado como `PENDING` com copia-e-cola.
2. Pagar → o webhook chega assinado, `Payment` vira `PAID` e o saldo entra uma única vez.
3. Reenviar o mesmo webhook → nada muda (idempotência).
4. Enviar um webhook sem assinatura → **401**.
5. `GET /wallet/integrity` → `ok: true`.

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
