import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Screen } from '../components/ui';

/**
 * "Esqueci minha senha" (2026-11-12).
 *
 * 1. A pessoa informa o e-mail ou CPF e recebe um código de 6 dígitos no
 *    e-mail do cadastro.
 * 2. Digita o código e a senha nova — e já entra no app.
 */

type Params = { ForgotPassword: { identifier?: string } | undefined };

const RESEND_SECONDS = 60;

export function ForgotPasswordScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<Params, 'ForgotPassword'>>();
  const { signIn } = useAuth();

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [identifier, setIdentifier] = useState(params?.identifier ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async () => {
    if (identifier.trim().length < 5) {
      setError('Informe o e-mail ou o CPF do seu cadastro.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<{ message: string }>('/auth/password/forgot', {
        identifier: identifier.trim(),
      });
      setNotice(result.message);
      setStep('reset');
      setCooldown(RESEND_SECONDS);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Digite os 6 números do código que chegou no seu e-mail.');
      return;
    }
    if (password.length < 8) {
      setError('A senha nova precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As duas senhas não são iguais.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', {
        identifier: identifier.trim(),
        code: code.trim(),
        newPassword: password,
      });
      // Senha trocada: entra direto, sem pedir para digitar de novo.
      await signIn(identifier.trim(), password);
    } catch (caught) {
      setError((caught as Error).message);
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={[typography.display, styles.title]}>Esqueci minha senha</Text>

          {step === 'request' ? (
            <>
              <Body>
                Informe o e-mail ou o CPF do seu cadastro. Vamos mandar um código de 6 números para o
                seu e-mail.
              </Body>
              <TextInput
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="E-mail ou CPF"
                placeholderTextColor={colors.mutedSoft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={styles.input}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button title="Enviar código" onPress={() => void requestCode()} loading={loading} />
            </>
          ) : (
            <>
              {notice ? (
                <View style={styles.notice}>
                  <Caption>{notice}</Caption>
                </View>
              ) : null}
              <TextInput
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
                placeholder="Código de 6 números"
                placeholderTextColor={colors.mutedSoft}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                style={[styles.input, code ? styles.codeInput : null]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Nova senha (mínimo 8 caracteres)"
                placeholderTextColor={colors.mutedSoft}
                secureTextEntry
                textContentType="newPassword"
                style={styles.input}
              />
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Repita a nova senha"
                placeholderTextColor={colors.mutedSoft}
                secureTextEntry
                textContentType="newPassword"
                style={styles.input}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button title="Salvar nova senha e entrar" onPress={() => void resetPassword()} loading={loading} />
              <Pressable
                disabled={cooldown > 0 || loading}
                onPress={() => void requestCode()}
                style={styles.secondary}
              >
                <Text style={[styles.secondaryText, cooldown > 0 && { color: colors.mutedSoft }]}>
                  {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Não recebi — reenviar código'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('request');
                  setError(null);
                  setCode('');
                }}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>Usar outro e-mail ou CPF</Text>
              </Pressable>
            </>
          )}

          <Pressable onPress={() => navigation.goBack()} style={styles.secondary}>
            <Text style={styles.secondaryText}>Voltar para o login</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing(3), gap: spacing(1.5) },
  title: { textAlign: 'center', fontSize: 24, marginBottom: spacing(1) },
  input: {
    height: 52,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: spacing(2),
  },
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: 'center' },
  notice: {
    padding: spacing(1.5),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 13 },
  secondary: { alignItems: 'center', paddingVertical: spacing(0.75) },
  secondaryText: { color: colors.goldDeep, fontSize: 14 },
});
