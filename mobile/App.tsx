import React, { useCallback } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from './src/context/AuthContext';
import { RootNavigator, navigationRef } from './src/navigation/RootNavigator';
import { colors } from './src/theme/theme';

void SplashScreen.preventAutoHideAsync();

/**
 * Tema de navegação alinhado ao manual da marca: fundo marfim, tinta preta,
 * ouro como cor de ação. A interface é clara por decisão de identidade —
 * "menos é mais".
 */
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.ink,
    primary: colors.goldDeep,
    border: colors.border,
  },
};

export default function App() {
  // Tipografia oficial: Carla nos títulos, Noto Sans Condensed no texto.
  const [fontsLoaded, fontError] = useFonts({
    Carla: require('./assets/fonts/CarlaSans-SemiBold.otf'),
    NotoSans: require('./assets/fonts/NotoSans-CondensedSemiBold.ttf'),
    NotoSansItalic: require('./assets/fonts/NotoSans-CondensedMediumItalic.ttf'),
  });

  const onReady = useCallback(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // Sem as fontes da marca a tela abriria com tipografia de sistema e "piscaria"
  // para a correta. Preferimos segurar na splash.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          linking={{ prefixes: ['vkudaka://'] }}
          onReady={onReady}
        >
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
