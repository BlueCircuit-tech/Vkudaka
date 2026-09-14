import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Button, Caption, Label, Screen } from '../components/ui';

/**
 * Cadastro completo (2.1).
 * Campos com * são obrigatórios: nome, CPF, e-mail, celular e endereço.
 * A validação real (CPF, CEP, duplicidade) é do servidor; aqui só o essencial
 * para não gastar requisição à toa.
 */

const GENDERS = [
  { value: 'FEMININO', label: 'Feminino' },
  { value: 'MASCULINO', label: 'Masculino' },
  { value: 'NAO_BINARIO', label: 'Não binário' },
  { value: 'OUTRO', label: 'Outro' },
  { value: 'PREFIRO_NAO_INFORMAR', label: 'Prefiro não informar' },
] as const;

export function SignUpScreen() {
  const { signUp } = useAuth();

  const [form, setForm] = useState({
    fullName: '',
    cpf: '',
    email: '',
    phone: '',
    password: '',
    birthDate: '',
    instagram: '',
    gender: '' as '' | (typeof GENDERS)[number]['value'],
    zipCode: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setError(null);

    const required = [form.fullName, form.cpf, form.email, form.phone, form.zipCode, form.street, form.district, form.city, form.state];
    if (required.some((value) => !value.trim())) {
      setError('Preencha todos os campos obrigatórios (*).');
      return;
    }
    if (!acceptedTerms) {
      setError('É preciso aceitar os termos para continuar.');
      return;
    }

    setLoading(true);
    try {
      await signUp({
        fullName: form.fullName.trim(),
        cpf: form.cpf,
        email: form.email.trim(),
        phone: form.phone,
        password: form.password,
        birthDate: form.birthDate || undefined,
        instagram: form.instagram || undefined,
        gender: form.gender || undefined,
        acceptedTerms: true,
        address: {
          zipCode: form.zipCode,
          street: form.street,
          number: form.number,
          complement: form.complement || undefined,
          district: form.district,
          city: form.city,
          state: form.state.toUpperCase(),
        },
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.display}>Criar cadastro</Text>
        <Caption>Campos com * são obrigatórios.</Caption>

        <Label>Dados pessoais</Label>
        <Field placeholder="Nome completo *" value={form.fullName} onChange={set('fullName')} />
        <Field placeholder="CPF *" value={form.cpf} onChange={set('cpf')} keyboardType="number-pad" />
        <Field placeholder="E-mail *" value={form.email} onChange={set('email')} keyboardType="email-address" />
        <Field placeholder="Celular *" value={form.phone} onChange={set('phone')} keyboardType="phone-pad" />
        <Field placeholder="Senha *" value={form.password} onChange={set('password')} secure />
        <Field placeholder="Data de nascimento (AAAA-MM-DD)" value={form.birthDate} onChange={set('birthDate')} />
        <Field placeholder="Instagram" value={form.instagram} onChange={set('instagram')} />

        <Label>Gênero</Label>
        <View style={styles.chips}>
          {GENDERS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setForm((current) => ({ ...current, gender: option.value }))}
              style={[styles.chip, form.gender === option.value && styles.chipSelected]}
            >
              <Text style={[styles.chipText, form.gender === option.value && { color: colors.ink }]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Label>Endereço *</Label>
        <Field placeholder="CEP *" value={form.zipCode} onChange={set('zipCode')} keyboardType="number-pad" />
        <Field placeholder="Rua *" value={form.street} onChange={set('street')} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field placeholder="Número" value={form.number} onChange={set('number')} />
          </View>
          <View style={{ flex: 2 }}>
            <Field placeholder="Complemento" value={form.complement} onChange={set('complement')} />
          </View>
        </View>
        <Field placeholder="Bairro *" value={form.district} onChange={set('district')} />
        <View style={styles.row}>
          <View style={{ flex: 3 }}>
            <Field placeholder="Cidade *" value={form.city} onChange={set('city')} />
          </View>
          <View style={{ flex: 1 }}>
            <Field placeholder="UF *" value={form.state} onChange={set('state')} />
          </View>
        </View>

        <View style={styles.terms}>
          <Switch
            value={acceptedTerms}
            onValueChange={setAcceptedTerms}
            trackColor={{ true: colors.gold, false: colors.border }}
            thumbColor={colors.ink}
          />
          <Caption>Li e aceito os termos de uso e a política de privacidade.</Caption>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Criar cadastro" onPress={() => void submit()} loading={loading} />
        <Caption>
          O cadastro não ativa a assinatura. Depois de criar sua conta, você será levada ao site
          para assinar o clube.
        </Caption>
      </ScrollView>
    </Screen>
  );
}

function Field({
  placeholder,
  value,
  onChange,
  keyboardType,
  secure,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
  secure?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedSoft}
      keyboardType={keyboardType ?? 'default'}
      secureTextEntry={secure}
      autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(1.25), paddingBottom: spacing(6) },
  input: {
    height: 50,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: spacing(2),
  },
  row: { flexDirection: 'row', gap: spacing(1) },
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
  terms: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), paddingVertical: spacing(1) },
  error: { color: colors.danger, fontSize: 13 },
});
