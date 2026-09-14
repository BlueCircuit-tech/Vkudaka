import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography, brand } from '../theme/theme';
import { Button, Caption, Screen } from '../components/ui';

/** Login do clube (2.1). Aceita e-mail ou CPF no mesmo campo. */
export function SignInScreen() {
  const navigation = useNavigation<never>();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Image source={brand.logo} style={styles.logo} resizeMode="contain" />
        <Text style={[typography.display, styles.title]}>Clube de assinantes</Text>
        <Caption>Acesso exclusivo para assinantes VKUDAKA.</Caption>

        <View style={styles.form}>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="E-mail ou CPF"
            placeholderTextColor={colors.mutedSoft}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Senha"
            placeholderTextColor={colors.mutedSoft}
            secureTextEntry
            style={styles.input}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title="Entrar" onPress={() => void submit()} loading={loading} />
          <Pressable
            onPress={() => (navigation as never as { navigate: (s: string) => void }).navigate('SignUp')}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Criar meu cadastro</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing(3), gap: spacing(1) },
  logo: { width: 200, height: 78, alignSelf: 'center', marginBottom: spacing(2) },
  title: { textAlign: 'center', fontSize: 24 },
  form: { gap: spacing(1.5), paddingTop: spacing(3) },
  input: {
    height: 52,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    paddingHorizontal: spacing(2),
  },
  error: { color: colors.danger, fontSize: 13 },
  secondary: { alignItems: 'center', paddingVertical: spacing(1) },
  secondaryText: { color: colors.goldDeep, fontSize: 14 },
});
