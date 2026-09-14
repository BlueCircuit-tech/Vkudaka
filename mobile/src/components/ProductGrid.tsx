import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, formatBRL, radius, spacing, typography, fonts } from '../theme/theme';
import { EmptyState } from './ui';

export interface ProductSummary {
  id: string;
  name: string;
  salePriceCents: number | null;
  rentalPriceCents: number | null;
  availability: 'SALE' | 'RENTAL' | 'BOTH';
  isHighlighted: boolean;
  images: Array<{ url: string; isCover: boolean }>;
}

/** RN-12 — peça do trimestre, como o servidor informa. */
export interface QuarterlyRental {
  eligible: boolean;
  available: boolean;
  period: string;
  periodLabel: string;
  nextPeriodStart: string;
  usedByOrderCode: string | null;
}

export function ProductGrid({
  products,
  mode,
  onPress,
  ListHeaderComponent,
  ListFooterComponent,
}: {
  products: ProductSummary[];
  mode: 'SALE' | 'RENTAL';
  onPress: (product: ProductSummary) => void;
  ListHeaderComponent?: React.ReactElement;
  ListFooterComponent?: React.ReactElement;
}) {
  return (
    <FlatList
      data={products}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.list}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
      ListEmptyComponent={<EmptyState title="Nada por aqui ainda" description="Novidades em breve." />}
      renderItem={({ item }) => {
        const priceCents = mode === 'RENTAL' ? item.rentalPriceCents : item.salePriceCents;
        const cover = item.images.find((image) => image.isCover) ?? item.images[0];

        return (
          <Pressable
            onPress={() => onPress(item)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
          >
            {cover ? (
              <Image source={{ uri: cover.url }} style={styles.image} resizeMode="cover" />
            ) : (
              <View style={[styles.image, styles.imageFallback]} />
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              {priceCents !== null ? (
                <Text style={styles.price}>
                  {formatBRL(priceCents)}
                  {mode === 'RENTAL' ? <Text style={typography.caption}> / aluguel</Text> : null}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing(2), paddingBottom: spacing(6), gap: spacing(2) },
  row: { gap: spacing(2) },
  card: { flex: 1, marginBottom: spacing(2) },
  image: {
    width: '100%',
    aspectRatio: 0.72,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  imageFallback: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  info: { paddingTop: spacing(1), gap: 2 },
  name: { ...typography.body, fontSize: 14 },
  price: { color: colors.goldDeep, fontSize: 14.5, fontFamily: fonts.display },
});
