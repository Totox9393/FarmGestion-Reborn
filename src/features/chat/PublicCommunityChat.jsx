import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Channel,
  Chat,
  ContextMenuButton,
  defaultMessageActionSet,
  MessageActions,
  MessageList,
  MessageUI,
  useChannelActionContext,
  useChannelStateContext,
  useChatContext,
  useContextMenuContext,
  useCooldownRemaining,
  useMessageContext,
  WithComponents,
} from 'stream-chat-react';
import { AtSign, Check, Clock3, LoaderCircle, MessageCircle, MoreHorizontal, Pin, PinOff, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatDock } from './chatDockContext';
import { moderatePublicStreamChannel, openPublicStreamChannel } from './streamApi';
import {
  FarmAttachment,
  FarmAttachmentSelector,
  FarmQuotedMessage,
  FarmQuotedMessagePreview,
  ImageOnlyMessageComposer,
  QuickQuoteAction,
} from './ChatDock';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import { getLocalThemePreference } from '../settings/themePreferences';
import { supabase } from '../authentification/supabaseClient';
import './PublicCommunityChat.css';

const PublicModerationContext = createContext({
  canModerate: false,
  mutedUsers: {},
  setMutedUser: () => {},
});
const toast = (type, message) => window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

const muteEntriesToMap = (entries) => Object.fromEntries(
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.userId && entry?.expiresAt && new Date(entry.expiresAt).getTime() > Date.now())
    .map((entry) => [String(entry.userId), String(entry.expiresAt)]),
);

const calculateRemainingSeconds = (expiresAt) => Math.max(
  0,
  Math.ceil((new Date(expiresAt || 0).getTime() - Date.now()) / 1000),
);

function useRemainingSeconds(expiresAt) {
  const [remaining, setRemaining] = useState(() => calculateRemainingSeconds(expiresAt));

  useEffect(() => {
    const update = () => setRemaining(calculateRemainingSeconds(expiresAt));
    update();
    if (!expiresAt) return undefined;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

const formatRemainingTime = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const formatCooldownTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  return `${Math.floor(safeSeconds / 60)}min ${String(safeSeconds % 60).padStart(2, '0')}s`;
};

function PublicCooldownTimer() {
  const remainingSeconds = useCooldownRemaining();
  return (
    <div
      className="str-chat__message-composer-cooldown community-public-chat__cooldown-timer"
      data-testid="cooldown-timer"
      role="timer"
      aria-label={`Prochain message dans ${formatCooldownTime(remainingSeconds)}`}
    >
      <Clock3 size={14} />
      <span>{formatCooldownTime(remainingSeconds)}</span>
    </div>
  );
}

const buildAvatarCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw) || !SUPABASE_URL) return [raw];
  const candidates = [raw];
  if (raw.startsWith('/storage/v1/object/public/')) candidates.push(`${SUPABASE_URL}${raw}`);
  else if (raw.startsWith('storage/v1/object/public/')) candidates.push(`${SUPABASE_URL}/${raw}`);
  else if (raw.startsWith('/')) candidates.push(`${SUPABASE_URL}${raw}`, `${SUPABASE_URL}/${raw.replace(/^\/+/, '')}`);
  else if (raw.includes('/')) candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw}`);
  else {
    candidates.push(
      `${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`,
      `${SUPABASE_URL}/storage/v1/object/public/ressources/${raw}`,
    );
  }
  return Array.from(new Set(candidates));
};

function ModeratorDeleteAction() {
  const { canModerate } = useContext(PublicModerationContext);
  const { client } = useChatContext();
  const { message } = useMessageContext();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!canModerate || message?.user?.id === client.userID) return null;

  const remove = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setLoading(true);
    try {
      await moderatePublicStreamChannel({ action: 'delete', messageId: message.id });
      toast('success', 'Message supprimé par la modération.');
    } catch (error) {
      toast('error', error.message || 'Suppression impossible.');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ContextMenuButton
      className="fg-public-moderation-action"
      disabled={loading}
      Icon={loading ? LoaderCircle : Trash2}
      onClick={remove}
      variant="destructive"
    >
      {loading ? 'Suppression…' : confirming ? 'Confirmer la suppression' : 'Supprimer (modération)'}
    </ContextMenuButton>
  );
}

function ModeratorMuteAction() {
  const moderation = useContext(PublicModerationContext);
  const { client } = useChatContext();
  const { message } = useMessageContext();
  const { closeMenu } = useContextMenuContext();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const targetUserId = String(message?.user?.id || '');
  const remainingSeconds = useRemainingSeconds(moderation.mutedUsers[targetUserId]);
  const isMuted = remainingSeconds > 0;
  if (!moderation.canModerate || !targetUserId || targetUserId === client.userID) return null;

  const toggleMute = async () => {
    if (!isMuted && !confirming) {
      setConfirming(true);
      return;
    }
    setLoading(true);
    try {
      if (isMuted) {
        await moderatePublicStreamChannel({ action: 'unmute', targetUserId });
        moderation.setMutedUser(targetUserId, null);
        toast('success', `La sourdine de ${message.user.name || 'cet utilisateur'} a été retirée.`);
      } else {
        const result = await moderatePublicStreamChannel({ action: 'mute', targetUserId, durationMinutes: 60 });
        moderation.setMutedUser(targetUserId, result.expiresAt);
        toast('success', `${message.user.name || 'Utilisateur'} est en sourdine pendant 1 heure.`);
      }
      closeMenu();
    } catch (error) {
      toast('error', error.message || (isMuted ? 'Retrait de la sourdine impossible.' : 'Mise en sourdine impossible.'));
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ContextMenuButton
      className="fg-public-moderation-action"
      disabled={loading}
      Icon={isMuted ? Volume2 : VolumeX}
      onClick={toggleMute}
    >
      {loading
        ? 'Mise à jour…'
        : isMuted
          ? `Retirer la sourdine (${formatRemainingTime(remainingSeconds)})`
          : confirming ? 'Confirmer : 1 heure' : 'Mettre en sourdine (1 h)'}
    </ContextMenuButton>
  );
}

function ModeratorPinAction() {
  const { canModerate } = useContext(PublicModerationContext);
  const { message } = useMessageContext();
  const [loading, setLoading] = useState(false);
  if (!canModerate) return null;
  const isPinned = Boolean(message?.pinned);

  const togglePin = async () => {
    setLoading(true);
    try {
      await moderatePublicStreamChannel({ action: isPinned ? 'unpin' : 'pin', messageId: message.id });
      toast('success', isPinned ? 'Message désépinglé.' : 'Message épinglé en haut du salon.');
    } catch (error) {
      toast('error', error.message || 'Épinglage impossible.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ContextMenuButton
      className="fg-public-moderation-action"
      disabled={loading}
      Icon={isPinned ? PinOff : Pin}
      onClick={togglePin}
    >
      {loading ? 'Mise à jour…' : isPinned ? 'Désépingler le message' : 'Épingler le message'}
    </ContextMenuButton>
  );
}

const publicMessageActionSet = [
  ...defaultMessageActionSet
    .filter((action) => (
      action.type !== 'flag' &&
      action.type !== 'blockUser' &&
      action.type !== 'mute' &&
      action.type !== 'pin' &&
      !(action.type === 'reply' && action.placement === 'dropdown')
    ))
    .map((action) => (
      action.type === 'reply' && action.placement === 'quick'
        ? { ...action, type: 'quote', Component: QuickQuoteAction }
        : action
    )),
  { type: 'fgModeratorPin', placement: 'dropdown', Component: ModeratorPinAction },
  { type: 'fgModeratorMute', placement: 'dropdown', Component: ModeratorMuteAction },
  { type: 'fgModeratorDelete', placement: 'dropdown', Component: ModeratorDeleteAction },
];

function PublicMessageActions() {
  return <MessageActions messageActionSet={publicMessageActionSet} />;
}

function FarmPublicAvatar({ className = '', id: userId, imageUrl, userName, onClick, size, ...buttonProps }) {
  const avatarSource = String(imageUrl || '').trim();
  const candidates = useMemo(() => buildAvatarCandidates(avatarSource), [avatarSource]);
  const [failure, setFailure] = useState({ source: avatarSource, index: 0 });
  const candidateIndex = failure.source === avatarSource ? failure.index : 0;
  const src = candidates[candidateIndex] || defaultProfileUser;
  return (
    <button
      {...buttonProps}
      type="button"
      className={`str-chat__avatar fg-public-avatar ${className}`.trim()}
      data-avatar-size={size}
      data-user-id={userId}
      onClick={onClick}
      title={`Voir le profil de ${userName || 'cet utilisateur'}`}
    >
      <img
        src={src}
        alt={userName ? `Photo de profil de ${userName}` : ''}
        onError={() => {
          setFailure({ source: avatarSource, index: candidateIndex + 1 });
        }}
      />
    </button>
  );
}

function FarmPublicMessageUI(props) {
  const navigate = useNavigate();
  const { client } = useChatContext();
  const { message } = useMessageContext();
  const username = String(message?.user?.username || message?.user?.name || '').trim();
  const isMentioned = Boolean(message?.mentioned_users?.some((user) => user.id === client.userID));
  return (
    <>
      {username ? (
        <button
          type="button"
          className="fg-public-message-author"
          onClick={() => navigate(`/community/profile/${encodeURIComponent(username)}`)}
          title={`Voir le profil de ${username}`}
        >
          {username}
        </button>
      ) : null}
      <MessageUI {...props} showAvatar highlighted={Boolean(props.highlighted || isMentioned)} />
    </>
  );
}

function mentionHue(userId) {
  let hash = 0;
  for (const character of String(userId || 'farmgestion')) hash = ((hash << 5) - hash) + character.charCodeAt(0);
  return Math.abs(hash) % 360;
}

const mentionPalette = ['#6554d9', '#c43d72', '#087f8c', '#b05218', '#287a42', '#9a3fc4', '#1769aa', '#b23a34'];
const mentionColor = (userId) => mentionPalette[mentionHue(userId) % mentionPalette.length];

function PublicMessageComposer({ mutedUntil }) {
  const remainingSeconds = useRemainingSeconds(mutedUntil);
  if (remainingSeconds <= 0) return <ImageOnlyMessageComposer mentionAllAppUsers />;

  return (
    <div className="community-public-chat__muted-composer" role="status" aria-live="polite">
      <VolumeX size={19} />
      <span>Vous avez été mis en sourdine. Temps restant : <strong>{formatRemainingTime(remainingSeconds)}</strong></span>
    </div>
  );
}

const publicMessageSummary = (message) => {
  const text = String(message?.text || '').trim();
  if (text) return text.slice(0, 110);
  const betail = message?.attachments?.find((attachment) => attachment.type === 'fg_betail');
  if (betail) return `Profil bétail · ${betail.fg_betail_name || 'Bétail sans nom'}`;
  return 'Message avec pièce jointe';
};

function ConversationOptionsMenu({ channel, client, canClear, canModerate, cooldown, onClose, onCooldownChange, onJump }) {
  const [mentions, setMentions] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState(() => [...(channel.state.pinnedMessages || [])]);
  const [activeTab, setActiveTab] = useState('mentions');
  const [loading, setLoading] = useState(true);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [slowModeSelecting, setSlowModeSelecting] = useState(false);
  const [slowModeLoading, setSlowModeLoading] = useState(false);
  const [customCooldown, setCustomCooldown] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await client.search(
          { cid: channel.cid },
          { mentioned_users: { $contains: client.userID } },
          { limit: 30, sort: [{ created_at: -1 }] },
        );
        if (active) setMentions(response.results?.map((result) => result.message).filter(Boolean) || []);
      } catch {
        if (active) {
          setMentions(channel.state.messages.filter((message) => (
            message.mentioned_users?.some((user) => user.id === client.userID)
          )).reverse());
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [channel, client]);

  useEffect(() => {
    const syncPinnedMessages = () => setPinnedMessages([...(channel.state.pinnedMessages || [])]);
    syncPinnedMessages();
    const subscription = channel.on((event) => {
      if (event.type === 'message.updated' || event.type === 'message.deleted' || event.type === 'channel.truncated') {
        syncPinnedMessages();
      }
    });
    return () => subscription.unsubscribe();
  }, [channel]);

  const clearConversation = async () => {
    if (!clearConfirming) {
      setClearConfirming(true);
      return;
    }
    setClearing(true);
    try {
      await moderatePublicStreamChannel({ action: 'truncate' });
      toast('success', 'La conversation publique a été vidée pour tout le monde.');
      onClose();
    } catch (error) {
      toast('error', error.message || 'Impossible de vider la conversation.');
      setClearConfirming(false);
    } finally {
      setClearing(false);
    }
  };

  const updateSlowMode = async (nextCooldown) => {
    const parsedCooldown = Number(nextCooldown);
    if (nextCooldown !== 0 && (!Number.isInteger(parsedCooldown) || parsedCooldown < 1 || parsedCooldown > 60)) {
      toast('error', 'Saisissez une durée comprise entre 1 et 60 secondes.');
      return;
    }
    setSlowModeLoading(true);
    try {
      const disabling = nextCooldown === 0;
      const result = await moderatePublicStreamChannel({
        action: disabling ? 'disable_slow_mode' : 'slow_mode',
        ...(disabling ? {} : { cooldownSeconds: parsedCooldown }),
      });
      const appliedCooldown = Math.max(0, Number(result.cooldown || 0));
      onCooldownChange(appliedCooldown);
      setSlowModeSelecting(false);
      setCustomCooldown('');
      toast(
        'success',
        disabling
          ? 'Le mode lent a été désactivé.'
          : `Le mode lent est actif : ${appliedCooldown} seconde${appliedCooldown > 1 ? 's' : ''} entre les messages.`,
      );
    } catch (error) {
      toast('error', error.message || 'Impossible de modifier le mode lent.');
    } finally {
      setSlowModeLoading(false);
    }
  };

  return (
    <div className="community-public-chat__mentions-menu" role="dialog" aria-label="Options de la conversation">
      <div className="community-public-chat__mentions-title">
        <span><MoreHorizontal size={16} /> Conversation</span>
        <button type="button" onClick={onClose} aria-label="Fermer les options"><X size={16} /></button>
      </div>
      <div className="community-public-chat__options-tabs" role="tablist" aria-label="Contenu de la conversation">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mentions'}
          onClick={() => setActiveTab('mentions')}
        >
          <AtSign size={14} /> Mentions ({mentions.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pinned'}
          onClick={() => setActiveTab('pinned')}
        >
          <Pin size={14} /> Messages épinglés ({pinnedMessages.length})
        </button>
      </div>
      {activeTab === 'mentions' ? (
        <div className="community-public-chat__mentions-list" role="tabpanel">
          {loading ? <p>Chargement…</p> : null}
          {!loading && !mentions.length ? <p>Vous n’avez aucune mention.</p> : null}
          {mentions.map((message) => (
            <button key={message.id} type="button" onClick={() => onJump(message.id)}>
              <strong>{message.user?.name || 'Utilisateur'}</strong>
              <span>{publicMessageSummary(message)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="community-public-chat__mentions-list" role="tabpanel">
          {!pinnedMessages.length ? <p>Aucun message épinglé.</p> : null}
          {pinnedMessages.map((message) => (
            <button key={message.id} type="button" onClick={() => onJump(message.id)}>
              <strong>{message.user?.name || 'Utilisateur'}</strong>
              <span>{publicMessageSummary(message)}</span>
            </button>
          ))}
        </div>
      )}
      {canClear || canModerate ? (
        <div className="community-public-chat__admin-options">
          <div className="community-public-chat__staff-actions">
            {canClear ? (
              <button
                type="button"
                className={`community-public-chat__clear-action ${clearConfirming ? 'is-confirming' : ''}`}
                disabled={clearing || slowModeLoading}
                onClick={clearConversation}
              >
                {clearing ? <LoaderCircle className="is-spinning" size={16} /> : <Trash2 size={16} />}
                {clearing ? 'Suppression…' : clearConfirming ? 'Confirmer : vider' : 'Vider la conversation'}
              </button>
            ) : null}
            {canModerate && cooldown > 0 ? (
              <button
                type="button"
                className="community-public-chat__slow-mode-action is-active"
                disabled={slowModeLoading || clearing}
                onClick={() => { void updateSlowMode(0); }}
              >
                {slowModeLoading ? <LoaderCircle className="is-spinning" size={16} /> : <Clock3 size={16} />}
                Désactiver le mode lent ({formatCooldownTime(cooldown)})
              </button>
            ) : null}
            {canModerate && cooldown <= 0 && !slowModeSelecting ? (
              <button
                type="button"
                className="community-public-chat__slow-mode-action"
                disabled={slowModeLoading || clearing}
                onClick={() => setSlowModeSelecting(true)}
              >
                <Clock3 size={16} /> Mode lent
              </button>
            ) : null}
          </div>
          {canModerate && cooldown <= 0 && slowModeSelecting ? (
            <div className="community-public-chat__slow-mode-presets" aria-label="Choisir la durée du mode lent">
              <button type="button" disabled={slowModeLoading} onClick={() => { void updateSlowMode(3); }}>3s</button>
              <button type="button" disabled={slowModeLoading} onClick={() => { void updateSlowMode(5); }}>5s</button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void updateSlowMode(customCooldown);
                }}
              >
                <input
                  type="number"
                  min="1"
                  max="60"
                  inputMode="numeric"
                  value={customCooldown}
                  disabled={slowModeLoading}
                  onChange={(event) => setCustomCooldown(event.target.value)}
                  placeholder="?"
                  aria-label="Durée personnalisée entre 1 et 60 secondes"
                />
                <span>s</span>
                <button type="submit" disabled={slowModeLoading || !customCooldown} aria-label="Activer la durée personnalisée">
                  {slowModeLoading ? <LoaderCircle className="is-spinning" size={14} /> : <Check size={14} />}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PinnedMessagesDock() {
  const { channel } = useChannelStateContext();
  const { jumpToMessage } = useChannelActionContext();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!channel) return undefined;
    const subscription = channel.on((event) => {
      if (event.type === 'message.updated' || event.type === 'message.deleted') setTick((value) => value + 1);
    });
    return () => subscription.unsubscribe();
  }, [channel]);

  const pinnedMessages = channel?.state?.pinnedMessages || [];
  if (!pinnedMessages.length) return null;
  const message = pinnedMessages[0];
  const summary = publicMessageSummary(message);

  return (
    <button type="button" className="community-public-chat__pinned" onClick={() => jumpToMessage(message.id)}>
      <Pin size={15} />
      <span><strong>Message épinglé</strong><small>{message.user?.name || 'Utilisateur'} · {summary}</small></span>
      {pinnedMessages.length > 1 ? <em>+{pinnedMessages.length - 1}</em> : null}
    </button>
  );
}

function ChannelJumpBridge({ jumpRef }) {
  const { jumpToMessage } = useChannelActionContext();
  useEffect(() => {
    jumpRef.current = jumpToMessage;
    return () => { jumpRef.current = null; };
  }, [jumpRef, jumpToMessage]);
  return null;
}

export default function PublicCommunityChat({ avatarProfiles = [] }) {
  const navigate = useNavigate();
  const { ensureConnected } = useChatDock();
  const [state, setState] = useState({ channel: null, client: null, canModerate: false, canClear: false, cooldown: 0, error: '' });
  const [mutedUsers, setMutedUsers] = useState({});
  const [mentionsOpen, setMentionsOpen] = useState(false);
  const [theme, setTheme] = useState(getLocalThemePreference);
  const [messageAuthorProfiles, setMessageAuthorProfiles] = useState([]);
  const streamRef = useRef(null);
  const jumpToMessageRef = useRef(null);
  const isDarkChat = ['dark', 'galactic'].includes(theme);

  useEffect(() => {
    const refreshTheme = () => setTheme(getLocalThemePreference());
    window.addEventListener('farmgestion-theme-change', refreshTheme);
    window.addEventListener('storage', refreshTheme);
    return () => {
      window.removeEventListener('farmgestion-theme-change', refreshTheme);
      window.removeEventListener('storage', refreshTheme);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let watchedChannel = null;
    void (async () => {
      try {
        const [client, config] = await Promise.all([ensureConnected(), openPublicStreamChannel()]);
        const channel = client.channel(config.channelType, config.channelId);
        await channel.watch();
        watchedChannel = channel;
        if (active) {
          setMutedUsers(muteEntriesToMap(config.mutedUsers));
          setState({
            channel,
            client,
            canModerate: Boolean(config.canModerate),
            canClear: Boolean(config.canClear),
            cooldown: Math.max(0, Number(channel.data?.cooldown ?? config.cooldown ?? 0)),
            error: '',
          });
        }
      } catch (error) {
        if (active) {
          setMutedUsers({});
          setState({ channel: null, client: null, canModerate: false, canClear: false, cooldown: 0, error: error.message || 'Salon indisponible.' });
        }
      }
    })();
    return () => {
      active = false;
      void watchedChannel?.stopWatching?.();
    };
  }, [ensureConnected]);

  useEffect(() => {
    const channel = state.channel;
    const client = state.client;
    if (!channel || !client) return undefined;
    let active = true;

    const refreshMuteStatus = async () => {
      try {
        const result = await moderatePublicStreamChannel({ action: 'status' });
        if (active) setMutedUsers(muteEntriesToMap(result.mutedUsers));
      } catch {
        // L'état local et son compteur restent utilisables en cas de coupure passagère.
      }
    };

    const subscription = channel.on((event) => {
      if (event.type !== 'user.banned' && event.type !== 'user.unbanned') return;
      const affectedUserId = String(event.user?.id || event.user_id || '');
      if (affectedUserId) {
        setMutedUsers((current) => {
          const next = { ...current };
          if (event.type === 'user.unbanned') delete next[affectedUserId];
          else next[affectedUserId] = new Date(Date.now() + 60 * 60_000).toISOString();
          return next;
        });
      }
      void refreshMuteStatus();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [state.channel, state.client]);

  useEffect(() => {
    const channel = state.channel;
    if (!channel) return undefined;
    const syncCooldown = (event) => {
      const nextCooldown = Math.max(0, Number(event?.channel?.cooldown ?? channel.data?.cooldown ?? 0));
      setState((current) => ({ ...current, cooldown: nextCooldown }));
    };
    const subscription = channel.on('channel.updated', syncCooldown);
    return () => subscription.unsubscribe();
  }, [state.channel]);

  useEffect(() => {
    const channel = state.channel;
    if (!channel) return undefined;
    let active = true;
    const loadAvatars = async () => {
      const userIds = Array.from(new Set(channel.state.messages.map((message) => message.user?.id).filter(Boolean)));
      if (!userIds.length) return;
      const { data } = await supabase.from('users_profiles').select('id,username,avatar_url').in('id', userIds);
      if (!active || !data) return;
      setMessageAuthorProfiles(data.map((profile) => ({
        id: profile.id,
        username: profile.username,
        avatarUrl: profile.avatar_url,
      })));
    };
    void loadAvatars();
    const subscription = channel.on('message.new', () => { void loadAvatars(); });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [state.channel]);

  const avatarDirectory = useMemo(() => {
    const byId = {};
    const byName = {};
    const register = (profile) => {
      const id = String(profile?.id || '').trim();
      const username = String(profile?.username || '').trim();
      const avatarUrl = String(profile?.avatarUrl || profile?.avatar_url || '').trim();
      if (!avatarUrl) return;
      if (id) byId[id] = { avatarUrl, username };
      if (username) byName[username.toLowerCase()] = { avatarUrl, username };
    };

    messageAuthorProfiles.forEach(register);
    avatarProfiles.forEach(register);
    return { byId, byName };
  }, [avatarProfiles, messageAuthorProfiles]);

  const moderationContextValue = useMemo(() => ({
    canModerate: state.canModerate,
    mutedUsers,
    setMutedUser: (userId, expiresAt) => {
      setMutedUsers((current) => {
        const next = { ...current };
        if (expiresAt) next[String(userId)] = String(expiresAt);
        else delete next[String(userId)];
        return next;
      });
    },
  }), [mutedUsers, state.canModerate]);

  const currentUserMuteExpiresAt = state.client?.userID ? mutedUsers[state.client.userID] : null;

  const overrides = useMemo(() => ({
    Attachment: FarmAttachment,
    AttachmentSelector: FarmAttachmentSelector,
    Avatar: FarmPublicAvatar,
    CooldownTimer: PublicCooldownTimer,
    extractDisplayInfo: ({ user: streamUser }) => {
      const userId = String(streamUser?.id || '').trim();
      const streamUsername = String(streamUser?.username || streamUser?.name || '').trim();
      const profile = avatarDirectory.byId[userId] || avatarDirectory.byName[streamUsername.toLowerCase()];
      return {
        id: streamUser?.id,
        imageUrl: profile?.avatarUrl || streamUser?.image,
        userName: profile?.username || streamUsername || userId,
      };
    },
    MessageActions: PublicMessageActions,
    MessageUI: FarmPublicMessageUI,
    QuotedMessage: FarmQuotedMessage,
    QuotedMessagePreview: FarmQuotedMessagePreview,
  }), [avatarDirectory]);

  const openUserProfile = (_event, streamUser) => {
    const username = String(streamUser?.username || streamUser?.name || '').trim();
    if (username) navigate(`/community/profile/${encodeURIComponent(username)}`);
  };

  const openProfileFromName = (event) => {
    const mentionElement = event.target.closest?.('.str-chat__message-mention[data-user-id]');
    if (mentionElement) {
      const streamUser = state.client?.state?.users?.[mentionElement.dataset.userId];
      const mentionUsername = String(streamUser?.username || streamUser?.name || '').trim();
      if (mentionUsername) navigate(`/community/profile/${encodeURIComponent(mentionUsername)}`);
      return;
    }
    const nameElement = event.target.closest?.('.str-chat__message-metadata__name');
    if (!nameElement) return;
    const username = String(nameElement.textContent || '').trim();
    if (username) navigate(`/community/profile/${encodeURIComponent(username)}`);
  };

  const openMentionProfile = (event, mentionedUsers) => {
    const userId = event.target.closest?.('.str-chat__message-mention')?.dataset?.userId;
    const user = mentionedUsers?.find((candidate) => candidate.id === userId) || mentionedUsers?.[0];
    const username = String(user?.username || user?.name || '').trim();
    if (username) navigate(`/community/profile/${encodeURIComponent(username)}`);
  };

  useEffect(() => {
    const container = streamRef.current;
    if (!container) return undefined;
    const colorMentions = () => {
      container.querySelectorAll('.str-chat__message-mention[data-user-id]').forEach((element) => {
        element.style.setProperty('--fg-mention-color', mentionColor(element.dataset.userId));
      });
    };
    colorMentions();
    const observer = new MutationObserver(colorMentions);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [state.channel]);

  return (
    <section className={`community-public-chat ${isDarkChat ? 'is-dark' : ''}`} aria-label="Conversation publique FarmGestion">
      <header className="community-public-chat__header">
        <span className="community-public-chat__icon"><MessageCircle size={20} /></span>
        <div>
          <p>Grace Field House - Conversation publique</p>
          <span>Découvrez les différents membres de la communauté</span>
        </div>
        {state.canModerate ? <strong>Modération active</strong> : null}
        <button
          type="button"
          className="community-public-chat__more"
          aria-label="Options de la conversation"
          aria-expanded={mentionsOpen}
          onClick={() => setMentionsOpen((open) => !open)}
        >
          <MoreHorizontal size={20} />
        </button>
        {mentionsOpen && state.client && state.channel ? (
          <ConversationOptionsMenu
            channel={state.channel}
            client={state.client}
            canClear={state.canClear}
            canModerate={state.canModerate}
            cooldown={state.cooldown}
            onClose={() => setMentionsOpen(false)}
            onCooldownChange={(cooldown) => setState((current) => ({ ...current, cooldown }))}
            onJump={(messageId) => {
              setMentionsOpen(false);
              void jumpToMessageRef.current?.(messageId);
            }}
          />
        ) : null}
      </header>

      {state.error ? <p className="community-public-chat__state is-error">{state.error}</p> : null}
      {!state.error && (!state.client || !state.channel) ? <p className="community-public-chat__state">Connexion au salon…</p> : null}
      {state.client && state.channel ? (
        <PublicModerationContext.Provider value={moderationContextValue}>
          <div ref={streamRef} className={`fg-chat-dock community-public-chat__stream ${isDarkChat ? 'is-dark' : ''}`} onClick={openProfileFromName}>
            <Chat client={state.client} theme={isDarkChat ? 'str-chat__theme-dark' : 'str-chat__theme-light'}>
              <Channel channel={state.channel} onMentionsClick={openMentionProfile}>
                <WithComponents overrides={overrides}>
                  <div className="fg-chat-conversation">
                    <ChannelJumpBridge jumpRef={jumpToMessageRef} />
                    <PinnedMessagesDock />
                    <MessageList
                      disableDateSeparator
                      messageActions={['edit', 'delete', 'quote', 'react']}
                      onUserClick={openUserProfile}
                      openThread={() => {}}
                      showAvatar
                    />
                    <PublicMessageComposer mutedUntil={currentUserMuteExpiresAt} />
                  </div>
                </WithComponents>
              </Channel>
            </Chat>
          </div>
        </PublicModerationContext.Provider>
      ) : null}
    </section>
  );
}
