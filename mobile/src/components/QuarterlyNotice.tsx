import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body } from './ui';
import type { QuarterlyRental } from './ProductGrid';

/** RN-12 — peça do trimestre: 1 por trimestre sem custo de locação, frete por conta da cliente. */
export function QuarterlyNotice({ quarterly }: { quarterly: QuarterlyRental | null }) {
  if (!quarterly?.eligible) return null;
  const nextStart = new Date(quarterly.nextPeriodStart);

  return (
    <View style={[styles.quarter, quarterly.available && styles.quarterOn]}>
      <Text style={styles.quarterTitle}>
        {quarterly.available
          ? 'Sua peça do trimestre está disponível'
          : 'Peça do trimestre já usada'}
      </Text>
      <Body>
        {quarterly.available
          ? `Escolha uma peça e alugue sem custo de locação — você paga só o frete. Vale até ${nextStart.toLocaleDateString('pt-BR')}.`
          : `Usada no pedido ${quarterly.usedByOrderCode}. A próxima libera em ${nextStart.toLocaleDateString('pt-BR')}. Até lá, o aluguel sai pelo valor normal.`}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  quarter: {
    marginTop: spacing(1.5),
    padding: spacing(1.75),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    gap: 4,
  },
  quarterOn: { borderColor: colors.gold },
  quarterTitle: { ...typography.body, fontWeight: '600', color: colors.goldDeep },
});
