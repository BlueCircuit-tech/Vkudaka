import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api/client';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Button, Caption } from './ui';

/**
 * Folha de denúncia (exigência das lojas para conteúdo de usuários).
 *
 * O membro escolhe o motivo, pode detalhar, e a denúncia cai na fila do CRM.
 * Nada some na hora: é a moderação da casa quem decide.
 */

export type ReportTarget =
  | { kind: 'post'; id: string }
  | { kind: 'comment'; id: string }
  | { kind: 'user'; id: string };

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'SPAM', label: 'Spam ou propaganda' },
  { value: 'HARASSMENT', label: 'Assédio ou ofensa' },
  { value: 'NUDITY', label: 'Nudez ou conteúdo sexual' },
  { value: 'VIOLENCE', label: 'Violência' },
  { value: 'HATE', label: 'Discurso de ódio' },
  { value: 'SCAM', label: 'Golpe ou venda enganosa' },
  { value: 'OTHER', label: 'Outro motivo' },
];

const PATH: Record<ReportTarget['kind'], string> = {
  post: '/community/posts',
  comment: '/community/comments',
  user: '/community/users',
};

export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const close = () => {
    setReason(null);
    setDetails('');
    onClose();
  };

  const send = async () => {
    if (!target || !reason) return;
    setSending(true);
    try {
      await api.post(`${PATH[target.kind]}/${target.id}/report`, { reason, details: details.trim() || undefined });
      close();
      Alert.alert('Denúncia enviada', 'Obrigado. A equipe VKUDAKA vai analisar em breve.');
    } catch (error) {
      Alert.alert('Não foi possível denunciar', (error as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.sheet}>
        <Text style={typography.title}>Denunciar</Text>
        <Caption>Por que este conteúdo não deveria estar no clube?</Caption>

        {REASONS.map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setReason(item.value)}
            style={[styles.option, reason === item.value && styles.optionActive]}
          >
            <Text style={[styles.optionText, reason === item.value && { color: colors.goldDeep }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}

        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Quer contar mais? (opcional)"
          placeholderTextColor={colors.mutedSoft}
          style={styles.input}
          maxLength={500}
          multiline
        />

        <Button title="Enviar denúncia" onPress={() => void send()} disabled={!reason} loading={sending} />
        <Button title="Cancelar" variant="quiet" onPress={close} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 18, 16, 0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1),
  },
  option: {
    paddingVertical: spacing(1.25),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionActive: { borderColor: colors.gold, backgroundColor: colors.surfaceAlt },
  optionText: { ...typography.body, color: colors.ink },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    padding: spacing(1.5),
    minHeight: 56,
  },
});
