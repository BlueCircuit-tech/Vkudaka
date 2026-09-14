# Identidade visual — como o código aplica a marca

Fonte: manual de identidade VKUDAKA (Prado Design) e pacote de logotipos oficiais.
Este documento existe para que ninguém precise "achar" uma cor ou uma fonte.

---

## 1. Cores

O manual define **duas** cores de marca. Todo o resto é neutro derivado delas.

| Papel | Hex | Onde entra |
|---|---|---|
| **Ouro** (oficial) | `#C7A165` | preenchimento de botão primário, bordas de destaque, aba ativa, marca |
| **Nude** (oficial) | `#D8C8B8` | fundo de telas de entrada (login, formulário público), superfícies quentes |
| Ouro escurecido | `#8C6A2F` | **único ouro permitido como texto** sobre fundo claro |
| Marfim | `#FAF7F3` | fundo de todas as telas |
| Branco | `#FFFFFF` | cartões |
| Areia | `#F3EDE6` | blocos secundários, campos |
| Contorno | `#E6DCD1` | linhas e bordas |
| Tinta | `#141210` | texto principal (o preto da marca) |
| Texto secundário | `#7A7168` | apoio |

### A regra de contraste que não pode ser quebrada

`#C7A165` sobre fundo claro tem contraste ~2:1 — **reprova** em acessibilidade.
Por isso:

* ouro é **preenchimento**, nunca texto sobre claro;
* texto que precisa ser dourado usa `#8C6A2F` (~4.6:1, aprovado em AA);
* texto **sobre** preenchimento dourado é a tinta `#141210` (~7:1).

No código: `colors.gold` para fundo, `colors.goldDeep` para texto.

---

## 2. Tipografia

| Fonte | Uso | Arquivo |
|---|---|---|
| **Carla** | títulos, valores em destaque, números do dashboard | `CarlaSans-SemiBold.otf` |
| **Noto Sans Condensed** | texto corrido, formulários, tabelas, botões | `NotoSans-CondensedSemiBold.ttf` |
| Noto Sans Condensed Italic | citações e apoios | `NotoSans-CondensedMediumItalic.ttf` |

* **Mobile:** carregadas em `App.tsx` com `expo-font`. A tela só monta depois que
  as fontes estão prontas — sem isso a interface abriria com a fonte do sistema
  e "pularia" para a correta.
* **CRM:** `@font-face` em `crm-web/src/styles.css`, arquivos em `public/fonts/`.

Os nomes das famílias vivem em `mobile/src/theme/theme.ts → fonts` e nas
variáveis do CSS. Nenhuma tela declara `fontFamily` literal.

### ⚠ Carla só em CAIXA ALTA

Carla é uma fonte de titulação em caixa alta: as minúsculas são desenhadas como
capitais **e as minúsculas acentuadas apontam para a letra-base sem acento**.
Conferido no arquivo (`cmap` + contornos):

| Escrito | Glifo usado | Resultado |
|---|---|---|
| `ç` | `c` | perde a cedilha |
| `ã` | `a` | perde o til |
| `ó` | `o` | perde o acento |
| `Ç` | `Ccedilla` | correto |
| `Ã` | `Atilde` | correto |
| `Ó` | `Oacute` | correto |

Ou seja: "Coleção" em Carla minúscula sai **COLECAO**. Regra do sistema:

* **Carla** apenas em `text-transform: uppercase` (títulos de página, rótulos) e
  em **números** (valores monetários) — casos em que o problema não existe;
* **Noto Sans** em todo texto acentuado de caixa mista: subtítulos, tabelas,
  formulários, corpo.

Isso está codificado em `crm-web/src/styles.css` (`h1` em Carla maiúscula, `h2`/`h3`
em Noto Sans) e em `mobile/src/theme/theme.ts` (`typography.display` com
`textTransform: 'uppercase'`, `typography.title` em Noto Sans).

---

## 3. Fotografia

As imagens vêm do **próprio manual da marca** (extraídas do PDF da Prado Design),
não de banco de imagens:

| Arquivo | Imagem | Onde |
|---|---|---|
| `crm-web/public/login-art.jpg` | etiqueta VKUDAKA sobre a malha nude ("Sua Essência, Nossa Inspiração") | login |
| `crm-web/public/apply-art.jpg` | campanha: terno creme sobre fundo camel | confirmação do cadastro de modelos |

A arte ocupa meia tela com um véu quente por cima (`linear-gradient` sobre o
preto da marca) que garante o contraste da legenda sobre qualquer foto.

Duas regras ao trocar a arte:

1. **Enquadramento** — ajuste `background-position` em `.auth-art` (hoje `50% 45%`,
   centrado na tipografia da etiqueta). Foto com rosto pede algo em torno de `50% 18%`.
2. **Não repita o que a foto já diz.** A etiqueta já traz a frase da marca, então a
   legenda do login é só o rótulo dourado. Se a nova arte não tiver texto, volte a
   usar o `<blockquote>` — que é renderizado em caixa alta, pela regra da Carla.

## 4. Logotipo

Arquivos oficiais, com transparência, em `mobile/assets/` e `crm-web/public/`:

| Arquivo | Quando usar |
|---|---|
| `logo-preto.png` | padrão — sobre marfim, branco ou nude |
| `logo-dourado.png` | peças de destaque e material impresso |
| `logo-branco.png` | sobre foto escura ou fundo preto |
| `logo-bege.png` | marca d'água sobre foto |

No mobile, use sempre `brand.logo` (theme.ts) — nunca um `require` solto, para
que a troca do arquivo aconteça em um lugar só.

Ícone do app, splash e favicon são **gerados** a partir do logotipo preto sobre
o marfim `#FAF7F3`. Se a marca mudar, regere-os em vez de editar à mão.

---

## 5. Decisão de fundo claro

O protótipo v1 era escuro (preto e ouro). O manual da marca é o oposto:
fundo claro, muito respiro, preto como tinta e ouro reservado ao privilégio —
o conceito escrito é *"menos é mais"*. A v2 segue o manual.

O ouro não sumiu: ele ficou **raro**, que é o que o torna nobre. Aparece no
filete da marca, no rótulo em versalete, na aba ativa, na tag de plano e no
cartão de destaque do dashboard. A ação principal usa o **preto da marca** —
mais editorial, e resolve o contraste de vez; o ouro fica disponível como
variante (`button.gold`) para quando o destaque precisa ser da marca.

---

## 6. Material da marca não convertido

`BACKDROP_VKUDAKA_CURVAS.cdr` é arquivo CorelDRAW e não foi convertido — se a
arte de fundo do ingresso sair dele, exporte em PNG/SVG e cadastre por evento em
`Event.ticketArtUrl` no CRM. O sistema já lê esse campo.
