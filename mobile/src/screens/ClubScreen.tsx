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
 *   2. Cartão do clube: plano, créditos VKUDAKA (100% da mensalidade vira
 *      crédito na carteira — regra de 2026-11-11), renovação e benefícios
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
                <Text style={styles.chipText}>{data.rebatePercent}% de desconto fidelidade</Text>
              </View>
            ) : null}
          </View>

          {data.isSubscriber ? (
            <>
              <Caption>Créditos VKUDAKA</Caption>
              <Text style={styles.amount}>{formatBRL(data.walletBalanceCents)}</Text>
              <Caption>100% da sua mensalidade vira crédito para usar em peças da marca.</Caption>
              {data.nextInvoice ? (
                <Caption>
                  Plano {data.planName} válido até{' '}
                  {new Date(data.nextInvoice.dueDate).toLocaleDateString('pt-BR')}.
                </Caption>
              ) : null}
            </>
          ) : (
            <Body muted>
              Assine o clube: 100% da mensalidade vira crédito para comprar peças VKUDAKA.
            </Body>
          )}

          <Pressable
            onPress={() => navigation.navigate('Plans')}
            style={({ pressed }) => [styles.plansLink, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.plansLinkText}>
              {data.isSubscriber ? 'Meu plano · trocar ou renovar ›' : 'Assine um plano ›'}
            </Text>
          </Pressable>

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

        <View style={styles.shortcuts}>
          <Shortcut
            title="Escolha seu Look"
            subtitle="Ative sua melhor versão"
            onPress={() => navigation.navigate('Looks')}
          />
          <Shortcut
            title="Loja"
            subtitle="Peças da coleção"
            onPress={() =>
              (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate('Loja', {
                picker: Date.now(),
              })
            }
          />
          <Shortcut title="Eventos" subtitle="Confirme sua presença" onPress={() => navigation.navigate('Eventos')} />
          <Shortcut title="Carteira" subtitle="Créditos e recargas" onPress={() => navigation.navigate('Carteira')} />
          <Shortcut
            title="Planos e benefícios"
            subtitle="Créditos, desconto e eventos"
            onPress={() => navigation.navigate('Plans')}
          />
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
  plansLink: { paddingTop: spacing(1) },
  plansLinkText: { fontFamily: fonts.body, fontSize: 14, color: colors.goldDeep },
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
