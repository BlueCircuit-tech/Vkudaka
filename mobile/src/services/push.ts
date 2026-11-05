import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api } from '../api/client';
import { colors } from '../theme/theme';

/**
 * Push notifications (3.7) — lado do aparelho.
 *
 * O CRM já disparava os avisos de peça nova e evento novo, mas o app nunca
 * registrava o token: a campanha saía com alvo definido e zero entregas,
 * porque não havia para onde enviar. Este módulo fecha o circuito.
 *
 * Nada aqui pode derrubar o app: sem permissão, sem projeto EAS ou em
 * emulador, a função devolve `null` e a vida segue — push é um extra, não um
 * requisito para usar o clube.
 */

/** Aviso recebido com o app aberto também aparece — senão passa despercebido. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** O token do Expo exige o id do projeto EAS a partir do SDK 49. */
const projectId =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Clube VKUDAKA',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: colors.gold,
  });
}

/**
 * Pede permissão, obtém o token e registra no servidor.
 * Devolve o token registrado, ou `null` quando não é possível.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    await ensureAndroidChannel();

    const current = await Notifications.getPermissionsAsync();
    const status =
      current.status === 'granted'
        ? current.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (status !== 'granted') return null;

    // Sem projeto EAS (Expo Go em desenvolvimento) não há token remoto.
    if (!projectId) {
      console.warn('[push] sem projectId do EAS — token remoto indisponível neste build');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await api.post('/users/me/devices', {
      token,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      appVersion: Constants.expoConfig?.version,
    });

    return token;
  } catch (error) {
    // Emulador, permissão negada no sistema, rede fora — nada disso é fatal.
    console.warn('[push] registro não concluído:', error);
    return null;
  }
}

/**
 * Desliga o aparelho ao sair da conta: sem isto, quem usa o celular depois
 * continuaria recebendo os avisos do clube da pessoa anterior.
 */
export async function unregisterPush(): Promise<void> {
  try {
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.delete(`/users/me/devices/${encodeURIComponent(token)}`);
  } catch {
    /* já saiu, sem rede ou sem token: não há o que desligar */
  }
}

/** Deep links que os avisos carregam (`vkudaka://produto/<id>`). */
export type PushTarget =
  | { screen: 'ProductDetail'; params: { productId: string; mode: 'SALE' } }
  | { screen: 'Tabs'; params: { screen: string } };

export function parseDeepLink(link: string | undefined): PushTarget | null {
  if (!link) return null;
  const path = link.replace(/^vkudaka:\/\//, '').replace(/^\/+/, '');
  const [recurso, id] = path.split('/');

  switch (recurso) {
    case 'produto':
      return id ? { screen: 'ProductDetail', params: { productId: id, mode: 'SALE' } } : null;
    case 'evento':
      return { screen: 'Tabs', params: { screen: 'Eventos' } };
    case 'carteira':
      return { screen: 'Tabs', params: { screen: 'Carteira' } };
    case 'pedido':
      return { screen: 'Tabs', params: { screen: 'Perfil' } };
    default:
      return null;
  }
}

/** Assina o toque no aviso. Devolve a função de cancelamento. */
export function onNotificationTap(handler: (target: PushTarget) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { deepLink?: string } | undefined;
    const target = parseDeepLink(data?.deepLink);
    if (target) handler(target);
  });

  return () => subscription.remove();
}
