# Regras de Negócio — implementação normativa

Este documento é a especificação que o código em `backend/src/domain/` implementa.
Toda alteração aqui exige alteração em `pricing.test.ts`.

---

## RN-01 — Exclusividade do app

O app é do clube. Quem não tem assinatura **ativa**:

* não vê preço de compra nem de aluguel com ação de compra;
* recebe `402 SUBSCRIPTION_REQUIRED` em qualquer rota de pedido de peça;
* é levado ao site externo (`EXTERNAL_STORE_URL`) para assinar/comprar;
* **exceção única:** pode comprar ingresso avulso de evento (bloco isolado, RN-07).

Implementação: `middleware/requireActiveSubscriber.ts`.

---

## Atualização de 2026-11-11 — créditos VKUDAKA e desconto fidelidade

Decisão da direção (via Rafael), que **substitui** partes da RN-02 e da RN-05 abaixo:

* **100% da mensalidade vira crédito VKUDAKA.** Ao registrar o pagamento da assinatura no CRM
  (`POST /admin/users/:id/subscription`), o valor pago (preço do contrato × meses, ou o valor
  informado; 0 = cortesia) entra na carteira como `WalletTransaction` do tipo `SUBSCRIPTION`.
* **Desconto fidelidade na hora da compra.** O percentual do plano (10% Essência, 15% Premium)
  passa a ser `IMMEDIATE_DISCOUNT` (padrão do banco e dos planos). Nesse modo, **usar créditos
  da carteira não cancela o desconto**: o desconto sai primeiro e a carteira cobre o restante.
  O modo `CREDIT_NEXT_INVOICE` continua no código, com a regra antiga (bloqueia ao usar saldo).
* **Peça em promoção** (valor promocional de venda, com início/fim opcionais) **não recebe** o
  desconto fidelidade: o item entra no motor com `noRebate` e fica fora da base. Pedido só com
  peças em promoção registra o motivo `PROMO_ITEMS`.
* Planos têm preço "de" (`compareAtPriceCents`), selo de preço (`promoLabel`) e selo de
  destaque (`highlightLabel`); cada benefício pode virar linha da tabela comparativa do app
  (`compareLabel`/`compareValue`).

---

## RN-02 — Abatimento (regra estrita)

> O desconto (ex.: 10% Signature, 5% Essence) recai sobre a compra e **gera crédito para a
> próxima mensalidade**, sem teto e sem expirar no trimestre. O abatimento percentual na peça
> **não é acumulativo** e **só é ativado quando o usuário não utiliza créditos da carteira**.

Esclarecimento da direção (14/09/2026), transcrito: *"Não é acumulativo — é apenas x% da
peça do Look, somente quando não utilizar créditos."* O protótipo antigo dizia "abatimento
acumulativo"; a frase está na lista de escopo removido (RN-11) e o build falha se voltar.

Tradução em código (`domain/pricing/pricing.ts`):

| Cláusula | Implementação |
|---|---|
| percentual vem do plano | `plan.rebatePercent`, editável no CRM por nível de assinante |
| recai sobre a compra | base = subtotal de itens **líquido de cupom**, sem frete |
| gera crédito da próxima mensalidade | cria `SubscriptionCredit` (ledger próprio), **não** desconta do total do pedido |
| sem teto | nenhum `cap` é aplicado — `SubscriptionCredit.maxCents = null` |
| sem expirar no trimestre | `SubscriptionCredit.expiresAt = null` sempre |
| não é acumulativo | um único percentual por pedido; não soma com cupom percentual (`allowRebateWithPercentCoupon = false`) |
| só quando não usa carteira | `walletAppliedCents > 0` ⇒ `rebateEligible = false`, motivo `WALLET_USED` |

Consequência de negócio: o assinante escolhe entre **usar saldo agora** ou **gerar crédito de
mensalidade**. O app mostra os dois cenários no botão "Comprar" (`POST /orders/quote`), para
que a escolha seja consciente.

### Modo de aplicação (parametrizável no CRM)

`Plan.rebateMode`:

* `CREDIT_NEXT_INVOICE` (**padrão, é a regra escrita acima**) — vira crédito da mensalidade seguinte;
* `IMMEDIATE_DISCOUNT` — desconta no ato da compra.

O modo existe porque o requisito 3.2 pede que "o botão comprar calcule o abatimento
dinamicamente vindo do CRM"; o padrão de produção é `CREDIT_NEXT_INVOICE`, coerente com a RN-02.
Trocar o modo é decisão da diretoria no CRM, não do desenvolvedor.

---

## RN-03 — Ordem de cálculo do pedido

```
1  subtotalCents          = Σ (preço unitário × quantidade)          [preços do banco]
2  couponDiscountCents    = cupom PERCENT | FIXED sobre (1)
3  netItemsCents          = (1) - (2)
4  shippingCents          = cotação Correios, 0 se regra/cupom de frete grátis
5  totalBeforeRebate      = (3) + (4)
6  walletAppliedCents     = min(pedido do usuário, saldo, (5))
7  rebateEligible         = (6) == 0  ∧  rebatePercent > 0  ∧  (3) > 0
                            ∧  ¬(cupom percentual aplicado)
8  rebateBaseCents        = (3)                                       [nunca inclui frete]
9  se elegível e modo CREDIT_NEXT_INVOICE:
       rebateCreditCents  = round((8) × percentual)                   → SubscriptionCredit
       totalCents         = (5)
   se elegível e modo IMMEDIATE_DISCOUNT:
       immediateDiscount  = round((8) × percentual)
       totalCents         = (5) - immediateDiscount
   senão:
       totalCents         = (5)
10 gatewayAmountCents     = totalCents - walletAppliedCents           [Pix/cartão]
```

Arredondamento: `Math.round` em centavos, uma única vez por linha de cálculo.

---

## RN-04 — Carteira digital

* Saldo é derivado do ledger `WalletTransaction`; `Wallet.balanceCents` é cache conferido por
  `walletService.assertIntegrity()`.
* Recarga: `TOPUP` (Pix/cartão) — só credita após webhook `PAID`.
* Compra: `PURCHASE` (débito) na mesma transação do pedido.
* "Inteirar o valor": saldo parcial + diferença no gateway é o caminho normal (linha 6 e 10 da RN-03).
* Saldo **nunca fica negativo**: violação lança `WalletInsufficientFunds`.
* Toda movimentação dispara push (RN-09).

---

## RN-05 — Crédito de mensalidade

* Ledger separado da carteira. Crédito de mensalidade **não vira saldo de compra**.
* Consumido automaticamente na geração da próxima `SubscriptionInvoice`, do mais antigo para o
  mais novo, até zerar a fatura; sobra permanece `AVAILABLE` para a fatura seguinte.
* Sem teto e sem expiração (`expiresAt = null`).

---

## RN-06 — Planos e níveis

* Planos cadastráveis no CRM: nome, `priceCents`, `interval` (MENSAL/TRIMESTRAL/ANUAL),
  `rebatePercent`, `rebateMode`, benefícios (lista livre), ordem de exibição.
* O app **nunca** tem percentual hardcoded: lê de `GET /me/benefits`.

---

## RN-07 — Eventos

* Assinante ativo: entrada gratuita, confirma presença (`EventRsvp`) → ingresso `SUBSCRIBER_RSVP`.
* Não assinante: bloco isolado, compra `EventTicketType` → ingresso `PAID_TICKET`.
* Ingresso = QR Code assinado (HMAC) + código alfanumérico de 10 dígitos legível.
* Validação na portaria é idempotente: 1ª leitura `VALID→USED`; leituras seguintes retornam
  `ALREADY_USED` com data/hora do primeiro uso.
* Lista de presença em PDF = RSVPs confirmados + compradores avulsos, ordenada por nome.

---

## RN-08 — Frete

* Cotação Correios PAC/Sedex por CEP no fechamento.
* Regras cadastráveis: frete grátis por peça (`freeShippingProductIds`), por quantidade mínima
  (`minItems`) ou por valor mínimo (`minSubtotalCents`); cupons de desconto de frete.
* Declaração de conteúdo emitida automaticamente após `Order.PAID` via adapter de etiqueta.

---

## RN-09 — Push notifications

Gatilhos automáticos: produto novo publicado, evento novo publicado, recarga de carteira
confirmada, saldo zerado após compra, compra efetuada, renovação de assinatura.
Disparo manual segmentado por plano/status no CRM.

---

## RN-10 — Roteamento financeiro

Todos os recebimentos (gateway web e, na publicação, IAP) são roteados para a conta bancária
titular definida em `PAYMENT_RECIPIENT_*` (variáveis de ambiente de produção). Nenhum dado
bancário é versionado no repositório.

---

## RN-11 — Limpeza de escopo (proibições de copy)

Os textos e serviços do legado listados em `scripts/check-legacy-copy.mjs` **não podem existir**
em `mobile/`, `crm-web/`, `backend/` ou `docs/`. O guard roda em `npm test` e no CI.

Alteração de 14/09/2026: o benefício "look do trimestre" **saiu** desta lista — a direção o
trouxe de volta com regras próprias (RN-12). O nome antigo do menu de aluguel continua proibido:
o menu chama-se "Escolha seu Look".

## RN-12 — Peça do trimestre (aluguel sem custo)

Definido pela Valéria em 14/09/2026:

> 4 looks por ano, 1 por trimestre. Aluguel tem que pagar o frete. Caso queira alugar mais,
> terá o valor disponível para aluguel. Somente assinantes têm acesso a aluguel. O catálogo de
> aluguel é separado, não pode misturar.

| Cláusula | Implementação |
|---|---|
| 1 por trimestre, 4 por ano | trimestre do calendário (`domain/rental/quarterly.ts`); o pedido grava `quarterlyRentalPeriod` ("2026-Q3") |
| sem custo de locação | a primeira unidade de aluguel do pedido sai a R$ 0; o valor evitado fica em `quarterlyRentalSavedCents` |
| frete pago pela cliente | aluguel nunca tem frete grátis por peça; pedido só de aluguel ignora as regras de frete grátis |
| alugar mais paga o normal | segunda unidade / segundo pedido no trimestre vêm no preço da peça |
| só assinantes | `/catalog/rental` e a aplicação do direito exigem assinatura ativa |
| catálogo separado | `/catalog/rental` só lista peças RENTAL ou BOTH; a seção do app é própria |
| pedido cancelado devolve o direito | a conferência ignora `CANCELED`/`REFUNDED` |
| não acumula | **suposição nossa** — trimestre sem uso não gera direito extra; a direção não se pronunciou |

Race condition: dois pedidos abertos no mesmo instante são serializados pela transação
`Serializable` do checkout — o segundo enxerga o primeiro e cobra o valor normal.
