import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { SubscriptionLocked, isSubscriptionRequired } from '../components/SubscriptionLocked';
import { spacing, typography } from '../theme/theme';
import { Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary } from '../components/ProductGrid';

/**
 * "Escolha seu Look" (2.3) — lookbook de COMPRA.
 *
 * Título e submenu conforme a nomenclatura aprovada. O menu equivalente no
 * protótipo antigo chamava-se "Aluguel de looks" e mostrava peças de locação;
 * a direção renomeou e definiu que aqui entram somente looks à venda.
 */
export function LooksScreen() {
  const navigation = useNavigation<never>();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    void api
      .get<{ data: ProductSummary[] }>('/catalog/looks')
      .then((page) => setProducts(page.data))
      .catch((error) => setLocked(isSubscriptionRequired(error)));
  }, []);

  if (locked) return <SubscriptionLocked area="o Escolha seu Look" />;
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
            <Text style={typography.display}>Escolha seu Look</Text>
            <Text style={typography.label}>Ative sua melhor versão</Text>
            <Caption>Os looks da casa disponíveis para compra.</Caption>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(0.5), paddingBottom: spacing(2) },
});
