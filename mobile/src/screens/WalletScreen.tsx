import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { colors, formatBRL, radius, spacing, typography, fonts } from '../theme/theme';
import { Body, Button, Caption, Card, Divider, Label, Loading, Screen } from '../components/ui';
import { PurchaseRulesModal } from '../components/PurchaseRulesModal';

/**
 * Carteira digital (2.6) — menu apartado.
 *
 * Desde 2026-11-11, 100% da mensalidade entra aqui como crédito VKUDAKA e
 * paga peças da marca; o desconto fidelidade vale também pagando com créditos.
 * O "crédito do clube" antigo (abate a mensalidade) só aparece se houver saldo
 * remanescente dele.
 */

interface WalletData {
  balanceCents: number;
  clubCreditCents: number;
}

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

const TOP_UP_OPTIONS = [5_000, 10_000, 20_000, 50_000];

const TYPE_LABEL: Record<string, string> = {
  TOPUP: 'Recarga',
  SUBSCRIPTION: 'Créditos da assinatura',
  PURCHASE: 'Compra',
  REFUND: 'Estorno',
  ADJUSTMENT_CREDIT: 'Ajuste do clube',
  ADJUSTMENT_DEBIT: 'Ajuste do clube',
};

export function WalletScreen() {
  const navigation = useNavigation<never>();
  const [data, setData] = useState<WalletData | null>(null);
  const [statement, setStatement] = useState<Transaction[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);

  const goToTopUp = (suggestedCents?: number) =>
    (navigation as never as { navigate: (s: string, p?: unknown) => void }).navigate(
      'TopUp',
      suggestedCents ? { suggestedCents } : undefined,
    );

  const load = useCallback(async () => {
    const [walletData, statementData] = await Promise.all([
      api.get<WalletData>('/wallet'),
      api.get<{ transactions: Transaction[] }>('/wallet/statement'),
    ]);
    setData(walletData);
    setStatement(statementData.transactions);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!data) return <Loading />;

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.display}>Carteira</Text>

        <Card style={styles.balanceCard}>
          <Label>Créditos VKUDAKA</Label>
          <Text style={styles.balance}>{formatBRL(data.balanceCents)}</Text>
          <Caption>100% da sua mensalidade entra aqui. Use para comprar peças da marca.</Caption>
        </Card>

        {data.clubCreditCents > 0 ? (
          <Card style={styles.creditCard}>
            <Label>Crédito de mensalidade</Label>
            <Text style={styles.credit}>{formatBRL(data.clubCreditCents)}</Text>
            <Caption>Saldo da regra antiga: abate a próxima mensalidade. Não expira.</Caption>
          </Card>
        ) : null}

        <View style={styles.notice}>
          <Body>Seu desconto fidelidade vale também quando você paga com os créditos.</Body>
          <Button
            title="Como funcionam os créditos"
            variant="quiet"
            onPress={() => setRulesOpen(true)}
          />
        </View>

        <PurchaseRulesModal
          visible={rulesOpen}
          readOnly
          contentKey="rebate_rules"
          onAccept={() => setRulesOpen(false)}
          onClose={() => setRulesOpen(false)}
        />

        <View style={styles.block}>
          <Label>Comprar créditos</Label>
          <Caption>Recarga por Pix ou cartão. Toque num valor ou escolha o seu.</Caption>
          <View style={styles.options}>
            {TOP_UP_OPTIONS.map((amount) => (
              <Pressable
                key={amount}
                onPress={() => goToTopUp(amount)}
                style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.optionText}>{formatBRL(amount)}</Text>
              </Pressable>
            ))}
          </View>
          <Button title="Recarregar" onPress={() => goToTopUp()} />
        </View>

        <View style={styles.block}>
          <Label>Extrato</Label>
          {statement.length === 0 ? (
            <Caption>Nenhuma movimentação ainda.</Caption>
          ) : (
            statement.map((transaction) => (
              <View key={transaction.id}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Body>{TYPE_LABEL[transaction.type] ?? transaction.type}</Body>
                    <Caption>{transaction.description}</Caption>
                    <Caption>
                      {new Date(transaction.createdAt).toLocaleString('pt-BR')}
                    </Caption>
                  </View>
                  <Text
                    style={[
                      styles.amount,
                      { color: transaction.amountCents >= 0 ? colors.success : colors.ink },
                    ]}
                  >
                    {transaction.amountCents >= 0 ? '+' : '−'}
                    {formatBRL(Math.abs(transaction.amountCents))}
                  </Text>
                </View>
                <Divider />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2), paddingBottom: spacing(6) },
  balanceCard: { gap: 2 },
  balance: { fontFamily: fonts.display, fontSize: 34, color: colors.ink },
  creditCard: { gap: 2, borderColor: colors.gold },
  credit: { fontFamily: fonts.display, fontSize: 26, color: colors.goldDeep },
  notice: {
    padding: spacing(2),
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  block: { gap: spacing(1) },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  option: {
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(2),
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  optionText: { color: colors.goldDeep, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingVertical: spacing(0.5) },
  amount: { fontFamily: fonts.display, fontSize: 15 },
});
