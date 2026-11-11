import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { api, uploadMedia } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Card, Divider, Label, Loading, Screen } from '../components/ui';

/**
 * Perfil (2.1) — dados pessoais, foto e as medidas das peças.
 *
 * A foto é opcional: sem ela o app mostra o avatar de iniciais devolvido pelo
 * servidor. As medidas alimentam a indicação de tamanho na vitrine e o trabalho
 * de ajuste do ateliê, por isso ficam completas aqui e não só o manequim.
 */

interface Measurements {
  dressSize: string | null;
  topSize: string | null;
  bottomSize: string | null;
  shoeSize: string | null;
  bustCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  favoriteColors: string[];
  notes: string | null;
}

interface Profile {
  fullName: string;
  email: string;
  cpf: string;
  phone: string;
  birthDate: string | null;
  instagram: string | null;
  gender: string | null;
  avatarUrl: string | null;
  avatarFallback: string | null;
  isSubscriber: boolean;
  subscription: { planName: string; rebatePercent: number; currentPeriodEnd: string } | null;
  measurements: Measurements | null;
  addresses: Array<{
    id: string;
    street: string;
    number: string;
    district: string;
    city: string;
    state: string;
    zipCode: string;
    isDefault: boolean;
  }>;
}

const GENDERS = [
  { value: 'FEMININO', label: 'Feminino' },
  { value: 'MASCULINO', label: 'Masculino' },
  { value: 'PREFIRO_NAO_INFORMAR', label: 'Prefiro não informar' },
] as const;

/** Campos de medida: chave no banco, rótulo e se é número. */
const SIZE_FIELDS = [
  { key: 'dressSize', label: 'Manequim' },
  { key: 'topSize', label: 'Blusa' },
  { key: 'bottomSize', label: 'Calça' },
  { key: 'shoeSize', label: 'Calçado' },
] as const;

const BODY_FIELDS = [
  { key: 'bustCm', label: 'Busto (cm)' },
  { key: 'waistCm', label: 'Cintura (cm)' },
  { key: 'hipsCm', label: 'Quadril (cm)' },
  { key: 'heightCm', label: 'Altura (cm)' },
] as const;

type Draft = Record<string, string>;

export function ProfileScreen() {
  const navigation = useNavigation();
  const { signOut, forgetSession, refresh } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [colorsDraft, setColorsDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const me = await api.get<Profile>('/users/me');
    setProfile(me);

    const m = me.measurements;
    setDraft({
      dressSize: m?.dressSize ?? '',
      topSize: m?.topSize ?? '',
      bottomSize: m?.bottomSize ?? '',
      shoeSize: m?.shoeSize ?? '',
      bustCm: m?.bustCm ? String(m.bustCm) : '',
      waistCm: m?.waistCm ? String(m.waistCm) : '',
      hipsCm: m?.hipsCm ? String(m.hipsCm) : '',
      heightCm: m?.heightCm ? String(m.heightCm) : '',
      notes: m?.notes ?? '',
    });
    setColorsDraft((m?.favoriteColors ?? []).join(', '));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ── Foto de perfil ─────────────────────────────────────────────────────────

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;

    setUploading(true);
    try {
      const { url } = await uploadMedia(asset.uri, 'image/jpeg');
      await api.patch('/users/me', { avatarUrl: url });
      await load();
      await refresh();
    } catch (error) {
      Alert.alert('Não foi possível enviar a foto', (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    await api.patch('/users/me', { avatarUrl: null });
    await load();
    await refresh();
  };

  // ── Medidas ────────────────────────────────────────────────────────────────

  const number = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return digits ? Number(digits) : undefined;
  };

  const saveMeasurements = async () => {
    setSaving(true);
    try {
      await api.put('/users/me/measurements', {
        dressSize: draft.dressSize || undefined,
        topSize: draft.topSize || undefined,
        bottomSize: draft.bottomSize || undefined,
        shoeSize: draft.shoeSize || undefined,
        bustCm: number(draft.bustCm ?? ''),
        waistCm: number(draft.waistCm ?? ''),
        hipsCm: number(draft.hipsCm ?? ''),
        heightCm: number(draft.heightCm ?? ''),
        favoriteColors: colorsDraft
          .split(',')
          .map((color) => color.trim())
          .filter(Boolean)
          .slice(0, 10),
        notes: draft.notes || undefined,
      });
      await load();
      Alert.alert('Pronto', 'Suas medidas foram salvas.');
    } catch (error) {
      Alert.alert('Não foi possível salvar', (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setGender = async (gender: string) => {
    await api.patch('/users/me', { gender });
    await load();
  };

  if (!profile) return <Loading />;

  const address = profile.addresses.find((a) => a.isDefault) ?? profile.addresses[0];

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Identidade ── */}
        <View style={styles.header}>
          <Pressable onPress={() => void pickPhoto()} disabled={uploading}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                {uploading ? (
                  <ActivityIndicator color={colors.goldDeep} />
                ) : (
                  <Text style={styles.avatarText}>
                    {profile.avatarFallback?.replace('initials:', '') ?? ''}
                  </Text>
                )}
              </View>
            )}
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={typography.title}>{profile.fullName}</Text>
            <Caption>{profile.email}</Caption>
            <Caption>{profile.phone}</Caption>
            <View style={styles.photoActions}>
              <Pressable onPress={() => void pickPhoto()} disabled={uploading}>
                <Text style={styles.photoLink}>
                  {uploading ? 'Enviando…' : profile.avatarUrl ? 'Trocar foto' : 'Adicionar foto'}
                </Text>
              </Pressable>
              {profile.avatarUrl ? (
                <Pressable onPress={() => void removePhoto()}>
                  <Text style={styles.photoLinkMuted}>Remover</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Plano ── */}
        <Card style={styles.planCard}>
          <Label>Meu plano</Label>
          {profile.subscription ? (
            <>
              <Text style={typography.title}>{profile.subscription.planName}</Text>
              <Body>
                {profile.subscription.rebatePercent}% de desconto fidelidade em toda compra. 100% da
                mensalidade vira crédito VKUDAKA na sua carteira.
              </Body>
              <Caption>
                Renova em{' '}
                {new Date(profile.subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}
              </Caption>
            </>
          ) : (
            <Body muted>Você ainda não tem assinatura ativa.</Body>
          )}
          <Button
            title={profile.subscription ? 'Planos e benefícios' : 'Conheça os planos'}
            variant="quiet"
            onPress={() =>
              (navigation as never as { navigate: (s: string) => void }).navigate('Plans')
            }
          />
        </Card>

        {/* ── Dados pessoais ── */}
        <View style={styles.block}>
          <Label>Meus dados</Label>
          <Card style={styles.dataCard}>
            <Field label="CPF" value={profile.cpf} />
            <Field
              label="Data de nascimento"
              value={
                profile.birthDate
                  ? new Date(profile.birthDate).toLocaleDateString('pt-BR')
                  : 'não informada'
              }
            />
            <Field label="Instagram" value={profile.instagram ? `@${profile.instagram}` : 'não informado'} />
            <Field
              label="Endereço"
              value={
                address
                  ? `${address.street}, ${address.number} — ${address.district}, ${address.city}/${address.state}`
                  : 'não informado'
              }
              last
            />
          </Card>
        </View>

        <View style={styles.block}>
          <Label>Gênero</Label>
          <View style={styles.chips}>
            {GENDERS.map((option) => {
              const selected = profile.gender === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => void setGender(option.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && { color: colors.ink }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Medidas ── */}
        <View style={styles.block}>
          <Label>Tamanhos e medidas</Label>
          <Caption>
            Usamos suas medidas para indicar o tamanho na vitrine e para o ajuste da equipe.
          </Caption>

          <View style={styles.grid}>
            {SIZE_FIELDS.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                value={draft[field.key] ?? ''}
                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
          </View>

          <View style={styles.grid}>
            {BODY_FIELDS.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                value={draft[field.key] ?? ''}
                keyboard="number-pad"
                onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
          </View>

          <Input
            label="Cores preferidas (separadas por vírgula)"
            value={colorsDraft}
            onChange={setColorsDraft}
            full
          />
          <Input
            label="Observações para o ateliê"
            value={draft.notes ?? ''}
            onChange={(value) => setDraft((current) => ({ ...current, notes: value }))}
            full
            multiline
          />

          <Button
            title="Salvar tamanhos e medidas"
            variant="ghost"
            onPress={() => void saveMeasurements()}
            loading={saving}
          />
        </View>

        <Divider />
        <BlockedMembers />

        <Divider />
        <Button title="Sair da conta" variant="quiet" onPress={() => void signOut()} />
        <DeleteAccount onDeleted={forgetSession} />
      </ScrollView>
    </Screen>
  );
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.dataRow, last && { borderBottomWidth: 0 }]}>
      <Caption>{label}</Caption>
      <Body>{value}</Body>
    </View>
  );
}

function Input({
  label,
  value,
  onChange,
  keyboard,
  full,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  keyboard?: 'default' | 'number-pad';
  full?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={full ? styles.fieldFull : styles.field}>
      <Caption>{label}</Caption>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard ?? 'default'}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputTall]}
        placeholderTextColor={colors.mutedSoft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2.5), paddingBottom: spacing(6) },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  avatarFallback: {
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.goldDeep, fontSize: 22 },
  photoActions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(0.75) },
  photoLink: { ...typography.caption, color: colors.goldDeep, textDecorationLine: 'underline' },
  photoLinkMuted: { ...typography.caption, color: colors.mutedSoft },

  planCard: { gap: spacing(0.5), borderColor: colors.gold },

  block: { gap: spacing(1) },
  dataCard: { paddingVertical: spacing(0.5) },
  dataRow: {
    paddingVertical: spacing(1.25),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 2,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  chip: {
    paddingVertical: spacing(0.75),
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { ...typography.caption, color: colors.ink },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1) },
  field: { flexBasis: '48%', gap: 4 },
  fieldFull: { width: '100%', gap: 4 },
  input: {
    height: 46,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: spacing(1.5),
  },
  inputTall: { height: 84, paddingTop: spacing(1), textAlignVertical: 'top' },
});

/**
 * Membros bloqueados na comunidade. Bloquear acontece no feed; desfazer é aqui,
 * para que o bloqueio nunca seja uma porta sem volta.
 */
function BlockedMembers() {
  const [blocked, setBlocked] = useState<Array<{ user: { id: string; fullName: string } }> | null>(null);

  const load = useCallback(async () => {
    try {
      setBlocked(await api.get<Array<{ user: { id: string; fullName: string } }>>('/community/blocks'));
    } catch {
      setBlocked([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = (id: string, name: string) => {
    Alert.alert(`Desbloquear ${name}?`, 'Vocês voltam a ver as publicações um do outro.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desbloquear',
        onPress: async () => {
          await api.delete(`/community/users/${id}/block`);
          await load();
        },
      },
    ]);
  };

  return (
    <View style={{ gap: spacing(1) }}>
      <Label>Membros bloqueados</Label>
      {!blocked || blocked.length === 0 ? (
        <Caption>Ninguém bloqueado. Para bloquear alguém, use o menu ⋯ de uma publicação na Comunidade.</Caption>
      ) : (
        blocked.map((item) => (
          <Card key={item.user.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body>{item.user.fullName}</Body>
            <Button title="Desbloquear" variant="quiet" onPress={() => unblock(item.user.id, item.user.fullName)} />
          </Card>
        ))
      )}
    </View>
  );
}

/**
 * Exclusão da conta pelo próprio membro (exigência do Google Play e da LGPD).
 * Pede a senha para confirmar; o servidor anonimiza na hora e derruba a sessão.
 */
function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!password) return;
    setBusy(true);
    try {
      await api.post('/users/me/delete', { password });
      setOpen(false);
      await onDeleted();
      Alert.alert('Conta excluída', 'Seus dados pessoais foram removidos. Sentiremos sua falta.');
    } catch (error) {
      Alert.alert('Não foi possível excluir', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={{ alignSelf: 'center', paddingVertical: spacing(1) }}>
        <Text style={{ ...typography.caption, color: colors.mutedSoft, textDecorationLine: 'underline' }}>
          Excluir minha conta
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={deleteStyles.backdrop}>
          <Card style={deleteStyles.box}>
            <Text style={typography.title}>Excluir conta</Text>
            <Body>
              Seus dados pessoais (nome, e-mail, CPF, telefone, endereços, medidas, foto) são removidos
              na hora, a assinatura é cancelada e suas publicações saem da comunidade. Registros de
              pedidos e pagamentos ficam guardados pelo prazo legal, sem seus dados de contato.
            </Body>
            <Body>Esta ação não pode ser desfeita. Digite sua senha para confirmar.</Body>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Senha"
              placeholderTextColor={colors.mutedSoft}
              secureTextEntry
              style={deleteStyles.input}
            />
            <Button title="Excluir definitivamente" onPress={() => void confirm()} disabled={!password} loading={busy} />
            <Button title="Cancelar" variant="quiet" onPress={() => setOpen(false)} />
          </Card>
        </View>
      </Modal>
    </>
  );
}

const deleteStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20, 18, 16, 0.4)', justifyContent: 'center', padding: spacing(2.5) },
  box: { gap: spacing(1.5) },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    padding: spacing(1.5),
  },
});
