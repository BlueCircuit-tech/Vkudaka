import React from 'react';
import { ImageBackground, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '../theme/theme';

/**
 * Modal das 2 fotos de categoria que abre ao tocar em Loja (2026-11-12).
 *
 * Fotos, textos e categorias vêm do CRM ("Mudar Categoria APP"). Tocar numa
 * foto filtra a vitrine por aquela categoria; "Ver toda a loja" fecha sem filtro.
 */

export interface PickerCategory {
  id: string;
  label: string;
  scope: 'SALE' | 'RENTAL' | 'BOTH';
  imageUrl: string;
}

export function CategoryPickerModal({
  visible,
  categories,
  onPick,
  onClose,
}: {
  visible: boolean;
  categories: PickerCategory[];
  onPick: (category: PickerCategory) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          { paddingTop: insets.top + spacing(2), paddingBottom: insets.bottom + spacing(2) },
        ]}
      >
        <View style={styles.header}>
          {/* Caixa alta: a fonte de títulos não tem minúsculas acentuadas. */}
          <Text style={styles.title}>O QUE VOCÊ PROCURA HOJE?</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {categories.map((category) => (
          <Pressable
            key={category.id}
            onPress={() => onPick(category)}
            style={({ pressed }) => [styles.cardWrap, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`Ver ${category.label}`}
          >
            <ImageBackground
              source={{ uri: category.imageUrl }}
              style={styles.card}
              imageStyle={styles.cardImage}
              resizeMode="cover"
            >
              <View style={styles.shade} />
              <Text style={styles.label}>{category.label}</Text>
              <Text style={styles.cta}>Ver peças ›</Text>
            </ImageBackground>
          </Pressable>
        ))}

        <Pressable onPress={onClose} style={styles.all} accessibilityRole="button">
          <Text style={styles.allText}>Ver toda a loja</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,18,26,0.94)',
    paddingHorizontal: spacing(2.5),
    gap: spacing(2),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.cream, letterSpacing: 1 },
  close: { color: colors.cream, fontSize: 20, padding: spacing(0.5) },
  cardWrap: { flex: 1 },
  card: { flex: 1, justifyContent: 'flex-end', padding: spacing(2.5) },
  cardImage: { borderRadius: radius.lg },
  shade: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  label: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#fff',
  },
  cta: { fontFamily: fonts.body, fontSize: 14, color: colors.gold, marginTop: 4 },
  all: { alignItems: 'center', paddingVertical: spacing(1) },
  allText: { fontFamily: fonts.body, fontSize: 15, color: colors.cream, textDecorationLine: 'underline' },
});
