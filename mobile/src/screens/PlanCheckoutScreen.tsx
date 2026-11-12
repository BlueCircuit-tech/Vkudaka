import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, formatBRL, fonts, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Screen } from '../components/ui';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Pagamento do plano pelo Mercado Pago (2026-11-12).
 *
 * O link abre a página do Mercado Pago (Pix ou cartão) fora do app. Esta tela
 * fica esperando: quem ativa a assinatura é o webhook no servidor, então ela
 * só consulta a situação — a cada poucos segundos e sempre que o app volta
 * para a frente. Pagou → a pessoa já é assinante e os créditos estão na carteira.
 */

type Status = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED' | 'REFUNDED';

interface CheckoutState {
  id: string;
  planName: string;
  status: Status;
  amountCents: number;
  url: string;
  currentPeriodEnd: string | null;
  walletBalanceCents: number;
}

const POLL_MS = 4000;

export function PlanCheckoutScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PlanCheckout'>>();
  const { refresh } = useAuth();
  const [state, setState] = useState<CheckoutState | null>(null);
  const opened = useRef(false);

  const openPayment = useCallback(() => void Linking.openURL(params.url), [params.url]);

  const check = useCallback(async () => {
    const next = await api.get<CheckoutState>(`/plans/checkout/${params.checkoutId}`).catch(() => null);
    if (next) setState(next);
    return next;
  }, [params.checkoutId]);

  // Abre o Mercado Pago uma vez ao entrar; o botão permite reabrir.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openPayment();
  }, [openPayment]);

  const paid = state?.status === 'PAID';
  const finished = paid || state?.status === 'EXPIRED' || state?.status === 'CANCELED';

  useEffect(() => {
    if (finished) return;
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [check, finished]);

  // Virou assinante: atualiza o usuário para liberar loja, comunidade etc.
  useEffect(() => {
    if (paid) void refresh();
  }, [paid, refresh]);

  const goToClub = () => navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });

  if (paid && state) {
    return (
      <Screen>
        <View style={styles.box}>
          <Text style={styles.icon}>✦</Text>
          <Text style={[typography.display, styles.center]}>Assinatura ativa!</Text>
          <Body>
            Plano {state.planName} confirmado
            {state.currentPeriodEnd
              ? ` até ${new Date(state.currentPeriodEnd).toLocaleDateString('pt-BR')}`
              : ''}
            . {formatBRL(state.amountCents)} viraram créditos VKUDAKA na sua carteira.
          </Body>
          <View style={styles.balance}>
            <Caption>Saldo na carteira</Caption>
            <Text style={styles.balanceValue}>{formatBRL(state.walletBalanceCents)}</Text>
          </View>
          <Button title="Entrar no clube" onPress={goToClub} />
        </View>
      </Screen>
    );
  }

  if (state && finished) {
    return (
      <Screen>
        <View style={styles.box}>
          <Text style={[typography.display, styles.center]}>Link vencido</Text>
          <Body>Este link de pagamento expirou. Volte aos planos e gere um novo.</Body>
          <Button title="Voltar aos planos" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.box}>
        <Text style={[typography.display, styles.center]}>Plano {params.planName}</Text>
        <Body>
          Conclua o pagamento na página do Mercado Pago, com Pix ou cartão. Assim que ele for
          aprovado, sua assinatura é ativada aqui automaticamente.
        </Body>
        <View style={styles.waiting}>
          <Text style={styles.waitingText}>Aguardando confirmação do pagamento…</Text>
          <Caption>Pix costuma confirmar em segundos. Pode voltar para o app depois de pagar.</Caption>
        </View>
        <Button title="Abrir pagamento" onPress={openPayment} />
        <Button title="Já paguei — verificar" variant="ghost" onPress={() => void check()} />
        <Button title="Voltar" variant="quiet" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing(2.5), gap: spacing(2) },
  center: { textAlign: 'center' },
  icon: { textAlign: 'center', fontSize: 40, color: colors.gold },
  waiting: {
    padding: spacing(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
    gap: spacing(0.75),
  },
  waitingText: { fontFamily: fonts.body, fontSize: 15.5, color: colors.ink },
  balance: {
    padding: spacing(2),
    borderRadius: radius.md,
    backgroundColor: colors.navy,
    gap: 4,
  },
  balanceValue: { fontFamily: fonts.display, fontSize: 28, color: colors.gold },
});
