import React from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { spacing, typography, brand } from '../theme/theme';
import { Body, Button, Caption, Screen } from '../components/ui';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * RN-01 — destino de quem não tem assinatura ativa.
 *
 * O app não vende assinatura por dentro: leva ao site externo já existente.
 * A URL vem do servidor (`storeUrl`), nunca hardcoded, para que a troca de
 * domínio não exija nova submissão às lojas.
 */
export function SubscriptionRequiredScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'SubscriptionRequired'>>();
  const { user } = useAuth();
  const storeUrl = route.params?.storeUrl ?? user?.storeUrl;

  return (
    <Screen>
      <View style={styles.content}>
        <Image source={brand.logo} style={styles.logo} resizeMode="contain" />
        <Text style={[typography.display, styles.title]}>Área exclusiva de assinantes</Text>
        <Body>
          A loja, o aluguel, a carteira e a comunidade são do clube. Para acessar, assine no site
          da VKUDAKA — leva menos de dois minutos.
        </Body>
        <Caption>Você continua podendo comprar ingressos avulsos para os eventos abertos.</Caption>

        {storeUrl ? (
          <Button title="Assinar no site VKUDAKA" onPress={() => void Linking.openURL(storeUrl)} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(3), gap: spacing(2), alignItems: 'stretch' },
  logo: { width: 180, height: 70, alignSelf: 'center' },
  title: { fontSize: 24 },
});
