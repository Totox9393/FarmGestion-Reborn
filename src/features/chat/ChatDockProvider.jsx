import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StreamChat } from 'stream-chat';
import { useAuth } from '../authentification/AuthContext';
import { fetchStreamCredentials, openStreamConversation } from './streamApi';
import { blockRelation, fetchAcceptedFriendsForUser, fetchRelationBetweenUsers } from '../community/friendsApi';
import incomingMessageSound from '../../assets/sounds/17.wav';
import { createSafeAudio, restartAudioSafely } from '../utils/safeAudio';
import ChatDock from './ChatDock';
import { ChatDockContext } from './chatDockContext';
const STREAM_API_KEY = String(import.meta.env.VITE_STREAM_API_KEY || '').trim();
const isMissingStreamTokenError = (error) => /Both secret and user tokens are not set|connectUser wasn't called|disconnect was called/i.test(String(error?.message || error || ''));
const toTimestamp = (value) => {
  const parsed = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const messagePreview = (message) => {
  const text = String(message?.text || '').trim();
  if (text) return text;
  if (message?.attachments?.length) return 'Pièce jointe';
  return 'Aucun message pour le moment';
};
const sortFriendConversations = (conversations) => [...conversations].sort((left, right) => {
  const dateDifference = toTimestamp(right.lastMessageAt) - toTimestamp(left.lastMessageAt);
  if (dateDifference) return dateDifference;
  return String(left.friend?.username || left.friend?.name || '').localeCompare(
    String(right.friend?.username || right.friend?.name || ''),
    'fr',
  );
});
const friendFromProfile = (profile) => ({
  id: String(profile?.friendId || profile?.id || '').trim(),
  name: String(profile?.username || profile?.name || 'Ami'),
  username: String(profile?.username || profile?.name || 'Ami'),
  image: String(profile?.avatarUrl || profile?.image || ''),
});

export function ChatDockProvider({ children }) {
  const { user } = useAuth();
  const clientRef = useRef(null);
  const connectPromiseRef = useRef(null);
  const connectedUserIdRef = useRef('');
  const conversationCacheRef = useRef(new Map());
  const lastIncomingMessageIdRef = useRef('');
  const chatsRef = useRef([]);
  const friendConversationsRef = useRef([]);
  const incomingMessageAudioRef = useRef(null);
  const [client, setClient] = useState(null);
  const [chats, setChats] = useState([]);
  const [friendConversations, setFriendConversations] = useState([]);
  const [areFriendConversationsLoading, setAreFriendConversationsLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [blockingUserId, setBlockingUserId] = useState('');

  useEffect(() => {
    incomingMessageAudioRef.current = createSafeAudio(incomingMessageSound, { volume: 0.7, preload: 'auto' });
    return () => {
      if (incomingMessageAudioRef.current) incomingMessageAudioRef.current.pause();
      incomingMessageAudioRef.current = null;
    };
  }, []);

  const disconnect = useCallback(async () => {
    connectPromiseRef.current = null;
    connectedUserIdRef.current = '';
    conversationCacheRef.current.clear();
    lastIncomingMessageIdRef.current = '';
    chatsRef.current = [];
    friendConversationsRef.current = [];
    setChats([]);
    setFriendConversations([]);
    setAreFriendConversationsLoading(false);
    setClient(null);
    const currentClient = clientRef.current;
    clientRef.current = null;
    if (currentClient?.userID) {
      try {
        await currentClient.disconnectUser();
      } catch (error) {
        console.warn('Impossible de déconnecter Stream Chat proprement.', error);
      }
    }
  }, []);

  const ensureConnected = useCallback(async () => {
    const currentUserId = String(user?.id || '').trim();
    if (!currentUserId) throw new Error('Vous devez être connecté pour envoyer un message.');
    if (!STREAM_API_KEY) throw new Error('VITE_STREAM_API_KEY est manquante.');

    if (clientRef.current?.userID === currentUserId && clientRef.current?.tokenManager?.token) {
      return clientRef.current;
    }
    if (connectPromiseRef.current && connectedUserIdRef.current === currentUserId) {
      return connectPromiseRef.current;
    }

    const streamClient = new StreamChat(STREAM_API_KEY);
    clientRef.current = streamClient;
    connectedUserIdRef.current = currentUserId;
    connectPromiseRef.current = (async () => {
      let credentials = await fetchStreamCredentials();
      if (credentials?.user?.id !== currentUserId || !credentials?.token) {
        throw new Error('Identité Stream invalide.');
      }
      const streamUser = credentials.user;
      const tokenProvider = async () => {
        if (credentials?.token) {
          const initialToken = credentials.token;
          credentials = null;
          return initialToken;
        }
        const refreshedCredentials = await fetchStreamCredentials();
        if (refreshedCredentials?.user?.id !== currentUserId || !refreshedCredentials?.token) {
          throw new Error('Impossible de renouveler l’identité Stream.');
        }
        return refreshedCredentials.token;
      };
      await streamClient.connectUser(streamUser, tokenProvider);
      setClient(streamClient);
      return streamClient;
    })();

    try {
      return await connectPromiseRef.current;
    } catch (error) {
      clientRef.current = null;
      connectedUserIdRef.current = '';
      connectPromiseRef.current = null;
      throw error;
    }
  }, [user?.id]);

  const commitFriendConversations = useCallback((nextConversations) => {
    const sorted = sortFriendConversations(nextConversations);
    friendConversationsRef.current = sorted;
    setFriendConversations(sorted);
  }, []);

  const markFriendConversationRead = useCallback((friendUserId) => {
    const targetId = String(friendUserId || '').trim();
    if (!targetId) return;
    commitFriendConversations(friendConversationsRef.current.map((conversation) => (
      conversation.friend?.id === targetId ? { ...conversation, unreadCount: 0 } : conversation
    )));
  }, [commitFriendConversations]);

  const syncFriendConversationChannel = useCallback((channel, fallbackFriend = null, latestMessage = null) => {
    if (!channel) return;
    const currentUserId = String(clientRef.current?.userID || '').trim();
    const memberIds = Object.keys(channel.state?.members || {});
    const friendId = memberIds.find((memberId) => memberId !== currentUserId) || String(fallbackFriend?.id || '').trim();
    if (!friendId) return;

    const existing = friendConversationsRef.current.find((conversation) => conversation.friend?.id === friendId);
    const streamFriend = channel.state?.members?.[friendId]?.user || latestMessage?.user || {};
    const friend = existing?.friend || fallbackFriend || {
      id: friendId,
      name: streamFriend.name || streamFriend.username || 'Ami',
      username: streamFriend.username || streamFriend.name || 'Ami',
      image: streamFriend.image || '',
    };
    const lastMessage = latestMessage || channel.state?.latestMessages?.at(-1) || null;
    const nextConversation = {
      friend,
      channel,
      channelType: channel.type,
      channelId: channel.id,
      unreadCount: Math.max(0, Number(channel.countUnread?.() || 0)),
      lastMessage: messagePreview(lastMessage),
      lastMessageAt: lastMessage?.created_at || channel.data?.last_message_at || '',
    };
    const remaining = friendConversationsRef.current.filter((conversation) => conversation.friend?.id !== friendId);
    commitFriendConversations([...remaining, nextConversation]);
  }, [commitFriendConversations]);

  const refreshFriendConversations = useCallback(async ({ silent = false } = {}) => {
    const currentUserId = String(user?.id || '').trim();
    if (!currentUserId) return;
    if (!silent) setAreFriendConversationsLoading(true);
    try {
      const [streamClient, acceptedFriends] = await Promise.all([
        ensureConnected(),
        fetchAcceptedFriendsForUser(currentUserId),
      ]);
      let channels = [];
      try {
        const pageSize = 30;
        for (let offset = 0; offset < 300; offset += pageSize) {
          const page = await streamClient.queryChannels(
            { type: 'messaging', members: { $in: [currentUserId] } },
            [{ last_message_at: -1 }],
            { limit: pageSize, offset, message_limit: 1, presence: true, state: true, watch: true },
          );
          channels.push(...page);
          if (page.length < pageSize) break;
        }
      } catch (error) {
        console.warn('Impossible de synchroniser la liste des conversations Stream.', error);
      }

      const acceptedIds = new Set(acceptedFriends.map((friend) => String(friend.friendId)));
      const channelByFriendId = new Map();
      channels.forEach((channel) => {
        const friendId = Object.keys(channel.state?.members || {}).find((memberId) => memberId !== currentUserId);
        if (friendId && acceptedIds.has(friendId) && !channelByFriendId.has(friendId)) {
          channelByFriendId.set(friendId, channel);
        }
      });

      const nextConversations = acceptedFriends.map((profile) => {
        const friend = friendFromProfile(profile);
        const channel = channelByFriendId.get(friend.id) || null;
        const lastMessage = channel?.state?.latestMessages?.at(-1) || null;
        if (channel) conversationCacheRef.current.set(friend.id, {
          channelType: channel.type,
          channelId: channel.id,
          friend,
        });
        return {
          friend,
          channel,
          channelType: channel?.type || 'messaging',
          channelId: channel?.id || '',
          unreadCount: Math.max(0, Number(channel?.countUnread?.() || 0)),
          lastMessage: messagePreview(lastMessage),
          lastMessageAt: lastMessage?.created_at || channel?.data?.last_message_at || '',
        };
      });
      commitFriendConversations(nextConversations);
    } catch (error) {
      console.warn('Impossible de charger les conversations entre amis.', error);
    } finally {
      if (!silent) setAreFriendConversationsLoading(false);
    }
  }, [commitFriendConversations, ensureConnected, user?.id]);

  useEffect(() => {
    if (!client?.userID) return undefined;
    void refreshFriendConversations();
    const refresh = () => { void refreshFriendConversations({ silent: true }); };
    window.addEventListener('farmgestion-friends-updated', refresh);
    return () => window.removeEventListener('farmgestion-friends-updated', refresh);
  }, [client, refreshFriendConversations]);

  useEffect(() => {
    const currentUserId = String(user?.id || '').trim();
    if (!currentUserId) {
      void disconnect();
      return;
    }
    if (connectedUserIdRef.current && connectedUserIdRef.current !== currentUserId) {
      void disconnect().then(() => ensureConnected()).catch((error) => {
        console.warn('Connexion Stream différée.', error);
      });
      return;
    }
    void ensureConnected().catch((error) => {
      console.warn('Connexion Stream différée.', error);
    });
  }, [disconnect, ensureConnected, user?.id]);

  useEffect(() => {
    const closeBlockedConversation = (event) => {
      const blockedUserId = String(event.detail?.userId || '').trim();
      if (!blockedUserId) return;
      conversationCacheRef.current.delete(blockedUserId);
      commitFriendConversations(friendConversationsRef.current.filter((conversation) => conversation.friend?.id !== blockedUserId));
      const nextChats = chatsRef.current.filter((chat) => chat.friend?.id !== blockedUserId);
      chatsRef.current = nextChats;
      setChats(nextChats);
    };
    window.addEventListener('farmgestion-user-blocked', closeBlockedConversation);
    return () => window.removeEventListener('farmgestion-user-blocked', closeBlockedConversation);
  }, [commitFriendConversations]);

  useEffect(() => {
    if (!client?.userID) return undefined;

    const subscription = client.on((event) => {
      const isNewMessage = event.type === 'message.new' || event.type === 'notification.message_new';
      const isReadUpdate = event.type === 'message.read' || event.type === 'message.read_locally' || event.type === 'notification.mark_read';
      if (!isNewMessage && !isReadUpdate) return;

      const message = event.message;
      const senderId = String(message?.user?.id || message?.user_id || '').trim();
      const messageId = String(message?.id || '').trim();
      if (isNewMessage && messageId && lastIncomingMessageIdRef.current === messageId) return;
      if (isNewMessage && messageId) lastIncomingMessageIdRef.current = messageId;

      const cid = String(event.cid || event.channel?.cid || '').trim();
      const separatorIndex = cid.indexOf(':');
      const channelType = String(event.channel_type || event.channel?.type || (separatorIndex > 0 ? cid.slice(0, separatorIndex) : '')).trim();
      const channelId = String(event.channel_id || event.channel?.id || (separatorIndex > 0 ? cid.slice(separatorIndex + 1) : '')).trim();
      if (isReadUpdate && (!channelId || channelType !== 'messaging')) {
        if (event.unread_channels === 0) {
          commitFriendConversations(friendConversationsRef.current.map((conversation) => ({
            ...conversation,
            unreadCount: 0,
          })));
        }
        return;
      }
      if (channelType !== 'messaging' || !channelId || (isNewMessage && !senderId)) return;

      void (async () => {
        try {
          const channel = client.channel(channelType, channelId);
          if (!channel.initialized) await channel.watch({ presence: true });

          const memberIds = Object.keys(channel.state?.members || {});
          const friendId = memberIds.find((memberId) => memberId !== client.userID) || (senderId !== client.userID ? senderId : '');
          if (!memberIds.includes(client.userID) || !friendId) return;

          let existingConversation = friendConversationsRef.current.find((conversation) => conversation.friend?.id === friendId);
          if (!existingConversation) {
            const relation = await fetchRelationBetweenUsers(client.userID, friendId);
            if (relation?.status !== 'accepted') return;
          }

          const streamFriend = channel.state?.members?.[friendId]?.user || (senderId === friendId ? message?.user : {}) || {};
          const friend = {
            id: friendId,
            name: streamFriend.name || streamFriend.username || 'Ami',
            username: streamFriend.username || streamFriend.name || 'Ami',
            image: streamFriend.image || '',
          };
          conversationCacheRef.current.set(friendId, { channelType, channelId, friend });
          syncFriendConversationChannel(channel, existingConversation?.friend || friend, message);

          if (!isNewMessage || senderId === client.userID) return;
          existingConversation = friendConversationsRef.current.find((conversation) => conversation.friend?.id === friendId);
          const existingChat = chatsRef.current.find((chat) => chat.friend?.id === friendId);
          if (!existingChat || existingChat.isMinimized) {
            void restartAudioSafely(incomingMessageAudioRef.current);
          }
          if (existingChat) {
            const nextChats = chatsRef.current.map((chat) => (
              chat.friend?.id === friendId
                ? {
                    ...chat,
                    channel,
                    friend: existingConversation?.friend || friend,
                    unreadCount: chat.isMinimized ? Math.max(0, Number(channel.countUnread?.() || 0)) : 0,
                  }
                : chat
            ));
            chatsRef.current = nextChats;
            setChats(nextChats);
          } else {
            const nextChats = [
              ...chatsRef.current,
              {
                channel,
                friend: existingConversation?.friend || friend,
                isMinimized: false,
                unreadCount: 0,
              },
            ];
            chatsRef.current = nextChats;
            setChats(nextChats);
          }
        } catch (error) {
          console.warn('Impossible de synchroniser le nouveau message.', error);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, [client, commitFriendConversations, syncFriendConversationChannel]);

  const openChat = useCallback(async (friend) => {
    const friendUserId = String(friend?.id || '').trim();
    if (!friendUserId) throw new Error('Utilisateur destinataire invalide.');

    const existingChat = chatsRef.current.find((chat) => chat.friend?.id === friendUserId);
    if (!existingChat) {
      const loadingChat = { channel: null, friend, isLoading: true, isMinimized: false, unreadCount: 0 };
      const nextChats = [...chatsRef.current, loadingChat];
      chatsRef.current = nextChats;
      setChats(nextChats);
    } else if (existingChat.isMinimized) {
      const nextChats = chatsRef.current.map((chat) => (
        chat.friend?.id === friendUserId ? { ...chat, isMinimized: false, unreadCount: 0 } : chat
      ));
      chatsRef.current = nextChats;
      setChats(nextChats);
    }

    setIsOpening(true);
    try {
      const cachedConversation = conversationCacheRef.current.get(friendUserId);
      let [streamClient, conversation] = await Promise.all([
        ensureConnected(),
        cachedConversation ? Promise.resolve(cachedConversation) : openStreamConversation(friendUserId),
      ]);
      let channel = streamClient.channel(conversation.channelType, conversation.channelId);
      try {
        if (!channel.initialized) await channel.watch({ presence: true });
      } catch (error) {
        if (!isMissingStreamTokenError(error)) throw error;
        clientRef.current = null;
        connectPromiseRef.current = null;
        connectedUserIdRef.current = '';
        setClient(null);
        streamClient = await ensureConnected();
        channel = streamClient.channel(conversation.channelType, conversation.channelId);
        if (!channel.initialized) await channel.watch({ presence: true });
      }
      conversationCacheRef.current.set(friendUserId, conversation);
      try {
        await channel.markRead();
      } catch (error) {
        console.warn('Impossible de marquer la conversation comme lue.', error);
      }
      const nextChat = {
        channel,
        friend: conversation.friend || friend,
        isMinimized: false,
        unreadCount: 0,
      };
      const alreadyOpen = chatsRef.current.some((chat) => chat.friend?.id === friendUserId);
      const nextChats = alreadyOpen
        ? chatsRef.current.map((chat) => (chat.friend?.id === friendUserId ? nextChat : chat))
        : [...chatsRef.current, nextChat];
      chatsRef.current = nextChats;
      setChats(nextChats);
      syncFriendConversationChannel(channel, conversation.friend || friend);
      markFriendConversationRead(friendUserId);
      return channel;
    } catch (error) {
      const nextChats = chatsRef.current.filter((chat) => !(chat.friend?.id === friendUserId && chat.isLoading));
      chatsRef.current = nextChats;
      setChats(nextChats);
      throw error;
    } finally {
      setIsOpening(false);
    }
  }, [ensureConnected, markFriendConversationRead, syncFriendConversationChannel]);

  const closeChat = useCallback((friendUserId) => {
    const nextChats = chatsRef.current.filter((chat) => chat.friend?.id !== friendUserId);
    chatsRef.current = nextChats;
    setChats(nextChats);
  }, []);
  const minimizeChat = useCallback((friendUserId) => {
    const nextChats = chatsRef.current.map((chat) => (
      chat.friend?.id === friendUserId ? { ...chat, isMinimized: true, unreadCount: 0 } : chat
    ));
    chatsRef.current = nextChats;
    setChats(nextChats);
  }, []);
  const restoreChat = useCallback((friendUserId) => {
    const nextChats = chatsRef.current.map((chat) => (
      chat.friend?.id === friendUserId ? { ...chat, isMinimized: false, unreadCount: 0 } : chat
    ));
    chatsRef.current = nextChats;
    setChats(nextChats);
    const conversation = friendConversationsRef.current.find((entry) => entry.friend?.id === friendUserId);
    if (conversation?.channel) {
      void conversation.channel.markRead().catch((error) => {
        console.warn('Impossible de marquer la conversation restaurée comme lue.', error);
      });
    }
    markFriendConversationRead(friendUserId);
  }, [markFriendConversationRead]);
  const blockChatUser = useCallback(async (friendUserIdValue) => {
    const friendUserId = String(friendUserIdValue || '').trim();
    const currentUserId = String(user?.id || '').trim();
    if (!currentUserId || !friendUserId || blockingUserId) return;

    setBlockingUserId(friendUserId);
    try {
      await blockRelation(currentUserId, friendUserId);
      conversationCacheRef.current.delete(friendUserId);
      const nextChats = chatsRef.current.filter((chat) => chat.friend?.id !== friendUserId);
      chatsRef.current = nextChats;
      setChats(nextChats);
      window.dispatchEvent(new CustomEvent('farmgestion-user-blocked', {
        detail: { userId: friendUserId },
      }));
      window.dispatchEvent(new CustomEvent('farmgestion-toast', {
        detail: { type: 'success', message: 'Utilisateur bloqué.' },
      }));
    } catch (error) {
      console.error('Impossible de bloquer cet utilisateur depuis la messagerie.', error);
      window.dispatchEvent(new CustomEvent('farmgestion-toast', {
        detail: { type: 'error', message: 'Impossible de bloquer cet utilisateur.' },
      }));
    } finally {
      setBlockingUserId('');
    }
  }, [blockingUserId, user?.id]);

  const unreadMessagesCount = useMemo(
    () => friendConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unreadCount || 0)), 0),
    [friendConversations],
  );

  const value = useMemo(
    () => ({
      client,
      chats,
      friendConversations,
      unreadMessagesCount,
      areFriendConversationsLoading,
      blockingUserId,
      isOpening,
      ensureConnected,
      refreshFriendConversations,
      openChat,
      closeChat,
      minimizeChat,
      restoreChat,
      blockChatUser,
    }),
    [
      client,
      chats,
      friendConversations,
      unreadMessagesCount,
      areFriendConversationsLoading,
      blockingUserId,
      isOpening,
      ensureConnected,
      refreshFriendConversations,
      openChat,
      closeChat,
      minimizeChat,
      restoreChat,
      blockChatUser,
    ],
  );

  return (
    <ChatDockContext.Provider value={value}>
      {children}
      <ChatDock />
    </ChatDockContext.Provider>
  );
}
