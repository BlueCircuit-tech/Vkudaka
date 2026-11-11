import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { spacing, typography } from '../theme/theme';
import { Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary, type QuarterlyRental } from '../components/ProductGrid';
import { QuarterlyNotice } from '../components/QuarterlyNotice';

/**
 * Aluguel (2.3) — seção própria, em segundo plano. Só se chega aqui pela
 * linha de rodapé da loja: a direção quer o aluguel discreto, o foco é a venda.
 *
 * A venda é o foco do app, e "Escolha seu Look" passou a ser a vitrine de
 * compra. O aluguel continua existindo e precisa de porta própria: são as peças
 * que a casa libera para locação por período — seleção da direção, definida no
 * CRM peça a peça, e não o catálogo inteiro.
 */
export function RentalScreen() {
  const navigation = useNavigation<never>();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [quarterly, setQuarterly] = useState<QuarterlyRental | null>(null);

  useEffect(() => {
    void api
      .get<{ data: ProductSummary[]; quarterlyRental: QuarterlyRental }>('/catalog/rental')
      .then((page) => {
        setProducts(page.data);
        setQuarterly(page.quarterlyRental);
      });
  }, []);

  if (!products) return <Loading />;

  return (
    <Screen scroll={false}>
      <ProductGrid
        products={products}
        mode="RENTAL"
        onPress={(product) =>
          (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate(
            'ProductDetail',
            { productId: product.id, mode: 'RENTAL' },
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={typography.label}>Acervo da casa</Text>
            <Text style={typography.display}>Aluguel</Text>
            <Caption>
              Peças selecionadas pela VKUDAKA para uso por período, com valor de locação e devolução
              combinada.
            </Caption>

            <QuarterlyNotice quarterly={quarterly} />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(0.5), paddingBottom: spacing(2) },
});
