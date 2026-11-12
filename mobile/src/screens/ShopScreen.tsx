import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { SubscriptionLocked, isSubscriptionRequired } from '../components/SubscriptionLocked';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary, type QuarterlyRental } from '../components/ProductGrid';
import { QuarterlyNotice } from '../components/QuarterlyNotice';

type Mode = 'SALE' | 'RENTAL';

interface Category {
  id: string;
  name: string;
  /** Vitrine onde aparece: BOTH = venda e locação. */
  scope: 'SALE' | 'RENTAL' | 'BOTH';
}

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
 *
 * Categorias (Alfaiataria, Moda Festa…) logo abaixo: vêm do CRM e cada uma diz
 * se vale para venda, locação ou ambas. "Todas" é o padrão.
 */
export function ShopScreen() {
  const navigation = useNavigation<never>();
  const [mode, setMode] = useState<Mode>('SALE');
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [quarterly, setQuarterly] = useState<QuarterlyRental | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const visibleCategories = categories.filter((c) => c.scope === 'BOTH' || c.scope === mode);

  const load = useCallback(async () => {
    try {
      const query = categoryId ? `?categoryId=${categoryId}` : '';
      if (mode === 'RENTAL') {
        const page = await api.get<{ data: ProductSummary[]; quarterlyRental: QuarterlyRental }>(
          `/catalog/rental${query}`,
        );
        setProducts(page.data);
        setQuarterly(page.quarterlyRental);
      } else {
        const page = await api.get<{ data: ProductSummary[] }>(`/catalog/shop${query}`);
        setProducts(page.data);
      }
      setLocked(false);
    } catch (error) {
      // RN-01 — quem não assina vê o aviso com o caminho para os planos.
      if (isSubscriptionRequired(error)) {
        setLocked(true);
        return;
      }
      throw error;
    }
  }, [mode, categoryId]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setProducts(null);
    setMode(next);
    // A categoria escolhida só continua se também existir na outra vitrine.
    const current = categories.find((c) => c.id === categoryId);
    if (current && current.scope !== 'BOTH' && current.scope !== next) setCategoryId(null);
  };

  const chooseCategory = (next: string | null) => {
    if (next === categoryId) return;
    setProducts(null);
    setCategoryId(next);
  };

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useFocusEffect(
    useCallback(() => {
      void api
        .get<Category[]>('/catalog/categories')
        .then(setCategories)
        .catch(() => undefined);
    }, []),
  );

  if (locked) return <SubscriptionLocked area="a Loja" />;
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

            {visibleCategories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categories}
              >
                {[{ id: null, name: 'Todas' }, ...visibleCategories].map((category) => {
                  const active = category.id === categoryId;
                  return (
                    <Pressable
                      key={category.id ?? 'all'}
                      onPress={() => chooseCategory(category.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.category, active && styles.categoryActive]}
                    >
                      <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                        {category.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {mode === 'SALE' ? (
              <Caption>
                Assinantes têm desconto fidelidade em toda compra — inclusive pagando com créditos.
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
  categories: { gap: spacing(1), paddingVertical: spacing(1) },
  category: {
    paddingHorizontal: spacing(1.75),
    paddingVertical: spacing(0.75),
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  categoryActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  categoryText: { ...typography.caption, fontSize: 13, color: colors.ink },
  categoryTextActive: { color: colors.background },
});
