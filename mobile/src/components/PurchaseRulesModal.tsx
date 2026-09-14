import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Button, Loading } from './ui';

/**
 * Popup de regras de compra (2.3).
 *
 * O texto NÃO vive no app: vem de `GET /content/purchase_rules`, editável pela
 * diretoria no CRM. Assim a atualização das regras não depende de nova
 * submissão às lojas.
 */

interface Content {
  key: string;
  title: string | null;
  body: string;
  version: number;
}

export function PurchaseRulesModal({
  visible,
  onAccept,
  onClose,
  contentKey = 'purchase_rules',
  readOnly = false,
}: {
  visible: boolean;
  onAccept: () => void;
  onClose: () => void;
  contentKey?: 'purchase_rules' | 'rental_rules' | 'rebate_rules';
  /** Texto informativo: um único botão "Entendi", sem aceite. */
  readOnly?: boolean;
}) {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    api
      .get<Content>(`/content/${contentKey}`)
      .then(setContent)
      .catch(() => setError('Não foi possível carregar as regras agora.'));
  }, [visible, contentKey]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={typography.title}>{content?.title ?? 'Regras de compra'}</Text>

          {error ? (
            <Text style={[typography.body, { color: colors.danger }]}>{error}</Text>
          ) : content ? (
            <ScrollView style={styles.body}>
              <Text style={typography.body}>{content.body}</Text>
            </ScrollView>
          ) : (
            <Loading />
          )}

          <View style={styles.actions}>
            {readOnly ? (
              <Button title="Entendi" onPress={onClose} />
            ) : (
              <>
                <Button
                  title="Li e concordo · continuar"
                  onPress={onAccept}
                  disabled={!content}
                />
                <Pressable onPress={onClose} style={styles.cancel}>
                  <Text style={typography.caption}>Voltar</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(3),
    maxHeight: '82%',
    gap: spacing(2),
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  body: { maxHeight: 340 },
  actions: { gap: spacing(1) },
  cancel: { alignItems: 'center', paddingVertical: spacing(1) },
});
