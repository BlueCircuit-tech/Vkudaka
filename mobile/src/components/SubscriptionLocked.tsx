import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Screen } from './ui';
import type { RootStackParamList } from '../navigation/RootNavigator';

/** O servidor recusou porque a pessoa não tem assinatura ativa (402 RN-01)? */
export const isSubscriptionRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.isSubscriptionRequired;

/**
 * RN-01 — o que quem não assina vê numa área do clube (loja, comunidade,
 * looks, aluguel). Antes a tela ficava carregando para sempre; agora explica
 * e leva direto para os planos, onde dá para assinar pelo Mercado Pago.
 */
export function SubscriptionLocked({ area }: { area: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Screen>
      <View style={styles.box}>
        <Text style={styles.icon}>✦</Text>
        <Text style={[typography.display, styles.center]}>Exclusivo para assinantes</Text>
        <Body>
          Para acessar {area}, assine um plano do Clube VKUDAKA. Você paga com Pix ou cartão, o
          acesso é liberado na hora e 100% do valor vira crédito na sua carteira para comprar peças.
        </Body>
        <Button title="Ver planos e assinar" onPress={() => navigation.navigate('Plans')} />
        <View style={styles.note}>
          <Caption>Ingressos avulsos dos eventos abertos continuam liberados para você.</Caption>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', padding: spacing(3), gap: spacing(2) },
  center: { textAlign: 'center' },
  icon: { textAlign: 'center', fontSize: 40, color: colors.gold },
  note: {
    padding: spacing(1.5),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
