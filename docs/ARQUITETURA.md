# Clube VKUDAKA — Arquitetura de Solução

## 1. Visão geral

Três aplicações, um único backend e um único banco de dados relacional.

```
                     ┌───────────────────────────┐
   App Mobile        │  React Native (Expo)      │  iOS + Android
   (assinantes)      │  mobile/                  │
                     └────────────┬──────────────┘
                                  │ REST/JSON + JWT
                     ┌────────────▼──────────────┐        ┌──────────────────┐
   Painel CRM        │  API Node.js + TypeScript │◄──────►│  PostgreSQL 15   │
   (administração)   │  Express + Prisma         │        │  (Prisma schema) │
                     │  backend/                 │        └──────────────────┘
                     └────────────▲──────────────┘
                                  │ REST/JSON + JWT (role ADMIN/STAFF)
                     ┌────────────┴──────────────┐
                     │  React + Vite + TS        │
                     │  crm-web/                 │
                     └───────────────────────────┘

  Integrações externas (adapters em backend/src/integrations):
  • Gateway de pagamento (Pix / cartão) — conta recebedora única (Valéria)
  • In-App Purchase (Apple StoreKit / Google Play Billing) — assinatura na publicação
  • Correios (PAC/Sedex) — cálculo de frete por CEP
  • Emissor de etiqueta / declaração de conteúdo
  • Expo Push / FCM / APNs — push notifications
  • S3-compatible storage — fotos de perfil, produtos, posts
```

### Por que esta stack

| Decisão | Motivo |
|---|---|
| React Native (Expo prebuild) | Um código para App Store e Play Store; `expo-notifications`, `expo-camera` e `react-native-qrcode-svg` cobrem push, leitura e geração de ingresso sem módulo nativo próprio. |
| Node.js + TypeScript | Mesma linguagem do mobile e do CRM; contratos de API tipados compartilhados (`backend/src/modules/*/schema.ts` com Zod). |
| PostgreSQL | Dados financeiros exigem transações ACID: a compra debita carteira, gera crédito de mensalidade e cria pagamento **na mesma transação**. |
| Prisma | Migrations versionadas, tipos gerados, `$transaction` com isolamento serializável para o checkout. |
| Valores em centavos (`Int`) | Nunca usar float para dinheiro. Todo campo monetário termina em `Cents`. |

## 2. Camadas do backend

```
src/
├── config/env.ts            validação de variáveis de ambiente (Zod) — falha rápido no boot
├── lib/                     prisma client, erros HTTP, helpers de resposta, money, jwt
├── middleware/              auth, requireRole, requireActiveSubscriber, validate, errorHandler
├── domain/                  REGRAS DE NEGÓCIO PURAS (sem I/O, testáveis isoladamente)
│   ├── pricing/             motor de precificação, abatimento e desconto  ← núcleo do projeto
│   ├── wallet/              regras de saldo e movimentação
│   ├── credits/            crédito de mensalidade (sem teto, sem expiração)
│   └── tickets/             geração/validação de código de ingresso
├── modules/<recurso>/       router + controller + service (I/O, orquestra o domain)
└── integrations/<parceiro>/ adapters com interface própria (troca de fornecedor sem tocar no domínio)
```

Regra de ouro: **nada em `domain/` importa Prisma, Express ou SDK externo.** O motor de preço recebe números e devolve números — por isso ele é coberto por testes unitários (`domain/pricing/pricing.test.ts`) e é a única fonte de verdade de cálculo, consumida igualmente pelo app (preview no botão "Comprar") e pelo checkout.

## 3. Fluxo crítico: checkout

```
App: POST /orders/quote  ──► pricing.quote()  ──► devolve total, abatimento gerado, saldo aplicado
     (sem efeito colateral; alimenta o botão "Comprar" em tempo real)

App: POST /orders        ──► prisma.$transaction([
                              1. revalida estoque e preços no banco
                              2. pricing.quote() de novo  (nunca confiar no cliente)
                              3. cria Order + OrderItems
                              4. debita Wallet + WalletTransaction (se usou saldo)
                              5. cria SubscriptionCredit (se elegível ao abatimento)
                              6. cria Payment PENDING no gateway (diferença a pagar)
                             ])
Gateway: POST /webhooks/payments ──► confirma Payment ──► Order PAID
                                 ──► dispara push "compra efetuada"
                                 ──► emite declaração de conteúdo + etiqueta
```

O quote é recalculado no servidor no momento do commit: preço, percentual do plano e saldo vêm sempre do banco, nunca do payload.

## 4. Controle de acesso

| Papel | Onde | Pode |
|---|---|---|
| `MEMBER` sem assinatura ativa | app | ver Clube, comprar **apenas ingresso avulso**; loja bloqueada com redirecionamento para o site externo |
| `MEMBER` com assinatura ativa | app | tudo do app: loja, aluguel, carteira, RSVP gratuito, comunidade |
| `STAFF` | CRM | catálogo, eventos, pedidos, push |
| `ADMIN` | CRM | tudo + planos, descontos, financeiro, usuários |
| `GATE` | CRM (portaria) | apenas lista de presença e validação de ingresso |

Middleware `requireActiveSubscriber` protege toda rota de compra/aluguel. O app trata o HTTP 402 `SUBSCRIPTION_REQUIRED` abrindo a tela de redirecionamento para o site.

## 5. Ambientes

`.env.example` na raiz de cada app. A conta bancária recebedora dos gateways é **configuração de ambiente de produção** (`PAYMENT_RECIPIENT_*`), nunca hardcoded — ver `docs/OPERACAO.md`.

## 6. Roadmap de entrega

| Fase | Entrega |
|---|---|
| 1 | Banco + auth + cadastro + planos/assinatura + carteira |
| 2 | Catálogo, checkout, motor de abatimento, frete Correios |
| 3 | Eventos, ingressos, lista de presença em PDF |
| 4 | Comunidade, push notifications, modelos |
| 5 | Dashboard/relatórios CRM, declaração de conteúdo |
| 6 | Troca do gateway web por IAP nativo, submissão às lojas |
