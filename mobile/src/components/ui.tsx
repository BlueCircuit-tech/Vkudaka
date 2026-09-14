import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing, typography } from '../theme/theme';

/** Blocos visuais compartilhados. Um só lugar define a linguagem da marca. */

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Container
        style={[styles.screen, style]}
        contentContainerStyle={scroll ? styles.scrollContent : undefined}
      >
        {children}
      </Container>
    </SafeAreaView>
  );
}

export const Label = ({ children }: { children: React.ReactNode }) => (
  <Text style={typography.label}>{children}</Text>
);

export const Title = ({ children }: { children: React.ReactNode }) => (
  <Text style={typography.display}>{children}</Text>
);

export const Body = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => (
  <Text style={[typography.body, muted && { color: colors.muted }]}>{children}</Text>
);

export const Caption = ({ children }: { children: React.ReactNode }) => (
  <Text style={typography.caption}>{children}</Text>
);

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'quiet' && styles.buttonQuiet,
        (pressed || isDisabled) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.ink : colors.goldDeep} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && { color: colors.ink },
            variant !== 'primary' && { color: colors.goldDeep },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.goldDeep} />
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={typography.title}>{title}</Text>
      {description ? <Caption>{description}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: spacing(6) },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing(2),
  },
  button: {
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(3),
  },
  buttonPrimary: { backgroundColor: colors.gold },
  buttonGhost: { borderWidth: 1, borderColor: colors.gold, backgroundColor: 'transparent' },
  // Superfície do card com leve calor do nude para separar do marfim do fundo.
  buttonQuiet: { backgroundColor: colors.surfaceAlt },
  buttonText: { fontFamily: fonts.body, fontSize: 15, letterSpacing: 0.4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing(2) },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing(6) },
  empty: { alignItems: 'center', gap: spacing(1), paddingVertical: spacing(6) },
});
