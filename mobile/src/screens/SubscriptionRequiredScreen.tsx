import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Caption } from '../components/ui';
import { PlansView } from './PlansScreen';

/**
 * RN-01 — destino de quem não tem assinatura ativa.
 *
 * Mostra os planos e benefícios (vindos do CRM) com o aviso de área exclusiva.
 * O app não vende assinatura por dentro: o botão leva ao site da VKUDAKA, com a
 * URL vinda do servidor (`storeUrl`), nunca fixa no app.
 */
export function SubscriptionRequiredScreen() {
  return (
    <PlansView
      notice={
        <View style={styles.notice}>
          <Text style={[typography.display, styles.title]}>Área exclusiva de assinantes</Text>
          <Body>
            A loja, o aluguel, a carteira e a comunidade são do clube. Escolha seu plano e assine
            no site da VKUDAKA — leva menos de dois minutos.
          </Body>
          <Caption>Você continua podendo comprar ingressos avulsos para os eventos abertos.</Caption>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: spacing(1),
    padding: spacing(2),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 20 },
});
