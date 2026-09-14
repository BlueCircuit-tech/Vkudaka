import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary } from '../components/ProductGrid';

/**
 * Loja — vitrine de COMPRA (2.3), o foco do app.
 *
 * A faixa discreta ao final do cabeçalho leva ao lookbook "Escolha seu Look",
 * que também é de compra: a Loja abre pelos destaques, o lookbook pelos
 * lançamentos. O aluguel fica no rodapé da lista, como uma linha de texto —
 * existe, mas não disputa atenção com a venda.
 */
export function ShopScreen() {
  const navigation = useNavigation<never>();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.get<{ data: ProductSummary[] }>('/catalog/shop');
      setProducts(page.data);
    } catch (error) {
      // RN-01 — não assinante é levado ao site externo.
      if (error instanceof ApiError && error.isSubscriptionRequired) {
        (navigation as never as { navigate: (s: string, p?: unknown) => void }).navigate(
          'SubscriptionRequired',
          { storeUrl: error.storeUrl },
        );
        return;
      }
      throw error;
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!products) return <Loading />;

  return (
    <Screen scroll={false}>
      <ProductGrid
        products={products}
        mode="SALE"
        onPress={(product) =>
          (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate(
            'ProductDetail',
            { productId: product.id, mode: 'SALE' },
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={typography.label}>Coleção VKUDAKA</Text>
            <Text style={typography.display}>Loja</Text>
            <Caption>Toda compra sem uso de saldo gera crédito na sua próxima mensalidade.</Caption>

            {/* Porta do lookbook de compra: faixa discreta, sem concorrer com a vitrine. */}
            <Pressable
              onPress={() =>
                (navigation as never as { navigate: (s: string) => void }).navigate('Looks')
              }
              style={({ pressed }) => [styles.lookStrip, pressed && { opacity: 0.7 }]}
            >
              <View>
                <Text style={styles.lookTitle}>Escolha seu Look</Text>
                <Caption>Ative sua melhor versão</Caption>
              </View>
              <Text style={{ color: colors.muted }}>›</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          // Aluguel em segundo plano, por decisão da direção: o foco é a venda.
          // Fica depois da última peça, como uma linha de texto — quem procura
          // encontra; quem veio comprar não é puxado para lá.
          <Pressable
            onPress={() =>
              (navigation as never as { navigate: (s: string) => void }).navigate('Rental')
            }
            style={({ pressed }) => [styles.rentalLink, pressed && { opacity: 0.6 }]}
          >
            <Caption>Também alugamos peças selecionadas ›</Caption>
          </Pressable>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(0.5), paddingBottom: spacing(2) },
  lookStrip: {
    marginTop: spacing(2),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  lookTitle: { ...typography.body, fontSize: 14.5, color: colors.muted },
  rentalLink: { alignItems: 'center', paddingVertical: spacing(3) },
});
