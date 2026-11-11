/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  IDENTIDADE VISUAL VKUDAKA                                             ║
 * ║  Fonte: manual da marca (Prado Design) — "moda com essência"           ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Duas cores oficiais, extraídas da COLOR PALETTE do manual:
 *   • Ouro  #C7A165
 *   • Nude  #D8C8B8
 *
 * Preto e marfim são os neutros da marca. O conceito é claro e minimalista
 * ("menos é mais"), por isso a interface é de fundo claro — o oposto do
 * protótipo v1. O ouro é reservado a marca, privilégio e ação principal;
 * nunca é usado como texto corrido sobre claro (não passa em contraste).
 */

export const colors = {
  /** Marfim quente — fundo de todas as telas. */
  background: '#FAF7F3',
  /** Cartões e blocos. */
  surface: '#FFFFFF',
  /** Blocos secundários, campos de formulário. */
  surfaceAlt: '#F3EDE6',
  /** Linha e contorno — nude rebaixado. */
  border: '#E6DCD1',

  /** Ouro oficial da marca. Preenchimento e acento. */
  gold: '#C7A165',
  /** Ouro escurecido — o único tom de ouro legível como TEXTO sobre claro. */
  goldDeep: '#8C6A2F',
  /** Nude oficial da marca. */
  nude: '#D8C8B8',

  /** Preto da marca — texto principal. */
  ink: '#141210',
  /** Texto secundário. */
  muted: '#7A7168',
  /** Texto terciário, placeholders. */
  mutedSoft: '#A79C91',

  /**
   * Acentos da tela de planos (briefing de 2026-11-11): azul-marinho para o
   * plano em destaque, marrom para o slogan, creme para os cards claros.
   */
  navy: '#1B2A4A',
  brown: '#5C3A2E',
  cream: '#F5F1E8',

  danger: '#9E3B32',
  success: '#5B7A52',

  /** Sobreposição usada quando há foto atrás do conteúdo (ingresso). */
  overlay: 'rgba(250,247,243,0.86)',
} as const;

export const spacing = (multiplier: number): number => multiplier * 8;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

/**
 * Tipografia oficial:
 *   • Carla    — títulos e números de destaque (a fonte do logotipo)
 *   • Noto Sans Condensed — texto corrido e interface
 *
 * ATENÇÃO: Carla é uma fonte de CAIXA ALTA e suas minúsculas acentuadas apontam
 * para a letra-base sem acento (ç→c, ã→a, ó→o). "Coleção" em Carla minúscula
 * sairia "COLECAO". Por isso Carla é usada SEMPRE em caixa alta — onde os
 * acentos existem (Ç, Ã, Ó) — ou em números. Texto acentuado em caixa mista
 * usa Noto Sans.
 *
 * Os nomes abaixo são as chaves registradas em `useFonts` (App.tsx).
 */
export const fonts = {
  display: 'Carla',
  body: 'NotoSans',
  bodyItalic: 'NotoSansItalic',
} as const;

export const typography = {
  /** Masthead editorial: Carla em caixa alta, com respiro entre as letras. */
  display: {
    fontFamily: fonts.display,
    fontSize: 25,
    letterSpacing: 2.2,
    textTransform: 'uppercase' as const,
    color: colors.ink,
  },
  /** Títulos de bloco em caixa mista — Noto Sans preserva a acentuação. */
  title: { fontFamily: fonts.body, fontSize: 18, color: colors.ink },
  /** Valores monetários: Carla nos números, sem risco de acento. */
  amount: { fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted },
  /** Micro-rótulo em caixa alta — assinatura tipográfica da marca. */
  label: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    letterSpacing: 2.2,
    textTransform: 'uppercase' as const,
    color: colors.goldDeep,
  },
} as const;

/** Assets da marca. Use sempre estes arquivos — nada de recriar o logotipo. */
export const brand = {
  logo: require('../../assets/logo-preto.png'),
  logoGold: require('../../assets/logo-dourado.png'),
  logoLight: require('../../assets/logo-branco.png'),
  tagline: 'MODA COM ESSÊNCIA',
} as const;

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
