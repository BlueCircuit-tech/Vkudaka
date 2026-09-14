import React, { useCallback, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { colors, formatBRL, radius, spacing, typography, fonts, brand } from '../theme/theme';
import { Body, Caption, Card, Label, Loading, Screen } from '../components/ui';

/**
 * Tela inicial — Club (2.2).
 *
 * Ordem da tela, do mais importante para o menos:
 *   1. Boas-vindas + logo (identidade)
 *   2. Cartão do clube: plano, crédito acumulado, próxima mensalidade
 *   3. Atalhos — "Escolha seu Look" primeiro (nome aprovado pela direção para o
 *      atalho de aluguel do protótipo antigo), depois loja, eventos, carteira
 *   4. Contato direto: WhatsApp e Instagram
 */

interface ClubData {
  welcome: string;
  isSubscriber: boolean;
  planName: string | null;
  planBenefits: Array<{ title: string; description: string | null }>;
  quarterlyRental: {
    eligible: boolean;
    available: boolean;
    nextPeriodStart: string;
    usedByOrderCode: string | null;
  };
  rebatePercent: number;
  clubCreditCents: number;
  walletBalanceCents: number;
  nextInvoice: {
    grossCents: number;
    creditCents: number;
    netCents: number;
    carryOverCents: number;
    dueDate: string;
  } | null;
  contacts: { whatsapp: string; instagram: string };
  storeUrl: string;
}

export function ClubScreen({ navigation }: { navigation: { navigate: (screen: string) => void } }) {
  const [data, setData] = useState<ClubData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setData(await api.get<ClubData>('/users/me/club'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
  };

  if (!data) return <Loading />;

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
      >
        {/* Logo/banner central */}
        <View style={styles.brand}>
          <Image
            source={brand.logo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="VKUDAKA"
          />
        </View>

        <Text style={[typography.display, styles.welcome]}>{data.welcome}</Text>

        {/* Cartão do clube */}
        <Card style={styles.clubCard}>
          <View style={styles.cardHeader}>
            <Label>Clube{data.planName ? ` · ${data.planName}` : ''}</Label>
            {data.rebatePercent > 0 ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{data.rebatePercent}% de abatimento</Text>
              </View>
            ) : null}
          </View>

          {data.nextInvoice ? (
            <>
              <Caption>Próxima mensalidade</Caption>
              <Text style={styles.amount}>{formatBRL(data.nextInvoice.netCents)}</Text>
              {data.nextInvoice.creditCents > 0 ? (
                <Caption>
                  {formatBRL(data.nextInvoice.grossCents)} − {formatBRL(data.nextInvoice.creditCents)}{' '}
                  de crédito das suas compras
                </Caption>
              ) : (
                <Caption>Compre sem usar o saldo da carteira para gerar crédito aqui.</Caption>
              )}
              {data.nextInvoice.carryOverCents > 0 ? (
                <Caption>
                  {formatBRL(data.nextInvoice.carryOverCents)} seguem para as próximas — crédito não expira.
                </Caption>
              ) : null}
            </>
          ) : (
            <Body muted>Assine o clube para acompanhar sua mensalidade por aqui.</Body>
          )}

          {/* RN-12 — peça do trimestre */}
          {data.quarterlyRental.eligible ? (
            <Caption>
              {data.quarterlyRental.available
                ? 'Sua peça do trimestre está disponível no aluguel.'
                : `Peça do trimestre usada · próxima em ${new Date(
                    data.quarterlyRental.nextPeriodStart,
                  ).toLocaleDateString('pt-BR')}.`}
            </Caption>
          ) : null}

          {/* O que o plano inclui — cadastrado no CRM, na ordem de lá. */}
          {data.planBenefits.length > 0 ? (
            <View style={styles.benefits}>
              {data.planBenefits.map((benefit) => (
                <View key={benefit.title} style={styles.benefit}>
                  <Text style={styles.benefitDot}>✦</Text>
                  <View style={{ flex: 1 }}>
                    <Body>{benefit.title}</Body>
                    {benefit.description ? <Caption>{benefit.description}</Caption> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        <View style={styles.balances}>
          <Card style={styles.balanceCard}>
            <Caption>Carteira</Caption>
            <Text style={styles.balanceValue}>{formatBRL(data.walletBalanceCents)}</Text>
            <Caption>paga suas compras</Caption>
          </Card>
          <Card style={styles.balanceCard}>
            <Caption>Crédito do clube</Caption>
            <Text style={styles.balanceValue}>{formatBRL(data.clubCreditCents)}</Text>
            <Caption>abate a mensalidade</Caption>
          </Card>
        </View>

        <View style={styles.shortcuts}>
          <Shortcut
            title="Escolha seu Look"
            subtitle="Ative sua melhor versão"
            onPress={() => navigation.navigate('Looks')}
          />
          <Shortcut title="Loja" subtitle="Peças da coleção" onPress={() => navigation.navigate('Loja')} />
          <Shortcut title="Eventos" subtitle="Confirme sua presença" onPress={() => navigation.navigate('Eventos')} />
          <Shortcut title="Carteira" subtitle="Créditos e recargas" onPress={() => navigation.navigate('Carteira')} />
        </View>

        {/* Contato direto com o clube */}
        <View style={styles.contacts}>
          <ContactButton label="WhatsApp" url={data.contacts.whatsapp} />
          <ContactButton label="Instagram" url={data.contacts.instagram} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Shortcut({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.7 }]}>
      <View>
        <Text style={styles.shortcutTitle}>{title}</Text>
        <Caption>{subtitle}</Caption>
      </View>
      <Text style={{ color: colors.goldDeep }}>›</Text>
    </Pressable>
  );
}

function ContactButton({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.contact, pressed && { opacity: 0.7 }]}
      accessibilityRole="link"
    >
      <Text style={styles.contactText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2), paddingBottom: spacing(6) },
  brand: { alignItems: 'center', paddingTop: spacing(2) },
  logo: { width: 190, height: 74 },
  welcome: { fontSize: 22, textAlign: 'center', lineHeight: 30 },
  clubCard: { gap: spacing(0.5), padding: spacing(2.5) },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: {
    borderColor: colors.gold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1),
    paddingVertical: 3,
  },
  chipText: { color: colors.goldDeep, fontSize: 10.5, letterSpacing: 0.6 },
  amount: { fontFamily: fonts.display, fontSize: 34, color: colors.ink, marginVertical: 2 },
  benefits: {
    marginTop: spacing(1.5),
    paddingTop: spacing(1.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing(1),
  },
  benefit: { flexDirection: 'row', gap: spacing(1), alignItems: 'flex-start' },
  benefitDot: { color: colors.goldDeep, fontSize: 11, marginTop: 4 },
  balances: { flexDirection: 'row', gap: spacing(1.5) },
  balanceCard: { flex: 1, gap: 2 },
  balanceValue: { fontFamily: fonts.display, fontSize: 20, color: colors.goldDeep },
  shortcuts: { gap: spacing(1) },
  shortcut: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(2),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  shortcutTitle: { ...typography.body, fontWeight: '600' },
  contacts: { flexDirection: 'row', gap: spacing(1.5), marginTop: spacing(1) },
  contact: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing(1.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  contactText: { color: colors.goldDeep, fontSize: 13.5, letterSpacing: 0.4 },
});
