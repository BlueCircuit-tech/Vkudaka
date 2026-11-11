import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  brDateToISO,
  isValidCPF,
  isValidEmail,
  maskCEP,
  maskCPF,
  maskDate,
  maskPhone,
  onlyDigits,
} from '../utils/forms';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Button, Caption, Label, Screen } from '../components/ui';

/**
 * Cadastro completo (2.1).
 * Campos com * são obrigatórios: nome, CPF, e-mail, celular, senha e endereço.
 * A validação real (CPF, CEP, duplicidade) é do servidor; aqui a mesma regra
 * roda antes para dizer QUAL campo está errado — antes a pessoa só via
 * "Dados inválidos." (a data era pedida como AAAA-MM-DD e ninguém digita assim).
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

  const set = (key: keyof typeof form, format?: (value: string) => string) => (value: string) =>
    setForm((current) => ({
      ...current,
      [key]: format ? format(value) : value,
    }));

  /** Primeiro problema encontrado, com o nome do campo; null se está tudo certo. */
  const findProblem = (): string | null => {
    if (form.fullName.trim().length < 3) return 'Informe seu nome completo.';
    if (!isValidCPF(form.cpf)) return 'CPF inválido. Confira os números.';
    if (!isValidEmail(form.email)) return 'E-mail inválido.';
    const phone = onlyDigits(form.phone).length;
    if (phone < 10 || phone > 11) return 'Celular inválido. Informe DDD + número.';
    if (form.password.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (form.birthDate && !brDateToISO(form.birthDate)) {
      return 'Data de nascimento inválida. Use o formato DD/MM/AAAA.';
    }
    if (onlyDigits(form.zipCode).length !== 8) return 'CEP inválido. Use os 8 números.';
    if (form.street.trim().length < 3) return 'Informe a rua.';
    if (form.district.trim().length < 2) return 'Informe o bairro.';
    if (form.city.trim().length < 2) return 'Informe a cidade.';
    if (!/^[A-Za-z]{2}$/.test(form.state.trim()))
      return 'UF inválida. Use a sigla com 2 letras (ex.: SP).';
    if (!acceptedTerms) return 'É preciso aceitar os termos para continuar.';
    return null;
  };

  const submit = async () => {
    const problem = findProblem();
    setError(problem);
    if (problem) return;

    setLoading(true);
    try {
      await signUp({
        fullName: form.fullName.trim(),
        cpf: form.cpf,
        email: form.email.trim().toLowerCase(),
        phone: onlyDigits(form.phone),
        password: form.password,
        birthDate: form.birthDate ? brDateToISO(form.birthDate) : undefined,
        instagram: form.instagram.trim() || undefined,
        gender: form.gender || undefined,
        acceptedTerms: true,
        address: {
          zipCode: onlyDigits(form.zipCode),
          street: form.street.trim(),
          number: form.number.trim(),
          complement: form.complement.trim() || undefined,
          district: form.district.trim(),
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={typography.display}>Criar cadastro</Text>
          <Caption>Campos com * são obrigatórios.</Caption>

          <Label>Dados pessoais</Label>
          <Field placeholder="Nome completo *" value={form.fullName} onChange={set('fullName')} />
          <Field
            placeholder="CPF *"
            value={form.cpf}
            onChange={set('cpf', maskCPF)}
            keyboardType="number-pad"
          />
          <Field
            placeholder="E-mail *"
            value={form.email}
            onChange={set('email')}
            keyboardType="email-address"
          />
          <Field
            placeholder="Celular com DDD *"
            value={form.phone}
            onChange={set('phone', maskPhone)}
            keyboardType="phone-pad"
          />
          <Field
            placeholder="Senha (mínimo 8 caracteres) *"
            value={form.password}
            onChange={set('password')}
            secure
          />
          <Field
            placeholder="Data de nascimento (DD/MM/AAAA)"
            value={form.birthDate}
            onChange={set('birthDate', maskDate)}
            keyboardType="number-pad"
          />
          <Field
            placeholder="Instagram"
            value={form.instagram}
            onChange={set('instagram')}
            noCapitalize
          />

          <Label>Gênero</Label>
          <View style={styles.chips}>
            {GENDERS.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setForm((current) => ({ ...current, gender: option.value }))}
                style={[styles.chip, form.gender === option.value && styles.chipSelected]}
              >
                <Text
                  style={[styles.chipText, form.gender === option.value && { color: colors.ink }]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Label>Endereço *</Label>
          <Field
            placeholder="CEP *"
            value={form.zipCode}
            onChange={set('zipCode', maskCEP)}
            keyboardType="number-pad"
          />
          <Field placeholder="Rua *" value={form.street} onChange={set('street')} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field placeholder="Número" value={form.number} onChange={set('number')} />
            </View>
            <View style={{ flex: 2 }}>
              <Field
                placeholder="Complemento"
                value={form.complement}
                onChange={set('complement')}
              />
            </View>
          </View>
          <Field placeholder="Bairro *" value={form.district} onChange={set('district')} />
          <View style={styles.row}>
            <View style={{ flex: 3 }}>
              <Field placeholder="Cidade *" value={form.city} onChange={set('city')} />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                placeholder="UF *"
                value={form.state}
                onChange={set('state', (v) =>
                  v
                    .replace(/[^A-Za-z]/g, '')
                    .toUpperCase()
                    .slice(0, 2),
                )}
                upperCase
              />
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
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({
  placeholder,
  value,
  onChange,
  keyboardType,
  secure,
  noCapitalize,
  upperCase,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
  secure?: boolean;
  noCapitalize?: boolean;
  upperCase?: boolean;
}) {
  // E-mail e senha não podem ganhar maiúscula/correção automática do teclado.
  const raw = secure || noCapitalize || keyboardType === 'email-address';
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedSoft}
      keyboardType={keyboardType ?? 'default'}
      secureTextEntry={secure}
      autoCapitalize={upperCase ? 'characters' : raw ? 'none' : 'words'}
      autoCorrect={!raw}
      autoComplete={
        keyboardType === 'email-address' ? 'email' : secure ? 'new-password' : undefined
      }
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing(2.5),
    gap: spacing(1.25),
    paddingBottom: spacing(6),
  },
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
  terms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    paddingVertical: spacing(1),
  },
  error: { color: colors.danger, fontSize: 13 },
});
