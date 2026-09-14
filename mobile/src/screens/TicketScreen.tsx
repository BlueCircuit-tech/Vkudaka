import React, { useCallback, useState } from 'react';
import { Dimensions, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '../api/client';
import { colors, radius, spacing, typography, fonts } from '../theme/theme';
import { Caption, Label, Loading, Screen } from '../components/ui';

/**
 * Ingresso (2.4).
 *
 * Composição: a arte da casa em cima, íntegra, e embaixo o bloco de leitura —
 * QR Code, número e titular. A arte é um convite de impressão (paisagem, fundo
 * preto): usá-la como fundo do cartão inteiro exigiria um véu por cima, que a
 * apagaria. Aqui ela é a tarja superior e nada é escrito sobre ela.
 *
 * O QR carrega o payload assinado (HMAC) emitido pelo servidor — o app só
 * desenha. O número alfanumérico vem abaixo porque leitor de portaria falha e a
 * recepção precisa poder digitar.
 */

interface Ticket {
  id: string;
  code: string;
  qrPayload: string;
  kind: 'SUBSCRIBER_RSVP' | 'PAID_TICKET' | 'GUEST';
  status: 'VALID' | 'USED' | 'CANCELED' | 'REFUNDED';
  holderName: string;
  usedAt: string | null;
  event: {
    title: string;
    startsAt: string;
    venueName: string | null;
    ticketArtUrl: string | null;
  };
  ticketType: { name: string } | null;
}

const KIND_LABEL: Record<Ticket['kind'], string> = {
  SUBSCRIBER_RSVP: 'Assinante · entrada gratuita',
  PAID_TICKET: 'Ingresso avulso',
  GUEST: 'Convidado da casa',
};

/** O convite é 15×9 — a tarja mantém essa proporção para não cortar a arte. */
const ART_RATIO = 15 / 9;

const QR_SIZE = Math.min(Dimensions.get('window').width - 150, 220);

export function TicketScreen() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  const load = useCallback(async () => {
    setTickets(await api.get<Ticket[]>('/events/me/tickets'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!tickets) return <Loading />;

  if (tickets.length === 0) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Text style={typography.title}>Nenhum ingresso ainda</Text>
          <Caption>Confirme presença em um evento para gerar o seu.</Caption>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const used = ticket.status === 'USED';
  const art = ticket.event.ticketArtUrl;

  /** Compartilhar o número resolve o caso do celular sem bateria na fila. */
  const share = () =>
    void Share.share({
      message:
        `${ticket.event.title}\n` +
        `${new Date(ticket.event.startsAt).toLocaleString('pt-BR')}` +
        `${ticket.event.venueName ? ` · ${ticket.event.venueName}` : ''}\n` +
        `Ingresso ${ticket.code} — ${ticket.holderName}`,
    });

  return (
    <View style={styles.ticket}>
      {art ? (
        <Image source={{ uri: art }} style={styles.art} resizeMode="cover" />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Text style={styles.artFallbackText}>{ticket.event.title}</Text>
        </View>
      )}

      {/* Picote: a linha entre a arte e o canhoto, como num ingresso de papel. */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchRight]} />
      </View>

      <View style={[styles.body, used && styles.bodyUsed]}>
        <Label>{KIND_LABEL[ticket.kind]}</Label>
        <Text style={[typography.title, styles.eventTitle]}>{ticket.event.title}</Text>
        <Caption>
          {new Date(ticket.event.startsAt).toLocaleString('pt-BR')}
          {ticket.event.venueName ? ` · ${ticket.event.venueName}` : ''}
        </Caption>

        <View style={styles.qrBox}>
          <QRCode value={ticket.qrPayload} size={QR_SIZE} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        <Text style={styles.code}>{ticket.code}</Text>
        <Caption>{ticket.holderName}</Caption>
        {ticket.ticketType ? <Caption>{ticket.ticketType.name}</Caption> : null}

        {used ? (
          <View style={styles.usedBadge}>
            <Text style={styles.usedText}>
              Entrada registrada
              {ticket.usedAt ? ` em ${new Date(ticket.usedAt).toLocaleString('pt-BR')}` : ''}
            </Text>
          </View>
        ) : (
          <Pressable onPress={share} style={styles.shareLink}>
            <Text style={styles.shareText}>Compartilhar número do ingresso</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing(2.5), gap: spacing(3), paddingBottom: spacing(6) },

  ticket: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  /* Ingresso usado esmaece o canhoto, nunca a arte: a marca não se degrada. */
  bodyUsed: { opacity: 0.55 },

  art: { width: '100%', aspectRatio: ART_RATIO, backgroundColor: colors.ink },
  artFallback: { alignItems: 'center', justifyContent: 'center', padding: spacing(2) },
  artFallbackText: {
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.gold,
    textAlign: 'center',
  },

  perforation: { flexDirection: 'row', alignItems: 'center', height: 18 },
  dashes: {
    flex: 1,
    height: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  notch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.background,
  },
  notchLeft: { marginLeft: -9 },
  notchRight: { marginRight: -9 },

  body: { alignItems: 'center', gap: spacing(0.75), padding: spacing(3), paddingTop: spacing(1.5) },
  eventTitle: { textAlign: 'center' },

  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: spacing(1.5),
    borderRadius: radius.sm,
    marginVertical: spacing(1.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  code: { fontFamily: fonts.display, fontSize: 22, letterSpacing: 4, color: colors.goldDeep },

  usedBadge: {
    marginTop: spacing(1),
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 5,
  },
  usedText: { ...typography.caption, color: colors.muted },

  shareLink: { marginTop: spacing(1), paddingVertical: spacing(0.5) },
  shareText: { ...typography.caption, color: colors.goldDeep, textDecorationLine: 'underline' },

  empty: { padding: spacing(4), alignItems: 'center', gap: spacing(1) },
});
