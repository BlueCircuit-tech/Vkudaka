import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { api } from '../api/client';
import { usePaymentMethods } from '../api/payments';
import { colors, formatBRL, radius, spacing, typography, fonts } from '../theme/theme';
import { Body, Button, Caption, Card, Label, Loading, Screen } from '../components/ui';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Fechamento do pedido (2.6 / RN-02 / RN-03).
 *
 * Desde 2026-11-11 a mensalidade inteira vira crédito na carteira e o desconto
 * fidelidade do plano vale na hora, inclusive pagando com créditos. (Plano no
 * modo antigo, "crédito na próxima mensalidade", ainda perde o benefício ao
 * usar saldo — a mensagem do servidor explica.) Todo número exibido vem de
 * `POST /orders/quote` — nenhuma conta é feita no cliente.
 */

interface Quote {
  subtotalCents: number;
  shippingCents: number;
  couponDiscountCents: number;
  immediateDiscountCents: number;
  totalCents: number;
  walletAppliedCents: number;
  gatewayAmountCents: number;
  rebateEligible: boolean;
  rebateBlockedReason: string | null;
  rebateCreditCents: number;
  rebateMessage: string;
  alternativeWithoutWallet: { totalCents: number; rebateCreditCents: number } | null;
  items: Array<{ name: string; quantity: number; totalCents: number; quarterlyRental?: boolean }>;
  quarterlyRental: { applied: boolean; savedCents: number; periodLabel: string } | null;
}

export function CheckoutScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Checkout'>>();
  const navigation = useNavigation<never>();
  const { variantId, mode } = route.params;

  const [wallet, setWallet] = useState<{ balanceCents: number } | null>(null);
  const [useWallet, setUseWallet] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const availableMethods = usePaymentMethods();

  const items = [{ kind: mode, variantId, quantity: 1 }];

  const loadQuote = useCallback(
    async (walletCents: number) => {
      const result = await api.post<Quote>('/orders/quote', {
        items,
        useWalletCents: walletCents,
      });
      setQuote(result);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variantId, mode],
  );

  // Recarregar o saldo ao voltar do foco: quem foi recarregar a carteira
  // precisa encontrar o valor novo aqui, sem refazer o pedido.
  useFocusEffect(
    useCallback(() => {
      void api.get<{ balanceCents: number }>('/wallet').then(setWallet);
    }, []),
  );

  useEffect(() => {
    // Recotar sempre que a intenção de uso do saldo mudar: é o que ativa ou
    // desativa o abatimento (RN-02).
    void loadQuote(useWallet ? (wallet?.balanceCents ?? 0) : 0);
  }, [useWallet, wallet, loadQuote]);

  const confirm = async () => {
    setSubmitting(true);
    try {
      const response = await api.post<{ order: { code: string }; payment: { pixCopyPaste?: string } | null }>(
        '/orders',
        {
          items,
          useWalletCents: useWallet ? (wallet?.balanceCents ?? 0) : 0,
          paymentMethod,
        },
      );
      Alert.alert(
        'Pedido criado',
        response.payment?.pixCopyPaste
          ? `Pedido ${response.order.code}. Finalize o pagamento pelo Pix.`
          : `Pedido ${response.order.code} confirmado.`,
      );
      (navigation as never as { navigate: (s: string) => void }).navigate('Tabs');
    } catch (error) {
      Alert.alert('Não foi possível concluir', (error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!quote || !wallet) return <Loading />;

  /** Quanto falta na carteira para o saldo cobrir o pedido inteiro. */
  const missingCents = useWallet ? Math.max(0, quote.totalCents - wallet.balanceCents) : 0;

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Label>Resumo</Label>
          {quote.items.map((item, index) => (
            <View key={`${item.name}-${index}`} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Body>
                  {item.quantity}× {item.name}
                </Body>
                {item.quarterlyRental ? (
                  <Caption>Sua peça do trimestre — sem custo de locação</Caption>
                ) : null}
              </View>
              <Body>{item.quarterlyRental ? 'R$ 0,00' : formatBRL(item.totalCents)}</Body>
            </View>
          ))}
          {quote.couponDiscountCents > 0 ? (
            <View style={styles.line}>
              <Caption>Cupom</Caption>
              <Caption>−{formatBRL(quote.couponDiscountCents)}</Caption>
            </View>
          ) : null}
          <View style={styles.line}>
            <Caption>Frete</Caption>
            <Caption>{quote.shippingCents === 0 ? 'grátis' : formatBRL(quote.shippingCents)}</Caption>
          </View>
          {quote.immediateDiscountCents > 0 ? (
            <View style={styles.line}>
              <Caption>Desconto fidelidade</Caption>
              <Caption>−{formatBRL(quote.immediateDiscountCents)}</Caption>
            </View>
          ) : null}
          <View style={[styles.line, styles.total]}>
            <Text style={typography.title}>Total</Text>
            <Text style={typography.title}>{formatBRL(quote.totalCents)}</Text>
          </View>
        </Card>

        {/* A escolha da RN-02 */}
        <Card style={styles.walletCard}>
          <View style={styles.walletHeader}>
            <View style={{ flex: 1 }}>
              <Label>Carteira</Label>
              <Body>Usar {formatBRL(wallet.balanceCents)} de créditos</Body>
            </View>
            <Switch
              value={useWallet}
              onValueChange={setUseWallet}
              disabled={wallet.balanceCents === 0}
              trackColor={{ true: colors.gold, false: colors.border }}
              thumbColor={colors.ink}
            />
          </View>

          <View style={styles.tradeoff}>
            <Text style={styles.tradeoffText}>{quote.rebateMessage}</Text>
          </View>

          {quote.walletAppliedCents > 0 ? (
            <>
              <View style={styles.line}>
                <Caption>Pago com saldo</Caption>
                <Caption>−{formatBRL(quote.walletAppliedCents)}</Caption>
              </View>
              <View style={styles.line}>
                <Body>A pagar agora</Body>
                <Body>{formatBRL(quote.gatewayAmountCents)}</Body>
              </View>

              {/*
                O saldo não cobre o pedido inteiro. Em vez de deixar a pessoa
                somar de cabeça, a tela mostra a diferença e leva à recarga com
                o valor já preenchido — ou ela segue e paga o restante no Pix.
              */}
              {missingCents > 0 ? (
                <View style={styles.topUpBox}>
                  <Body>
                    Faltam {formatBRL(missingCents)} para pagar tudo pela carteira.
                  </Body>
                  <Button
                    title={`Recarregar ${formatBRL(missingCents)}`}
                    variant="quiet"
                    onPress={() =>
                      (
                        navigation as never as { navigate: (s: string, p: unknown) => void }
                      ).navigate('TopUp', { suggestedCents: missingCents })
                    }
                  />
                  <Caption>
                    Ou continue e pague os {formatBRL(quote.gatewayAmountCents)} restantes no Pix
                    ou no cartão.
                  </Caption>
                </View>
              ) : null}
            </>
          ) : quote.rebateEligible && quote.rebateCreditCents > 0 ? (
            <View style={styles.line}>
              <Caption>Crédito gerado</Caption>
              <Text style={styles.credit}>+{formatBRL(quote.rebateCreditCents)}</Text>
            </View>
          ) : null}
        </Card>

        <Card>
          <Label>Pagamento</Label>
          <View style={styles.methods}>
            {availableMethods.map((method) => (
              <Pressable
                key={method}
                onPress={() => setPaymentMethod(method)}
                style={[styles.method, paymentMethod === method && styles.methodSelected]}
              >
                <Text
                  style={[
                    typography.body,
                    paymentMethod === method && { color: colors.ink, fontWeight: '600' },
                  ]}
                >
                  {method === 'PIX' ? 'Pix' : 'Cartão'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Pagar ${formatBRL(quote.gatewayAmountCents)}`}
          onPress={() => void confirm()}
          loading={submitting}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2), paddingBottom: spacing(4) },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing(1), paddingTop: spacing(1) },
  walletCard: { gap: spacing(1) },
  topUpBox: {
    gap: spacing(1),
    marginTop: spacing(0.5),
    padding: spacing(1.5),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    backgroundColor: colors.surfaceAlt,
  },
  walletHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  tradeoff: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing(1.5),
  },
  tradeoffText: { ...typography.caption, color: colors.goldDeep, lineHeight: 18 },
  credit: { color: colors.goldDeep, fontFamily: fonts.display, fontSize: 16 },
  methods: { flexDirection: 'row', gap: spacing(1), paddingTop: spacing(1) },
  method: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing(1.25),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  methodSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  footer: {
    padding: spacing(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
