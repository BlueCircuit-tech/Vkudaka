# Clube de Assinaturas VKUDAKA

Plataforma do clube de assinaturas da VKUDAKA: **app mobile** para as assinantes (iOS e Android),
**painel CRM web** para a administração e uma **API única** com PostgreSQL.

```
clube-vkudaka/
├── backend/     API Node.js + TypeScript + Express + Prisma  (regras de negócio)
├── mobile/      App React Native (Expo) — App Store e Play Store
├── crm-web/     Painel administrativo React + Vite
├── docs/        Arquitetura, regras de negócio e integrações
├── scripts/     Guard de limpeza de escopo
└── legacy/      Protótipo v1 (index.html), mantido só como referência visual
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Stack, camadas, fluxo de checkout, controle de acesso |
| [docs/REGRAS-DE-NEGOCIO.md](docs/REGRAS-DE-NEGOCIO.md) | RN-01 a RN-11 — especificação normativa que o código implementa |
| [docs/INTEGRACOES.md](docs/INTEGRACOES.md) | Gateway, Correios, etiquetas, push, lojas de aplicativo |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Ambientes, conta recebedora, deploy e rotinas |
| [docs/IDENTIDADE-VISUAL.md](docs/IDENTIDADE-VISUAL.md) | Paleta, tipografia e uso do logotipo oficial |

## Como rodar

Pré-requisitos: Node 20+, PostgreSQL 15+ (ou Docker).

```bash
docker compose up -d          # sobe o PostgreSQL local (porta 5435 no host)
```

```bash
npm install
```

```bash
cp backend/.env.example backend/.env
```

```bash
npm run db:migrate && npm run db:seed
```

```bash
npm run dev:api               # API em http://localhost:3333
```

```bash
npm run dev:crm               # CRM em http://localhost:5173
```

```bash
npm run dev:app               # Expo — abre no Expo Go ou em emulador
```

Credenciais criadas pelo seed:

| Acesso | Login | Senha |
|---|---|---|
| Administração (CRM) | `admin@vkudaka.local` | `vkudaka123` |
| Portaria (validação de ingresso) | `portaria@vkudaka.local` | `vkudaka123` |
| Assinante Signature (app) | `assinante@vkudaka.local` | `vkudaka123` |

## Verificações

```bash
npm test
```

Roda o guard de escopo (RN-11) e a suíte do backend — 36 testes, com o motor de
abatimento (RN-02/RN-03) coberto caso a caso.

```bash
npm run typecheck -w mobile && npm run typecheck -w crm-web
```

## Identidade visual

A interface segue o manual da marca: fundo marfim, preto como tinta, **ouro
`#C7A165`** e **nude `#D8C8B8`** como as duas cores oficiais, tipografia
**Carla** nos títulos e **Noto Sans Condensed** no texto. Os logotipos são os
arquivos oficiais, sem recriação. Detalhes e a regra de contraste do ouro estão
em [docs/IDENTIDADE-VISUAL.md](docs/IDENTIDADE-VISUAL.md).

## O coração do sistema

Toda a matemática do clube vive em um único arquivo puro e testado:
[`backend/src/domain/pricing/pricing.ts`](backend/src/domain/pricing/pricing.ts).

Ele é consumido igualmente pelo preview do botão "Comprar" no app, pelo checkout
e pelo simulador do CRM — o valor exibido e o valor cobrado saem da mesma função.
As três cláusulas mais delicadas da regra de abatimento estão lá, explícitas:

* o percentual vira **crédito da próxima mensalidade**, não desconto na compra;
* o crédito **não tem teto e não expira**;
* o abatimento **não é acumulativo** e **não é concedido quando o assinante usa
  saldo da carteira** no pedido.

## Escopo removido do legado

Os textos e serviços descontinuados listados no briefing não existem nesta versão.
`scripts/check-legacy-copy.mjs` falha o build se algum deles reaparecer em
`backend/`, `mobile/`, `crm-web/` ou `docs/` — o protótipo em `legacy/` é ignorado
de propósito.
# Vkudaka
