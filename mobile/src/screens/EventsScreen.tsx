import React, { useCallback, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, formatBRL, radius, spacing, typography } from '../theme/theme';
import { Body, Button, Caption, Card, Label, Loading, Screen } from '../components/ui';

/**
 * Eventos (2.4).
 *
 * Duas experiências na mesma tela, deliberadamente separadas:
 *  • Assinante: confirma presença, não paga entrada.
 *  • Não assinante: vê apenas o bloco isolado de ingresso avulso.
 */

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  venueName: string | null;
  startsAt: string;
  freeForMe: boolean;
  confirmed: boolean;
  canBuyTicket: boolean;
  /** Ingresso que esta pessoa já tem neste evento, se houver. */
  myTicket: { id: string; code: string; kind: string; used: boolean; paid: boolean } | null;
  ticketTypes: Array<{ id: string; name: string; priceCents: number; quantity: number; sold: number }>;
}

export function EventsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<never>();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setEvents(await api.get<EventItem[]>('/events'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirm = async (event: EventItem) => {
    setBusyId(event.id);
    try {
      const response = await api.post<{ ticket: { id: string } | null }>(`/events/${event.id}/rsvp`);
      await load();
      if (response.ticket) {
        (navigation as never as { navigate: (s: string, p: unknown) => void }).navigate('Ticket', {
          ticketId: response.ticket.id,
        });
      }
    } catch (error) {
      Alert.alert('Não foi possível confirmar', (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const buy = async (event: EventItem, ticketTypeId: string) => {
    setBusyId(event.id);
    try {
      const response = await api.post<{ payment: { status: string } | null }>(
        `/events/${event.id}/tickets`,
        { ticketTypeId, quantity: 1 },
      );
      await load();
      Alert.alert(
        response.payment?.status === 'PAID' ? 'Presença confirmada' : 'Ingresso reservado',
        response.payment?.status === 'PAID'
          ? 'Seu ingresso já está disponível no app.'
          : 'Finalize o pagamento para garantir sua entrada — só entra quem pagou.',
      );
    } catch (error) {
      Alert.alert('Não foi possível comprar', (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const openTicket = () =>
    (navigation as never as { navigate: (s: string) => void }).navigate('Ticket');

  if (!events) return <Loading />;

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.display}>Eventos</Text>

        {!user?.isSubscriber ? (
          <Card style={styles.guestBlock}>
            <Label>Sem assinatura</Label>
            <Body>
              Você pode comprar ingressos avulsos para os eventos abertos. As demais áreas do app
              são exclusivas para assinantes.
            </Body>
          </Card>
        ) : null}

        {events.map((event) => (
          <Card key={event.id} style={styles.card}>
            {event.coverUrl ? (
              <Image source={{ uri: event.coverUrl }} style={styles.cover} resizeMode="cover" />
            ) : null}

            <Text style={typography.title}>{event.title}</Text>
            <Caption>
              {new Date(event.startsAt).toLocaleString('pt-BR')}
              {event.venueName ? ` · ${event.venueName}` : ''}
            </Caption>
            {event.description ? <Body muted>{event.description}</Body> : null}

            {/*
              Quatro estados, nesta ordem: já tem ingresso → assinante confirma
              de graça → não assinante compra → evento fechado. Antes, quem já
              tinha comprado continuava vendo a oferta de compra.
            */}
            {event.myTicket ? (
              <View style={styles.actions}>
                <View style={styles.freeTag}>
                  <Text style={styles.freeTagText}>
                    {event.myTicket.used
                      ? 'Entrada já utilizada'
                      : event.myTicket.paid
                        ? 'Presença confirmada'
                        : 'Aguardando pagamento'}
                  </Text>
                </View>
                <Caption>
                  {event.myTicket.paid
                    ? `Ingresso ${event.myTicket.code} — apresente o QR Code na entrada.`
                    : `Ingresso ${event.myTicket.code} — a entrada só é liberada após o pagamento.`}
                </Caption>
                <Button title="Ver meu ingresso" variant="ghost" onPress={openTicket} />
              </View>
            ) : event.freeForMe ? (
              <View style={styles.actions}>
                <View style={styles.freeTag}>
                  <Text style={styles.freeTagText}>Entrada gratuita para assinantes</Text>
                </View>
                <Button
                  title="Confirmar presença"
                  onPress={() => void confirm(event)}
                  loading={busyId === event.id}
                />
              </View>
            ) : event.canBuyTicket ? (
              <View style={styles.actions}>
                <Label>Ingresso avulso</Label>
                <Caption>
                  {user?.isSubscriber
                    ? 'Este evento cobra entrada de todos.'
                    : 'Compre seu ingresso para confirmar presença.'}
                </Caption>
                {event.ticketTypes.map((type) => (
                  <View key={type.id} style={styles.ticketRow}>
                    <View style={{ flex: 1 }}>
                      <Body>{type.name}</Body>
                      <Caption>{Math.max(0, type.quantity - type.sold)} disponíveis</Caption>
                    </View>
                    <Button
                      title={formatBRL(type.priceCents)}
                      variant="ghost"
                      onPress={() => void buy(event, type.id)}
                      loading={busyId === event.id}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Caption>Este evento não está aberto para novas entradas.</Caption>
            )}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(2), paddingBottom: spacing(6) },
  card: { gap: spacing(1) },
  cover: { width: '100%', height: 150, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  guestBlock: { gap: spacing(0.5), borderColor: colors.gold },
  actions: { gap: spacing(1), paddingTop: spacing(1) },
  freeTag: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    paddingHorizontal: spacing(1.25),
    paddingVertical: 4,
  },
  freeTagText: { color: colors.goldDeep, fontSize: 11, letterSpacing: 0.4 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
});
