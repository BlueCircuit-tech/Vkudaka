import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Caption } from '../components/ui';
import { PlansView } from './PlansScreen';

/**
 * RN-01 — destino de quem não tem assinatura ativa.
 *
 * Mostra os planos e benefícios (vindos do CRM) com o aviso de área exclusiva.
 * Com o Mercado Pago configurado, cada plano tem o botão de assinar (link de
 * pagamento Pix/cartão); sem ele, o botão leva ao site (`storeUrl` do servidor).
 */
export function SubscriptionRequiredScreen() {
  return (
    <PlansView
      notice={
        <View style={styles.notice}>
          <Text style={[typography.display, styles.title]}>Área exclusiva de assinantes</Text>
          <Body>
            A loja, o aluguel e a comunidade são do clube. Escolha seu plano e pague com Pix ou
            cartão — assim que o pagamento for aprovado, o acesso é liberado e o valor vira
            crédito na sua carteira.
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
