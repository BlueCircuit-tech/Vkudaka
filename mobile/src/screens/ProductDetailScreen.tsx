import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { api } from '../api/client';
import { colors, formatBRL, radius, spacing, typography, fonts } from '../theme/theme';
import { Body, Button, Caption, Label, Loading, Screen } from '../components/ui';
import { PurchaseRulesModal } from '../components/PurchaseRulesModal';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Detalhe da peça (2.3).
 *
 * Dois pontos de regra de negócio nesta tela:
 *  • O benefício exibido no botão vem de `rebatePreview`, calculado no servidor
 *    com o percentual do plano cadastrado no CRM — nada é calculado aqui.
 *  • "Comprar" abre o popup de regras antes de seguir para o checkout.
 */

interface Variant {
  id: string;
  size: string;
  color: string;
  stock: number;
  rentalStock: number;
}

interface ProductDetail {
  id: string;
  name: string;
  description: string | null;
  composition: string | null;
  salePriceCents: number | null;
  rentalPriceCents: number | null;
  rentalDays: number;
  images: Array<{ url: string; isCover: boolean }>;
  variants: Variant[];
  rebatePreview: {
    percent: number;
    mode: 'CREDIT_NEXT_INVOICE' | 'IMMEDIATE_DISCOUNT';
    sale: { priceCents: number; rebateCreditCents: number; message: string } | null;
    rental: { priceCents: number; rebateCreditCents: number; message: string } | null;
  };
  /** RN-12 — só vem em peça de aluguel. */
  quarterlyRental: {
    eligible: boolean;
    available: boolean;
    nextPeriodStart: string;
    usedByOrderCode: string | null;
  } | null;
}

export function ProductDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ProductDetail'>>();
  const navigation = useNavigation<never>();
  const { productId, mode } = route.params;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [rulesVisible, setRulesVisible] = useState(false);

  useEffect(() => {
    void api.get<ProductDetail>(`/catalog/products/${productId}`).then(setProduct);
  }, [productId]);

  const priceCents = mode === 'RENTAL' ? product?.rentalPriceCents : product?.salePriceCents;
  const preview = mode === 'RENTAL' ? product?.rebatePreview.rental : product?.rebatePreview.sale;

  const availableVariants = useMemo(
    () =>
      (product?.variants ?? []).filter((variant) =>
        mode === 'RENTAL' ? variant.rentalStock > 0 : variant.stock > 0,
      ),
    [product, mode],
  );

  if (!product) return <Loading />;

  const cover = product.images.find((image) => image.isCover) ?? product.images[0];

  const goToCheckout = () => {
    setRulesVisible(false);
    if (!selectedVariant) return;
    (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate('Checkout', {
      variantId: selectedVariant,
      productId: product.id,
      mode,
    });
  };

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {cover ? <Image source={{ uri: cover.url }} style={styles.hero} resizeMode="cover" /> : null}

        <View style={styles.block}>
          <Label>{mode === 'RENTAL' ? 'Aluguel' : 'Compra'}</Label>
          <Text style={typography.display}>{product.name}</Text>
          {mode === 'RENTAL' && product.quarterlyRental?.available && priceCents != null ? (
            <>
              <Text style={styles.price}>
                Sem custo <Text style={styles.priceStruck}>{formatBRL(priceCents)}</Text>
              </Text>
              <Caption>Sua peça do trimestre — você paga só o frete.</Caption>
            </>
          ) : priceCents != null ? (
            <Text style={styles.price}>{formatBRL(priceCents)}</Text>
          ) : null}
          {mode === 'RENTAL' ? <Caption>Período de {product.rentalDays} dias.</Caption> : null}
        </View>

        {/* Benefício do plano, vindo do CRM */}
        {preview && preview.rebateCreditCents > 0 ? (
          <View style={styles.rebate}>
            <Text style={styles.rebateValue}>+{formatBRL(preview.rebateCreditCents)}</Text>
            <Caption>{preview.message}</Caption>
          </View>
        ) : null}

        {product.description ? (
          <View style={styles.block}>
            <Body>{product.description}</Body>
            {product.composition ? <Caption>{product.composition}</Caption> : null}
          </View>
        ) : null}

        <View style={styles.block}>
          <Label>Tamanho</Label>
          <View style={styles.sizes}>
            {availableVariants.map((variant) => {
              const selected = variant.id === selectedVariant;
              return (
                <Pressable
                  key={variant.id}
                  onPress={() => setSelectedVariant(variant.id)}
                  style={[styles.size, selected && styles.sizeSelected]}
                >
                  <Text style={[styles.sizeText, selected && { color: colors.ink }]}>
                    {variant.size}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {availableVariants.length === 0 ? <Caption>Sem estoque no momento.</Caption> : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={mode === 'RENTAL' ? 'Alugar' : 'Comprar'}
          onPress={() => setRulesVisible(true)}
          disabled={!selectedVariant}
        />
        {!selectedVariant ? <Caption>Escolha um tamanho para continuar.</Caption> : null}
      </View>

      <PurchaseRulesModal
        visible={rulesVisible}
        contentKey={mode === 'RENTAL' ? 'rental_rules' : 'purchase_rules'}
        onAccept={goToCheckout}
        onClose={() => setRulesVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  priceStruck: { ...typography.caption, textDecorationLine: 'line-through', color: colors.muted },
  content: { paddingBottom: spacing(4) },
  hero: { width: '100%', aspectRatio: 0.85, backgroundColor: colors.surfaceAlt },
  block: { paddingHorizontal: spacing(2.5), paddingTop: spacing(2), gap: spacing(0.5) },
  price: { fontFamily: fonts.display, fontSize: 26, color: colors.goldDeep },
  rebate: {
    margin: spacing(2.5),
    padding: spacing(2),
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
    gap: 2,
  },
  rebateValue: { fontFamily: fonts.display, fontSize: 20, color: colors.goldDeep },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1), paddingTop: spacing(0.5) },
  size: {
    minWidth: 52,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sizeSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  sizeText: { ...typography.body, fontSize: 14 },
  footer: {
    padding: spacing(2.5),
    gap: spacing(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
