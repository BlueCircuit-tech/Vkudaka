import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '../api/client';
import { colors, formatBRL, fonts, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Card, Label, Screen } from '../components/ui';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Recarga da carteira (2.6) — menu apartado, comprar créditos pelo gateway.
 *
 * Existe separada do fechamento do pedido porque as duas coisas são
 * diferentes: aqui a pessoa compra saldo, lá ela paga uma peça. O checkout
 * manda para cá quando falta saldo para fechar a compra pela carteira, com o
 * valor da diferença já sugerido.
 *
 * O Pix é assíncrono: a tela mostra o código, acompanha a confirmação pelo
 * servidor e só declara o saldo disponível quando o webhook creditou. Nada de
 * somar na tela antes do dinheiro entrar.
 */

const PRESETS = [5_000, 10_000, 20_000, 50_000];
const MIN_CENTS = 1_000;
const MAX_CENTS = 5_000_00;

type Method = 'PIX' | 'CREDIT_CARD';

interface TopUp {
  id: string;
  status: string;
  amountCents: number;
  pix: { qrCode: string | null; copyPaste: string } | null;
  creditedAt: string | null;
  balanceCents: number;
}

/** Aceita "300", "300,50" ou "R$ 300,50" e devolve centavos. */
function parseAmount(text: string): number | null {
  const clean = text.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function TopUpScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'TopUp'>>();
  const navigation = useNavigation() as { goBack: () => void };
  const suggested = route.params?.suggestedCents ?? null;

  const [amount, setAmount] = useState(
    suggested ? (suggested / 100).toFixed(2).replace('.', ',') : '',
  );
  const [method, setMethod] = useState<Method>('PIX');
  const [busy, setBusy] = useState(false);
  const [charge, setCharge] = useState<TopUp | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const amountCents = parseAmount(amount);
  const amountError =
    amountCents === null
      ? null
      : amountCents < MIN_CENTS
        ? `Mínimo de ${formatBRL(MIN_CENTS)}.`
        : amountCents > MAX_CENTS
          ? `Máximo de ${formatBRL(MAX_CENTS)} por recarga.`
          : null;
  const canSubmit = amountCents !== null && amountError === null && !busy;

  useEffect(() => {
    void api.get<{ balanceCents: number }>('/wallet').then((w) => setBalanceCents(w.balanceCents));
  }, []);

  /** Para o acompanhamento ao sair da tela — evita timer órfão. */
  useEffect(() => () => { if (polling.current) clearInterval(polling.current); }, []);

  const finish = useCallback(
    (credited: TopUp) => {
      if (polling.current) clearInterval(polling.current);
      polling.current = null;
      setBalanceCents(credited.balanceCents);
      Alert.alert(
        'Recarga confirmada',
        `${formatBRL(credited.amountCents)} entraram na sua carteira.`,
        [{ text: 'Voltar', onPress: () => navigation.goBack() }],
      );
    },
    [navigation],
  );

  const watch = useCallback(
    (paymentId: string) => {
      if (polling.current) clearInterval(polling.current);
      polling.current = setInterval(() => {
        void api
          .get<TopUp>(`/wallet/topup/${paymentId}`)
          .then((status) => {
            setCharge(status);
            if (status.creditedAt) finish(status);
          })
          .catch(() => {
            /* rede instável: a próxima batida tenta de novo */
          });
      }, 4000);
    },
    [finish],
  );

  const submit = async () => {
    if (amountCents === null) return;
    setBusy(true);
    try {
      const response = await api.post<{
        payment: { id: string; status: string };
        pix: { qrCode: string | null; copyPaste: string } | null;
      }>('/wallet/topup', { amountCents, method });

      const created: TopUp = {
        id: response.payment.id,
        status: response.payment.status,
        amountCents,
        pix: response.pix,
        creditedAt: null,
        balanceCents: balanceCents ?? 0,
      };
      setCharge(created);

      if (response.payment.status === 'PAID') {
        // Cartão aprovado na hora: o saldo já entrou.
        const confirmed = await api.get<TopUp>(`/wallet/topup/${response.payment.id}`);
        finish(confirmed);
        return;
      }
      watch(response.payment.id);
    } catch (error) {
      Alert.alert('Não foi possível recarregar', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Cobrança criada: mostra o Pix e acompanha ──────────────────────────────
  if (charge?.pix) {
    return (
      <Screen scroll={false}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={typography.display}>Pague o Pix</Text>
          <Caption>
            {formatBRL(charge.amountCents)} · o saldo entra assim que o pagamento for confirmado.
          </Caption>

          <Card style={styles.qrCard}>
            <View style={styles.qrBox}>
              <QRCode value={charge.pix.copyPaste} size={196} backgroundColor="#FFFFFF" />
            </View>
          </Card>

          <Card style={{ gap: spacing(1) }}>
            <Label>Pix copia e cola</Label>
            <Text selectable style={styles.code}>
              {charge.pix.copyPaste}
            </Text>
            <Button
              title="Compartilhar código"
              variant="ghost"
              onPress={() => void Share.share({ message: charge.pix!.copyPaste })}
            />
          </Card>

          <View style={styles.waiting}>
            <ActivityIndicator color={colors.goldDeep} />
            <Caption>Aguardando a confirmação do pagamento…</Caption>
          </View>

          <Button title="Voltar" variant="ghost" onPress={() => navigation.goBack()} />
        </ScrollView>
      </Screen>
    );
  }

  // ── Escolha do valor e da forma ───────────────────────────────────────────
  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.display}>Recarregar</Text>
        <Caption>
          {balanceCents === null
            ? 'Comprar créditos para usar nas compras do app.'
            : `Saldo atual: ${formatBRL(balanceCents)}. Os créditos ficam na carteira e pagam suas compras.`}
        </Caption>

        {suggested ? (
          <View style={styles.suggestion}>
            <Body>
              Faltam {formatBRL(suggested)} para fechar a compra usando a carteira. Você pode
              recarregar esse valor — ou voltar e pagar o pedido inteiro no Pix.
            </Body>
          </View>
        ) : null}

        <Card style={{ gap: spacing(1.5) }}>
          <Label>Valor</Label>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>R$</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={colors.muted}
              style={styles.amountInput}
            />
          </View>
          {amountError ? <Text style={styles.error}>{amountError}</Text> : null}

          <View style={styles.presets}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset}
                onPress={() => setAmount((preset / 100).toFixed(2).replace('.', ','))}
                style={({ pressed }) => [
                  styles.preset,
                  amountCents === preset && styles.presetOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.presetText, amountCents === preset && { color: colors.ink }]}>
                  {formatBRL(preset)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card style={{ gap: spacing(1) }}>
          <Label>Forma de pagamento</Label>
          <View style={styles.methods}>
            {(['PIX', 'CREDIT_CARD'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setMethod(option)}
                style={[styles.method, method === option && styles.methodOn]}
              >
                <Text
                  style={[
                    typography.body,
                    method === option && { color: colors.ink, fontWeight: '600' },
                  ]}
                >
                  {option === 'PIX' ? 'Pix' : 'Cartão'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Caption>
            {method === 'PIX'
              ? 'Geramos o código na próxima tela. O saldo entra após a confirmação.'
              : 'A cobrança é feita no cartão e o saldo entra na hora.'}
          </Caption>
        </Card>

        <View style={styles.notice}>
          <Caption>
            Lembrete: pagar uma compra com saldo da carteira desativa o abatimento do plano
            naquele pedido.
          </Caption>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={amountCents ? `Recarregar ${formatBRL(amountCents)}` : 'Recarregar'}
          onPress={() => void submit()}
          loading={busy}
          disabled={!canSubmit}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2), paddingBottom: spacing(4) },
  suggestion: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing(1.75),
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  currency: { ...typography.title, color: colors.muted },
  amountInput: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.ink,
    paddingVertical: spacing(0.5),
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  preset: {
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.75),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  presetOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  presetText: { ...typography.body, color: colors.muted },
  methods: { flexDirection: 'row', gap: spacing(1) },
  method: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing(1.25),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  methodOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  notice: { paddingHorizontal: spacing(0.5) },
  error: { ...typography.caption, color: colors.danger },
  qrCard: { alignItems: 'center', paddingVertical: spacing(2.5) },
  qrBox: { backgroundColor: '#FFFFFF', padding: spacing(1.5), borderRadius: radius.sm },
  code: {
    ...typography.caption,
    color: colors.ink,
    lineHeight: 18,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing(1.25),
  },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.25) },
  footer: {
    padding: spacing(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
