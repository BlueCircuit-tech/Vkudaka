import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, ApiError } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary, type QuarterlyRental } from '../components/ProductGrid';
import { QuarterlyNotice } from '../components/QuarterlyNotice';

type Mode = 'SALE' | 'RENTAL';

/**
 * Loja — vitrine de COMPRA (2.3), o foco do app.
 *
 * A faixa discreta ao final do cabeçalho leva ao lookbook "Escolha seu Look",
 * que também é de compra: a Loja abre pelos destaques, o lookbook pelos
 * lançamentos.
 *
 * Filtro Comprar | Alugar no topo (pedido da direção, 2026-11-11): antes o
 * aluguel só aparecia num link de rodapé e quase ninguém achava. Comprar
 * continua sendo o padrão.
 */
export function ShopScreen() {
  const navigation = useNavigation<never>();
  const [mode, setMode] = useState<Mode>('SALE');
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [quarterly, setQuarterly] = useState<QuarterlyRental | null>(null);

  const load = useCallback(async () => {
    try {
      if (mode === 'RENTAL') {
        const page = await api.get<{ data: ProductSummary[]; quarterlyRental: QuarterlyRental }>(
          '/catalog/rental',
        );
        setProducts(page.data);
        setQuarterly(page.quarterlyRental);
      } else {
        const page = await api.get<{ data: ProductSummary[] }>('/catalog/shop');
        setProducts(page.data);
      }
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
  }, [navigation, mode]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setProducts(null);
    setMode(next);
  };

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
        mode={mode}
        onPress={(product) =>
          (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate(
            'ProductDetail',
            { productId: product.id, mode },
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={typography.label}>Coleção VKUDAKA</Text>
            <Text style={typography.display}>Loja</Text>

            <View style={styles.segment} accessibilityRole="tablist">
              {(
                [
                  { key: 'SALE', label: 'Comprar' },
                  { key: 'RENTAL', label: 'Alugar' },
                ] as const
              ).map((option) => {
                const active = option.key === mode;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => switchMode(option.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {mode === 'SALE' ? (
              <Caption>
                Assinantes têm desconto fidelidade em toda compra — inclusive pagando com
                créditos.
              </Caption>
            ) : (
              <>
                <Caption>
                  Peças selecionadas pela VKUDAKA para uso por período, com valor de locação e
                  devolução combinada.
                </Caption>
                <QuarterlyNotice quarterly={quarterly} />
              </>
            )}

            {/* Porta do lookbook de compra: faixa discreta, sem concorrer com a vitrine. */}
            {mode === 'SALE' ? (
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
            ) : null}
          </View>
        }
        ListFooterComponent={
          // No fim da vitrine de compra, a mesma porta do filtro "Alugar".
          mode === 'SALE' ? (
            <Pressable
              onPress={() => switchMode('RENTAL')}
              style={({ pressed }) => [styles.rentalLink, pressed && { opacity: 0.6 }]}
            >
              <Caption>Também alugamos peças selecionadas ›</Caption>
            </Pressable>
          ) : undefined
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
  segment: {
    flexDirection: 'row',
    marginTop: spacing(1.5),
    marginBottom: spacing(0.5),
    padding: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing(1),
    borderRadius: radius.pill,
  },
  segmentItemActive: { backgroundColor: colors.gold },
  segmentText: { ...typography.body, fontSize: 14, color: colors.muted },
  segmentTextActive: { color: colors.ink, fontWeight: '600' },
});
