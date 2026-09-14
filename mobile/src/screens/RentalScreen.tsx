import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Caption, Loading, Screen } from '../components/ui';
import { ProductGrid, type ProductSummary, type QuarterlyRental } from '../components/ProductGrid';

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

  const nextStart = quarterly ? new Date(quarterly.nextPeriodStart) : null;

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
              Peças selecionadas pela VKUDAKA para uso por período, com valor de locação e
              devolução combinada.
            </Caption>

            {/* RN-12 — peça do trimestre: 1 por trimestre sem custo de locação, frete por conta da cliente. */}
            {quarterly?.eligible ? (
              <View style={[styles.quarter, quarterly.available && styles.quarterOn]}>
                <Text style={styles.quarterTitle}>
                  {quarterly.available
                    ? 'Sua peça do trimestre está disponível'
                    : 'Peça do trimestre já usada'}
                </Text>
                <Body>
                  {quarterly.available
                    ? `Escolha uma peça e alugue sem custo de locação — você paga só o frete. Vale até ${
                        nextStart ? nextStart.toLocaleDateString('pt-BR') : 'o fim do trimestre'
                      }.`
                    : `Usada no pedido ${quarterly.usedByOrderCode}. A próxima libera em ${
                        nextStart ? nextStart.toLocaleDateString('pt-BR') : 'breve'
                      }. Até lá, o aluguel sai pelo valor normal.`}
                </Body>
              </View>
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(0.5), paddingBottom: spacing(2) },
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
