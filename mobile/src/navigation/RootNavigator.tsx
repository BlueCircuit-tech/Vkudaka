import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import { onNotificationTap } from '../services/push';
import { colors, fonts } from '../theme/theme';
import { Loading } from '../components/ui';

import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { ClubScreen } from '../screens/ClubScreen';
import { ShopScreen } from '../screens/ShopScreen';
import { LooksScreen } from '../screens/LooksScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { EventsScreen } from '../screens/EventsScreen';
import { TicketScreen } from '../screens/TicketScreen';
import { TopUpScreen } from '../screens/TopUpScreen';
import { RentalScreen } from '../screens/RentalScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { WalletScreen } from '../screens/WalletScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SubscriptionRequiredScreen } from '../screens/SubscriptionRequiredScreen';
import { PlansScreen } from '../screens/PlansScreen';

export type RootStackParamList = {
  Tabs: undefined;
  ProductDetail: { productId: string; mode: 'SALE' | 'RENTAL' };
  Checkout: { variantId: string; productId: string; mode: 'SALE' | 'RENTAL' };
  Ticket: { ticketId: string };
  /** Recarga da carteira. `suggestedCents` vem do checkout quando falta saldo. */
  TopUp: { suggestedCents?: number } | undefined;
  Looks: undefined;
  /** Aluguel (2.3) — seção própria, alcançada pela loja. */
  Rental: undefined;
  Plans: undefined;
  SubscriptionRequired: { storeUrl?: string } | undefined;
};

/**
 * Referência à navegação para uso fora da árvore de componentes — é assim que o
 * toque num aviso de push abre a tela do produto ou do evento.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const tabIcon = (glyph: string) =>
  function TabIcon({ color }: { color: string }) {
    return <Text style={{ color, fontSize: 17 }}>{glyph}</Text>;
  };

/**
 * Hierarquia de navegação (2.2 a 2.6).
 *
 * "Escolha seu Look" NÃO é uma aba: fica acessível a partir da loja,
 * em segundo plano, porque o foco do app é a venda (2.3).
 * A carteira, ao contrário, é menu apartado — aba própria (2.6).
 */
function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.mutedSoft,
        tabBarLabelStyle: { fontSize: 10.5, letterSpacing: 0.6 },
      }}
    >
      <Tabs.Screen name="Club" component={ClubScreen} options={{ tabBarIcon: tabIcon('◈') }} />
      <Tabs.Screen name="Loja" component={ShopScreen} options={{ tabBarIcon: tabIcon('▣') }} />
      <Tabs.Screen name="Eventos" component={EventsScreen} options={{ tabBarIcon: tabIcon('✦') }} />
      <Tabs.Screen
        name="Comunidade"
        component={CommunityScreen}
        options={{ tabBarIcon: tabIcon('❖') }}
      />
      <Tabs.Screen
        name="Carteira"
        component={WalletScreen}
        options={{ tabBarIcon: tabIcon('◇') }}
      />
      <Tabs.Screen name="Perfil" component={ProfileScreen} options={{ tabBarIcon: tabIcon('☰') }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading } = useAuth();

  // Peça nova, evento novo, recarga: o aviso leva direto ao assunto (3.7).
  useEffect(
    () =>
      onNotificationTap((target) => {
        if (!navigationRef.isReady()) return;
        // O alvo vem de um deep link, então a rota é resolvida em tempo de
        // execução — daí o afrouxamento pontual do tipo da navegação.
        const navigate = navigationRef.navigate as unknown as (
          screen: string,
          params?: object,
        ) => void;
        navigate(target.screen, target.params);
      }),
    [],
  );

  if (loading) return <Loading />;

  if (!user) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="SignIn" component={SignInScreen} />
        <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      </AuthStack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: fonts.display },
      }}
    >
      <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="Looks"
        component={LooksScreen}
        options={{ title: 'Escolha seu Look' }}
      />
      <Stack.Screen name="Rental" component={RentalScreen} options={{ title: 'Aluguel' }} />
      {/* Título em caixa alta: a Carla não tem minúsculas acentuadas. */}
      <Stack.Screen name="Plans" component={PlansScreen} options={{ title: 'PLANOS' }} />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetailScreen}
        options={{ title: '' }}
      />
      <Stack.Screen name="Checkout" component={CheckoutScreen} options={{ title: 'Fechar pedido' }} />
      <Stack.Screen name="Ticket" component={TicketScreen} options={{ title: 'Seu ingresso' }} />
      <Stack.Screen name="TopUp" component={TopUpScreen} options={{ title: 'Carteira' }} />
      <Stack.Screen
        name="SubscriptionRequired"
        component={SubscriptionRequiredScreen}
        options={{ title: 'Clube VKUDAKA', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
