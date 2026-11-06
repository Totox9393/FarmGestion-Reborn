import { useEffect, useMemo, useState } from 'react';
import { useChatDock } from './chatDockContext';

const STREAM_USERS_PAGE_SIZE = 100;
const EMPTY_AVATAR_URLS = Object.freeze({});

const normalizeUserIds = (userIds) => Array.from(
  new Set((userIds || []).map((userId) => String(userId || '').trim()).filter(Boolean)),
).sort();

export default function useStreamAvatarUrls(userIds) {
  const { ensureConnected } = useChatDock();
  const userIdsKey = useMemo(() => normalizeUserIds(userIds).join(','), [userIds]);
  const [avatarUrlsById, setAvatarUrlsById] = useState({});

  useEffect(() => {
    let isCancelled = false;
    let unsubscribe = null;
    const requestedUserIds = userIdsKey ? userIdsKey.split(',') : [];

    if (!requestedUserIds.length) {
      return undefined;
    }

    const requestedUserIdSet = new Set(requestedUserIds);

    const loadStreamAvatars = async () => {
      try {
        const streamClient = await ensureConnected();
        const nextAvatarUrlsById = {};

        for (let index = 0; index < requestedUserIds.length; index += STREAM_USERS_PAGE_SIZE) {
          const userIdChunk = requestedUserIds.slice(index, index + STREAM_USERS_PAGE_SIZE);
          const response = await streamClient.queryUsers(
            { id: { $in: userIdChunk } },
            [],
            { limit: userIdChunk.length },
          );

          (response?.users || []).forEach((streamUser) => {
            const streamUserId = String(streamUser?.id || '').trim();
            const streamAvatarUrl = String(streamUser?.image || '').trim();
            if (streamUserId && streamAvatarUrl) nextAvatarUrlsById[streamUserId] = streamAvatarUrl;
          });
        }

        if (isCancelled) return;
        setAvatarUrlsById(nextAvatarUrlsById);

        const subscription = streamClient.on('user.updated', (event) => {
          const streamUserId = String(event?.user?.id || '').trim();
          if (!requestedUserIdSet.has(streamUserId)) return;

          const streamAvatarUrl = String(event?.user?.image || '').trim();
          setAvatarUrlsById((current) => {
            const next = { ...current };
            if (streamAvatarUrl) next[streamUserId] = streamAvatarUrl;
            else delete next[streamUserId];
            return next;
          });
        });
        unsubscribe = () => subscription.unsubscribe();
      } catch (error) {
        if (!isCancelled) {
          console.warn('Impossible de charger les avatars Stream, utilisation des avatars de profil.', error);
          setAvatarUrlsById({});
        }
      }
    };

    loadStreamAvatars();

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [ensureConnected, userIdsKey]);

  return userIdsKey ? avatarUrlsById : EMPTY_AVATAR_URLS;
}
