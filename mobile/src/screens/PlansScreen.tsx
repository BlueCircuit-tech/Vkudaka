import React, { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { api } from '../api/client';
import { colors, fonts, formatBRL, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Label, Loading, Screen } from '../components/ui';

/**
 * Planos e benefícios.
 *
 * Modelo do clube (2026-11-11): 100% da mensalidade vira crédito VKUDAKA na
 * carteira; os créditos acumulam e pagam peças da marca. O desconto fidelidade
 * do plano vale na hora da compra.
 *
 * Tudo o que aparece aqui — preço, preço "de", selos, benefícios e a tabela
 * comparativa — vem do CRM (GET /plans). Nada de valor fixo no app.
 *
 * Pagamento (2026-11-12): com o Mercado Pago configurado no CRM
 * (`checkoutEnabled`), cada plano tem o próprio botão e o pagamento é feito
 * num link do Mercado Pago (Pix ou cartão) — pagou, virou assinante e o valor
 * entra como crédito na carteira. Sem o gateway configurado, volta o botão
 * antigo "Assinar no site VKUDAKA".
 *
 * Atenção App Store (diretriz 3.1.1): a decisão de usar o Mercado Pago também
 * no iPhone foi do Rafael em 2026-11-12, ciente do risco de recusa na revisão.
 */

interface PublicPlan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  promoLabel: string | null;
  highlightLabel: string | null;
  interval: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
  rebatePercent: number;
  benefits: Array<{ id: string; title: string; description: string | null }>;
}

interface PlansResponse {
  plans: PublicPlan[];
  comparison: Array<{ label: string; values: string[] }>;
  storeUrl: string;
  checkoutEnabled?: boolean;
}

interface MyPlan {
  hasPlan: boolean;
  planId?: string;
  planName?: string;
  rebatePercent: number;
  renewsAt?: string | null;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  walletBalanceCents: number;
  upgrade?: PublicPlan | null;
  storeUrl: string;
}

const INTERVAL_SUFFIX: Record<PublicPlan['interval'], string> = {
  MONTHLY: '/mês',
  QUARTERLY: '/trimestre',
  SEMIANNUAL: '/semestre',
  ANNUAL: '/ano',
};

const STEPS = [
  { title: 'Escolha seu plano', text: 'Essência ou Premium — o que combina com você.' },
  { title: 'Assinatura gera créditos', text: '100% do valor pago vira crédito VKUDAKA.' },
  { title: 'Acumule e planeje', text: 'Os créditos se somam mês a mês na sua carteira.' },
  { title: 'Use em peças VKUDAKA', text: 'Escolha suas peças e pague com os créditos.' },
];

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

/** Conteúdo da tela — também usado como porta de quem ainda não assina. */
export function PlansView({ notice }: { notice?: React.ReactNode }) {
  const [catalog, setCatalog] = useState<PlansResponse | null>(null);
  const [me, setMe] = useState<MyPlan | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useFocusEffect(
    useCallback(() => {
      void api.get<PlansResponse>('/plans').then(setCatalog);
      void api
        .get<MyPlan>('/plans/me')
        .then(setMe)
        .catch(() => setMe(null));
    }, []),
  );

  if (!catalog) return <Loading />;

  const storeUrl = me?.storeUrl ?? catalog.storeUrl;
  const openStore = () => void Linking.openURL(storeUrl);
  const isSubscriber = Boolean(me?.hasPlan);
  const checkoutEnabled = Boolean(catalog.checkoutEnabled);

  /** Gera o link do Mercado Pago e leva para a tela que espera a confirmação. */
  const pay = async (plan: PublicPlan) => {
    if (!checkoutEnabled) return openStore();
    setPaying(plan.id);
    try {
      const checkout = await api.post<{ id: string; url: string; planName: string }>(
        '/plans/checkout',
        { planId: plan.id },
      );
      navigation.navigate('PlanCheckout', {
        checkoutId: checkout.id,
        url: checkout.url,
        planName: checkout.planName,
      });
    } catch (error) {
      Alert.alert('Não foi possível abrir o pagamento', (error as Error).message);
    } finally {
      setPaying(null);
    }
  };

  /** Botão de cada card: assinar, renovar o plano atual ou fazer upgrade. */
  const actionFor = (plan: PublicPlan) => {
    if (!checkoutEnabled) return undefined;
    if (!isSubscriber) return { title: `Assinar Plano ${plan.name}`, primary: true };
    if (me?.planId === plan.id) return { title: 'Renovar mais um período', primary: false };
    if (plan.priceCents > (catalog.plans.find((p) => p.id === me?.planId)?.priceCents ?? 0)) {
      return { title: `Fazer upgrade para ${plan.name}`, primary: true };
    }
    return undefined;
  };

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Cabeçalho com o saldo de créditos */}
        <View style={styles.topBar}>
          <Label>Planos e benefícios</Label>
          {me ? (
            <View style={styles.creditPill}>
              <Text style={styles.creditPillText}>Créditos {formatBRL(me.walletBalanceCents)}</Text>
            </View>
          ) : null}
        </View>

        {notice}

        {/* Modelo do clube */}
        <View style={styles.hero}>
          <Text style={typography.display}>Clube VKUDAKA</Text>
          <Text style={styles.slogan}>Planeje. Acumule. Escolha.</Text>
          <Body>
            Uma assinatura mensal em que 100% do valor pago vira créditos VKUDAKA. Os créditos
            acumulam e você usa para comprar peças da marca.
          </Body>
        </View>

        <View style={styles.steps}>
          {STEPS.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Caption>{step.text}</Caption>
              </View>
            </View>
          ))}
        </View>

        {/* Plano atual de quem já assina */}
        {isSubscriber && me ? (
          <View style={styles.current}>
            <Label>Seu plano</Label>
            <Text style={styles.currentName}>{me.planName}</Text>
            <Caption>
              {me.renewsAt
                ? `Renova em ${formatDate(me.renewsAt)}`
                : me.currentPeriodEnd
                  ? `Válido até ${formatDate(me.currentPeriodEnd)}`
                  : ''}
              {me.rebatePercent > 0 ? ` · ${me.rebatePercent}% de desconto fidelidade` : ''}
            </Caption>
          </View>
        ) : null}

        {/* Cards dos planos */}
        {catalog.plans.map((plan) => {
          const action = actionFor(plan);
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={me?.planId === plan.id}
              action={
                action
                  ? {
                      ...action,
                      loading: paying === plan.id,
                      disabled: paying !== null,
                      onPress: () => void pay(plan),
                    }
                  : undefined
              }
            />
          );
        })}

        {/* Tabela comparativa colapsável */}
        {catalog.comparison.length > 0 ? (
          <View style={styles.compare}>
            <Pressable
              onPress={() => setCompareOpen((open) => !open)}
              style={({ pressed }) => [styles.compareHeader, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityState={{ expanded: compareOpen }}
            >
              <Text style={styles.compareTitle}>Qual experiência combina com você?</Text>
              <Text style={styles.compareToggle}>{compareOpen ? '−' : '+'}</Text>
            </Pressable>

            {compareOpen ? (
              <View>
                <View style={[styles.compareRow, styles.compareHead]}>
                  <Text style={[styles.compareLabel, styles.compareHeadText]}>Benefício</Text>
                  {catalog.plans.map((plan) => (
                    <Text key={plan.id} style={[styles.compareValue, styles.compareHeadText]}>
                      {plan.name}
                    </Text>
                  ))}
                </View>
                {catalog.comparison.map((row) => (
                  <View key={row.label} style={styles.compareRow}>
                    <Text style={styles.compareLabel}>{row.label}</Text>
                    {row.values.map((value, index) => (
                      <Text
                        key={catalog.plans[index]?.id ?? index}
                        style={[styles.compareValue, value === '—' && { color: colors.mutedSoft }]}
                      >
                        {value}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* CTA fixo no rodapé */}
      <View style={styles.footer}>
        {!isSubscriber && checkoutEnabled ? (
          <Caption>
            Escolha seu plano acima e pague com Pix ou cartão pelo Mercado Pago. 100% do valor
            vira crédito na sua carteira.
          </Caption>
        ) : !isSubscriber ? (
          <Button title="Assinar no site VKUDAKA" onPress={openStore} />
        ) : me?.upgrade ? (
          <>
            <Caption>
              Upgrade para {me.upgrade.name}: {formatBRL(me.upgrade.priceCents)}
              {INTERVAL_SUFFIX[me.upgrade.interval]}
              {me.upgrade.rebatePercent > 0
                ? ` · ${me.upgrade.rebatePercent}% de desconto fidelidade`
                : ''}
            </Caption>
            <Button
              title={`Fazer upgrade para ${me.upgrade.name}`}
              loading={paying === me.upgrade.id}
              disabled={paying !== null}
              onPress={() => (me.upgrade ? void pay(me.upgrade) : undefined)}
            />
          </>
        ) : (
          <Caption>Você está no plano mais completo do clube.</Caption>
        )}
      </View>
    </Screen>
  );
}

interface CardAction {
  title: string;
  primary: boolean;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}

function PlanCard({
  plan,
  isCurrent,
  action,
}: {
  plan: PublicPlan;
  isCurrent: boolean;
  action?: CardAction;
}) {
  // Plano com selo de destaque ("Mais popular") vem em fundo escuro.
  const featured = Boolean(plan.highlightLabel);
  const ink = featured ? colors.cream : colors.ink;
  const soft = featured ? 'rgba(245,241,232,0.7)' : colors.muted;

  return (
    <View style={[styles.card, featured && styles.cardFeatured]}>
      <View style={styles.badges}>
        {plan.highlightLabel ? (
          <Text style={[styles.badge, styles.badgeHighlight]}>{plan.highlightLabel}</Text>
        ) : null}
        {plan.promoLabel ? (
          <Text style={[styles.badge, styles.badgePromo]}>{plan.promoLabel}</Text>
        ) : null}
        {isCurrent ? <Text style={[styles.badge, styles.badgeCurrent]}>Seu plano</Text> : null}
      </View>

      <Text style={[styles.planName, { color: featured ? colors.gold : colors.ink }]}>
        Plano {plan.name}
      </Text>
      {plan.description ? <Text style={[styles.planDescription, { color: soft }]}>{plan.description}</Text> : null}

      <View style={styles.priceRow}>
        {plan.compareAtPriceCents ? (
          <Text style={[styles.priceFrom, { color: soft }]}>
            de <Text style={styles.struck}>{formatBRL(plan.compareAtPriceCents)}</Text> por
          </Text>
        ) : null}
        <Text style={[styles.price, { color: featured ? colors.gold : colors.goldDeep }]}>
          {formatBRL(plan.priceCents)}
          <Text style={[styles.priceSuffix, { color: soft }]}>{INTERVAL_SUFFIX[plan.interval]}</Text>
        </Text>
      </View>

      <View style={styles.benefits}>
        {plan.benefits.map((benefit) => (
          <View key={benefit.id} style={styles.benefit}>
            <Text style={styles.benefitIcon}>✦</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.benefitText, { color: ink }]}>{benefit.title}</Text>
              {benefit.description ? (
                <Text style={[styles.benefitDescription, { color: soft }]}>{benefit.description}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {action ? (
        <Button
          title={action.title}
          variant={action.primary ? 'primary' : 'ghost'}
          loading={action.loading}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}

export function PlansScreen() {
  return <PlansView />;
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2.5), paddingBottom: spacing(4) },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  creditPill: {
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    borderRadius: radius.pill,
    backgroundColor: colors.navy,
  },
  creditPillText: { fontFamily: fonts.body, fontSize: 13, color: colors.gold },

  hero: { gap: spacing(1), paddingTop: spacing(1) },
  slogan: { fontFamily: fonts.bodyItalic, fontSize: 18, color: colors.brown },

  steps: {
    gap: spacing(1.5),
    padding: spacing(2),
    borderRadius: radius.md,
    backgroundColor: colors.cream,
  },
  step: { flexDirection: 'row', gap: spacing(1.5), alignItems: 'flex-start' },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    lineHeight: 28,
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.navy,
    borderWidth: 1,
    borderColor: colors.gold,
    overflow: 'hidden',
  },
  stepTitle: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },

  current: {
    padding: spacing(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
    gap: 4,
  },
  currentName: { ...typography.display, fontSize: 22 },

  card: {
    padding: spacing(2.5),
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing(1.5),
  },
  cardFeatured: { backgroundColor: colors.navy, borderColor: colors.gold, borderWidth: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(0.75) },
  badge: {
    fontFamily: fonts.body,
    fontSize: 11,
    letterSpacing: 0.6,
    paddingHorizontal: spacing(1.25),
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  badgeHighlight: { backgroundColor: colors.gold, color: colors.navy },
  badgePromo: { backgroundColor: colors.brown, color: colors.cream },
  badgeCurrent: { borderWidth: 1, borderColor: colors.gold, color: colors.goldDeep },
  planName: { ...typography.display, fontSize: 22 },
  planDescription: { fontFamily: fonts.body, fontSize: 13.5 },
  priceRow: { gap: 2 },
  priceFrom: { fontFamily: fonts.body, fontSize: 13 },
  struck: { textDecorationLine: 'line-through' },
  price: { fontFamily: fonts.display, fontSize: 32 },
  priceSuffix: { fontFamily: fonts.body, fontSize: 14 },
  benefits: { gap: spacing(1) },
  benefit: { flexDirection: 'row', gap: spacing(1), alignItems: 'flex-start' },
  benefitIcon: { color: colors.gold, fontSize: 13, lineHeight: 21 },
  benefitText: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21 },
  benefitDescription: { fontFamily: fonts.body, fontSize: 12.5 },

  compare: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  compareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing(2),
  },
  compareTitle: { fontFamily: fonts.body, fontSize: 15.5, color: colors.ink, flex: 1 },
  compareToggle: { fontSize: 22, color: colors.goldDeep, paddingLeft: spacing(1) },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.25),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  compareHead: { backgroundColor: colors.cream },
  compareHeadText: { fontWeight: '600', color: colors.navy },
  compareLabel: { flex: 2, fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
  compareValue: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.goldDeep,
  },

  footer: {
    padding: spacing(2.5),
    gap: spacing(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
