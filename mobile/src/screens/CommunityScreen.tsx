import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { api, uploadMedia } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing, typography } from '../theme/theme';
import { Body, Caption, Label, Loading, Screen } from '../components/ui';
import { ReportSheet, type ReportTarget } from '../components/ReportSheet';

/** expo-video usa hook de player; encapsular permite usá-lo em lista e preview. */
function CommunityVideo({
  uri,
  style,
  loop = false,
}: {
  uri: string;
  style: object;
  loop?: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = loop;
  });
  return <VideoView player={player} style={style} nativeControls contentFit="cover" />;
}

/**
 * Comunidade (2.5) — feed entre assinantes.
 *
 * Publicar com foto ou vídeo, texto, data e hora, curtidas, comentários e os
 * botões de publicar, editar e apagar.
 *
 * A mídia é enviada ao servidor ANTES de criar o post: gravar a URI local do
 * aparelho (`file:///...`) faria a foto existir só para quem publicou.
 */

interface Media {
  id: string;
  url: string;
  kind: 'IMAGE' | 'VIDEO';
}

interface Post {
  id: string;
  content: string;
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  isMine: boolean;
  isOfficial: boolean;
  user: { id: string; fullName: string; avatarUrl: string | null };
  media: Media[];
}

interface Comment {
  id: string;
  content: string;
  links: string[];
  createdAt: string;
  isMine: boolean;
  user: { id: string; fullName: string; avatarUrl: string | null };
}

/** Data e hora em cada publicação (2.5). */
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** O picker não devolve mime; deduzimos pela extensão para o upload. */
const mimeOf = (uri: string, kind: 'IMAGE' | 'VIDEO') => {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  if (kind === 'VIDEO') return ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
};

export function CommunityScreen() {
  const { user: me } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [draft, setDraft] = useState('');
  const [draftMedia, setDraftMedia] = useState<{ uri: string; kind: 'IMAGE' | 'VIDEO' } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');

  const load = useCallback(async () => {
    const page = await api.get<{ data: Post[] }>('/community/feed');
    setPosts(page.data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // ── Publicar ───────────────────────────────────────────────────────────────

  const pickMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 60,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setDraftMedia({ uri: asset.uri, kind: asset.type === 'video' ? 'VIDEO' : 'IMAGE' });
  };

  const publish = async () => {
    if (!draft.trim() && !draftMedia) return;
    setPublishing(true);
    try {
      // Sobe o arquivo primeiro; o post guarda a URL pública devolvida.
      const media = draftMedia
        ? [await uploadMedia(draftMedia.uri, mimeOf(draftMedia.uri, draftMedia.kind))]
        : [];

      await api.post('/community/posts', { content: draft.trim(), media });
      setDraft('');
      setDraftMedia(null);
      await load();
    } catch (error) {
      Alert.alert('Não foi possível publicar', (error as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  // ── Curtir, editar, apagar ─────────────────────────────────────────────────

  const toggleLike = async (post: Post) => {
    setPosts(
      (current) =>
        current?.map((item) =>
          item.id === post.id
            ? {
                ...item,
                likedByMe: !item.likedByMe,
                likeCount: item.likeCount + (item.likedByMe ? -1 : 1),
              }
            : item,
        ) ?? null,
    );
    await api.post(`/community/posts/${post.id}/like`).catch(() => void load());
  };

  const startEdit = (post: Post) => {
    setEditing(post.id);
    setEditDraft(post.content);
  };

  const saveEdit = async (post: Post) => {
    if (!editDraft.trim()) return;
    try {
      await api.patch(`/community/posts/${post.id}`, { content: editDraft.trim() });
      setEditing(null);
      await load();
    } catch (error) {
      Alert.alert('Não foi possível salvar', (error as Error).message);
    }
  };

  const removePost = (post: Post) => {
    Alert.alert('Apagar publicação', 'Esta ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await api.delete(`/community/posts/${post.id}`);
          await load();
        },
      },
    ]);
  };

  // ── Denunciar e bloquear (política de conteúdo de usuários das lojas) ──────

  const blockAuthor = (author: Post['user']) => {
    Alert.alert(
      `Bloquear ${author.fullName}?`,
      'Vocês deixam de ver as publicações e os comentários um do outro. Dá para desfazer no seu perfil.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Bloquear',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/community/users/${author.id}/block`);
              setOpenComments(null);
              await load();
            } catch (error) {
              Alert.alert('Não foi possível bloquear', (error as Error).message);
            }
          },
        },
      ],
    );
  };

  /** Menu "⋯" de publicação de outro membro. */
  const postMenu = (post: Post) => {
    Alert.alert(post.user.fullName, undefined, [
      { text: 'Denunciar publicação', onPress: () => setReporting({ kind: 'post', id: post.id }) },
      { text: 'Bloquear membro', style: 'destructive', onPress: () => blockAuthor(post.user) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  /** Menu de comentário de outro membro. */
  const commentMenu = (comment: Comment) => {
    Alert.alert(comment.user.fullName, undefined, [
      { text: 'Denunciar comentário', onPress: () => setReporting({ kind: 'comment', id: comment.id }) },
      { text: 'Bloquear membro', style: 'destructive', onPress: () => blockAuthor(comment.user) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  // ── Comentários ────────────────────────────────────────────────────────────

  const openThread = async (post: Post) => {
    if (openComments === post.id) {
      setOpenComments(null);
      return;
    }
    setOpenComments(post.id);
    setComments(await api.get<Comment[]>(`/community/posts/${post.id}/comments`));
  };

  const sendComment = async (postId: string) => {
    if (!commentDraft.trim()) return;
    await api.post(`/community/posts/${postId}/comments`, { content: commentDraft.trim() });
    setCommentDraft('');
    setComments(await api.get<Comment[]>(`/community/posts/${postId}/comments`));
    await load();
  };

  const removeComment = (postId: string, comment: Comment) => {
    Alert.alert('Apagar comentário', 'Esta ação não pode ser desfeita.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await api.delete(`/community/comments/${comment.id}`);
          setComments(await api.get<Comment[]>(`/community/posts/${postId}/comments`));
          await load();
        },
      },
    ]);
  };

  if (!posts) return <Loading />;

  return (
    <Screen scroll={false}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.composer}>
            <Text style={typography.display}>Comunidade</Text>

            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Compartilhe com o clube…"
              placeholderTextColor={colors.mutedSoft}
              style={styles.input}
              multiline
              maxLength={2000}
            />

            {draftMedia ? (
              <View>
                {draftMedia.kind === 'VIDEO' ? (
                  <CommunityVideo uri={draftMedia.uri} style={styles.preview} />
                ) : (
                  <Image source={{ uri: draftMedia.uri }} style={styles.preview} />
                )}
                <Pressable onPress={() => setDraftMedia(null)} style={styles.removeMedia}>
                  <Text style={styles.removeMediaText}>Remover</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composerActions}>
              <Pressable onPress={() => void pickMedia()} style={styles.iconButton}>
                <Text style={{ color: colors.goldDeep }}>+ Foto ou vídeo</Text>
              </Pressable>

              <Pressable
                onPress={() => void publish()}
                disabled={publishing || (!draft.trim() && !draftMedia)}
                style={[
                  styles.publish,
                  (publishing || (!draft.trim() && !draftMedia)) && { opacity: 0.5 },
                ]}
              >
                {publishing ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <Text style={styles.publishText}>Publicar</Text>
                )}
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.post}>
            <View style={styles.postHeader}>
              <Avatar name={item.user.fullName} url={item.user.avatarUrl} />
              <View style={{ flex: 1 }}>
                <Text style={styles.author}>{item.user.fullName}</Text>
                <Caption>
                  {formatWhen(item.createdAt)}
                  {item.editedAt ? ' · editado' : ''}
                </Caption>
              </View>
              {item.isOfficial ? <Label>Casa VKUDAKA</Label> : null}
              {!item.isMine ? (
                <Pressable
                  onPress={() => postMenu(item)}
                  hitSlop={12}
                  accessibilityLabel="Mais opções"
                  accessibilityRole="button"
                >
                  <Text style={styles.more}>⋯</Text>
                </Pressable>
              ) : null}
            </View>

            {editing === item.id ? (
              <View style={styles.editBox}>
                <TextInput
                  value={editDraft}
                  onChangeText={setEditDraft}
                  style={styles.input}
                  multiline
                  autoFocus
                  maxLength={2000}
                />
                <View style={styles.editActions}>
                  <Pressable onPress={() => setEditing(null)} style={styles.iconButton}>
                    <Text style={{ color: colors.muted }}>Cancelar</Text>
                  </Pressable>
                  <Pressable onPress={() => void saveEdit(item)} style={styles.publish}>
                    <Text style={styles.publishText}>Salvar</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Body>{item.content}</Body>
            )}

            {item.media.map((media) =>
              media.kind === 'VIDEO' ? (
                <CommunityVideo key={media.id} uri={media.url} style={styles.media} loop />
              ) : (
                <Image key={media.id} source={{ uri: media.url }} style={styles.media} />
              ),
            )}

            <View style={styles.postActions}>
              <Pressable onPress={() => void toggleLike(item)}>
                <Text style={{ color: item.likedByMe ? colors.goldDeep : colors.muted }}>
                  ♥ {item.likeCount}
                </Text>
              </Pressable>
              <Pressable onPress={() => void openThread(item)}>
                <Text style={{ color: colors.muted }}>💬 {item.commentCount}</Text>
              </Pressable>

              {item.isMine && editing !== item.id ? (
                <>
                  <Pressable onPress={() => startEdit(item)}>
                    <Text style={{ color: colors.muted }}>Editar</Text>
                  </Pressable>
                  <Pressable onPress={() => removePost(item)}>
                    <Text style={{ color: colors.mutedSoft }}>Apagar</Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            {openComments === item.id ? (
              <View style={styles.thread}>
                {comments.map((comment) => (
                  <View key={comment.id} style={styles.comment}>
                    <View style={styles.commentHead}>
                      <Caption>
                        {comment.user.fullName} · {formatWhen(comment.createdAt)}
                      </Caption>
                      {comment.isMine || item.isMine ? (
                        <Pressable onPress={() => removeComment(item.id, comment)}>
                          <Text style={styles.commentDelete}>Apagar</Text>
                        </Pressable>
                      ) : null}
                      {!comment.isMine && comment.user.id !== me?.id ? (
                        <Pressable onPress={() => commentMenu(comment)} hitSlop={12} accessibilityLabel="Mais opções">
                          <Text style={styles.commentDelete}>Denunciar</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <Body>{comment.content}</Body>

                    {/* Hiperlinks externos clicáveis, extraídos pelo servidor. */}
                    {comment.links.map((link) => (
                      <Pressable key={link} onPress={() => void Linking.openURL(link)}>
                        <Text style={styles.link}>{link}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}

                <View style={styles.commentComposer}>
                  <TextInput
                    value={commentDraft}
                    onChangeText={setCommentDraft}
                    placeholder="Comentar…"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.commentInput]}
                    maxLength={1000}
                  />
                  <Pressable onPress={() => void sendComment(item.id)} style={styles.iconButton}>
                    <Text style={{ color: colors.goldDeep }}>Enviar</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        )}
      />
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </Screen>
  );
}

/** Avatar padrão com iniciais quando não há foto (2.1). */
function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) return <Image source={{ uri: url }} style={styles.avatar} />;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing(2), gap: spacing(2), paddingBottom: spacing(6) },
  composer: { gap: spacing(1), paddingBottom: spacing(2) },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.ink,
    padding: spacing(1.5),
    minHeight: 56,
  },
  commentInput: { flex: 1, minHeight: 40 },
  preview: { width: '100%', height: 200, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  removeMedia: { alignSelf: 'flex-end', paddingVertical: spacing(0.75) },
  removeMediaText: { ...typography.caption, color: colors.muted, textDecorationLine: 'underline' },
  composerActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: { paddingVertical: spacing(1), paddingHorizontal: spacing(1) },
  publish: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
    minWidth: 96,
    alignItems: 'center',
  },
  publishText: { color: colors.ink, fontWeight: '600' },

  post: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing(2),
    gap: spacing(1),
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  more: { color: colors.muted, fontSize: 22, lineHeight: 24, paddingHorizontal: spacing(0.5) },
  author: { ...typography.body, fontWeight: '600' },
  avatar: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
  },
  avatarText: { color: colors.goldDeep, fontSize: 14 },
  media: { width: '100%', height: 240, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },

  editBox: { gap: spacing(1) },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing(1) },

  postActions: { flexDirection: 'row', gap: spacing(2.5), paddingTop: spacing(0.5), alignItems: 'center' },
  thread: {
    gap: spacing(1),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing(1),
  },
  comment: { gap: 2 },
  commentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  commentDelete: { ...typography.caption, color: colors.mutedSoft },
  commentComposer: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  link: { color: colors.goldDeep, textDecorationLine: 'underline', fontSize: 13.5 },
});
