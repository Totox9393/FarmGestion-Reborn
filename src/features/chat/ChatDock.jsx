import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Attachment as StreamAttachment,
  AttachmentSelector,
  Channel,
  Chat,
  ContextMenuButton,
  defaultAttachmentSelectorActionSet,
  defaultMessageActionSet,
  MessageActions,
  MessageComposer,
  MessageList,
  MessageUI,
  QuotedMessagePreviewUI,
  QuickMessageActionsButton,
  TypingIndicator,
  useChannelActionContext,
  useContextMenuContext,
  useChannelStateContext,
  useMessageComposerController,
  useMessageComposerCommands,
  useMessageContext,
  useStateStore,
  WithComponents,
} from 'stream-chat-react';
import { createMentionsMiddleware, MentionsSearchSource } from 'stream-chat';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Baby, Beef, ChevronDown, LoaderCircle, MoreHorizontal, Pin, Reply, ShieldBan, Trash2, UserRound, X } from 'lucide-react';
import { getLocalThemePreference } from '../settings/themePreferences';
import { useAuth } from '../authentification/AuthContext';
import { useMyBetailsList } from '../betails/hooks';
import ProfileAvatarImage from '../utils/ProfileAvatarImage';
import { useChatDock } from './chatDockContext';
import 'stream-chat-react/css/index.css';
import './ChatDock.css';

const themeClassName = (theme) => (theme === 'light' ? '' : `${theme}_theme`);
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const absoluteBetailImage = (value) => {
  const raw = String(value || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/storage/')) return `${SUPABASE_URL}${raw}`;
  if (raw.startsWith('storage/')) return `${SUPABASE_URL}/${raw}`;
  if (raw.includes('/')) return `${SUPABASE_URL}/storage/v1/object/public/${raw.replace(/^\/+/, '')}`;
  return `${SUPABASE_URL}/storage/v1/object/public/betails/${raw}`;
};

const withBetailQuoteFallback = (message) => {
  if (!message || String(message.text || '').trim()) return message;
  const attachment = message.attachments?.find((item) => item?.type === 'fg_betail');
  if (!attachment) return message;

  const details = [
    attachment.fg_betail_name || 'Bétail sans nom',
    attachment.fg_betail_matricule || 'Sans matricule',
    attachment.fg_betail_age != null ? `${attachment.fg_betail_age} ans` : null,
  ].filter(Boolean);

  return { ...message, text: `Profil bétail · ${details.join(' · ')}` };
};

const quotedMessageSelector = (state) => ({ quotedMessage: state.quotedMessage });

function FarmPrivateAvatar({ className = '', id: userId, imageUrl, userName, onClick, size, ...buttonProps }) {
  return (
    <button
      {...buttonProps}
      type="button"
      className={`str-chat__avatar fg-chat-message-avatar ${className}`.trim()}
      data-avatar-size={size}
      data-user-id={userId}
      onClick={onClick}
      title={userName || 'Utilisateur'}
    >
      <ProfileAvatarImage
        avatarUrl={imageUrl}
        alt={userName ? `Photo de profil de ${userName}` : ''}
        className="str-chat__avatar-image"
        loading="lazy"
      />
    </button>
  );
}

function FarmPrivateMessageUI(props) {
  return <MessageUI {...props} showAvatar />;
}

const privateMessageSummary = (message) => {
  const text = String(message?.text || '').trim();
  if (text) return text.slice(0, 90);
  const betail = message?.attachments?.find((attachment) => attachment.type === 'fg_betail');
  if (betail) return `Profil bétail · ${betail.fg_betail_name || 'Bétail sans nom'}`;
  return 'Message avec pièce jointe';
};

export function FarmQuotedMessagePreview() {
  const messageComposer = useMessageComposerController();
  const { quotedMessage } = useStateStore(messageComposer.state, quotedMessageSelector);
  if (!quotedMessage) return null;

  return (
    <div className="str-chat__message-composer__quoted-message-preview-slot">
      <QuotedMessagePreviewUI
        quotedMessage={withBetailQuoteFallback(quotedMessage)}
        onRemove={() => messageComposer.setQuotedMessage(null)}
      />
    </div>
  );
}

export function FarmQuotedMessage({ renderText }) {
  const { message } = useMessageContext();
  const { jumpToMessage } = useChannelActionContext();
  const quotedMessage = message?.quoted_message;
  if (!quotedMessage) return null;

  return (
    <QuotedMessagePreviewUI
      quotedMessage={withBetailQuoteFallback(quotedMessage)}
      renderText={renderText}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        jumpToMessage?.(quotedMessage.id);
      }}
    />
  );
}

export function QuickQuoteAction() {
  const { message } = useMessageContext();
  const messageComposer = useMessageComposerController();

  const handleQuote = (event) => {
    const dock = event.currentTarget.closest('.fg-chat-dock');
    messageComposer.setQuotedMessage(message);
    window.requestAnimationFrame(() => {
      dock?.querySelector('.str-chat__textarea__textarea')?.focus();
    });
  };

  return (
    <QuickMessageActionsButton
      aria-label="Citer ce message"
      className="str-chat__message-reply-in-thread-button fg-chat-quick-quote"
      data-testid="quote-action"
      onClick={handleQuote}
      title="Citer ce message"
    >
      <Reply size={15} />
    </QuickMessageActionsButton>
  );
}

function ConfirmDeleteAction() {
  const { closeMenu } = useContextMenuContext();
  const { handleDelete } = useMessageContext();
  const [confirmationRequested, setConfirmationRequested] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClick = async () => {
    if (isDeleting) return;
    if (!confirmationRequested) {
      setConfirmationRequested(true);
      return;
    }

    setIsDeleting(true);
    try {
      await handleDelete();
      closeMenu();
    } catch (error) {
      console.error('Impossible de supprimer ce message.', error);
      setConfirmationRequested(false);
      window.dispatchEvent(new CustomEvent('farmgestion-toast', {
        detail: { type: 'error', message: 'Impossible de supprimer ce message.' },
      }));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ContextMenuButton
      aria-label={confirmationRequested ? 'Confirmer la suppression' : 'Supprimer le message'}
      className="str-chat__message-actions-list-item-button fg-chat-delete-action"
      disabled={isDeleting}
      Icon={isDeleting ? LoaderCircle : Trash2}
      onClick={handleClick}
      variant="destructive"
    >
      {isDeleting ? 'Suppression…' : confirmationRequested ? 'Confirmer' : 'Supprimer le message'}
    </ContextMenuButton>
  );
}

function BetailSelectorAction({ submenuItems }) {
  const { openSubmenu } = useContextMenuContext();
  return (
    <ContextMenuButton
      className="str-chat__attachment-selector-actions-menu__button fg-chat-betail-selector-action"
      hasSubMenu
      Icon={Baby}
      onClick={(event) => openSubmenu({
        focusReturnTarget: event.currentTarget,
        menuClassName: 'fg-chat-betail-submenu',
        Submenu: submenuItems,
      })}
    >
      Profil bétail
    </ContextMenuButton>
  );
}

function BetailSelectorSubmenu() {
  const { user } = useAuth();
  const { channel } = useChannelStateContext();
  const { closeMenu } = useContextMenuContext();
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useMyBetailsList({
    userId: user?.id,
    sort: 'recent',
    filter: 'all',
  });
  const betails = data?.pages?.flatMap((page) => page.items || []) || [];

  const sendBetail = async (betail) => {
    try {
      await channel.sendMessage({
        attachments: [{
          type: 'fg_betail',
          fg_betail_id: betail.id,
          fg_betail_name: betail.name || 'Bétail sans nom',
          fg_betail_image: absoluteBetailImage(betail.avatar_url),
          fg_betail_matricule: betail.matricule || '',
          fg_betail_age: Number.isFinite(Number(betail.age)) ? Number(betail.age) : null,
          fg_betail_premium: Boolean(betail.premium),
          fg_betail_description: String(betail.comments || '').trim(),
        }],
      });
      closeMenu();
    } catch (sendError) {
      console.error('Impossible d’envoyer le profil bétail.', sendError);
      window.dispatchEvent(new CustomEvent('farmgestion-toast', {
        detail: { type: 'error', message: 'Impossible d’envoyer le profil bétail.' },
      }));
    }
  };

  return (
    <div className="fg-chat-betail-picker">
      <strong className="fg-chat-betail-picker-title">Mes bétails</strong>
      <div className="fg-chat-betail-picker-list">
        {isLoading ? <span className="fg-chat-betail-picker-state">Chargement…</span> : null}
        {error ? <span className="fg-chat-betail-picker-state is-error">Impossible de charger les bétails.</span> : null}
        {!isLoading && !error && !betails.length ? <span className="fg-chat-betail-picker-state">Aucun bétail disponible.</span> : null}
        {betails.map((betail) => (
          <button type="button" key={betail.id} className="fg-chat-betail-picker-item" onClick={() => sendBetail(betail)}>
            <span className="fg-chat-betail-picker-avatar">
              {betail.avatar_url ? <img src={absoluteBetailImage(betail.avatar_url)} alt="" /> : <span className="fg-chat-betail-picker-fallback"><Baby size={16} /></span>}
            </span>
            <span><strong>{betail.name || 'Bétail sans nom'}</strong><small>#{betail.matricule || 'Sans matricule'}</small></span>
          </button>
        ))}
        {hasNextPage ? (
          <button type="button" className="fg-chat-betail-picker-more" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? 'Chargement…' : 'Afficher davantage'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FilteredCommandsSubmenu() {
  const { closeMenu } = useContextMenuContext();
  const messageComposer = useMessageComposerController();
  const commands = useMessageComposerCommands().filter(({ command }) => (
    !['mute', 'unmute'].includes(String(command?.name || '').toLowerCase())
  ));

  if (!commands.length) return <span className="fg-chat-command-state">Aucune commande disponible.</span>;

  return commands.map(({ command, enabled }) => (
    <ContextMenuButton
      key={command.name}
      className="str-chat__context-menu__button--command"
      details={`/${command.name}${command.args ? ` ${command.args}` : ''}`}
      disabled={!enabled}
      onClick={() => {
        if (!command.name || !enabled) return;
        messageComposer.textComposer.setCommand(command);
        closeMenu();
        window.requestAnimationFrame(() => {
          document.querySelector('.community-public-chat__stream .str-chat__textarea__textarea, .fg-chat-window .str-chat__textarea__textarea')?.focus();
        });
      }}
    >
      {command.name}
    </ContextMenuButton>
  ));
}

const farmAttachmentSelectorActionSet = [
  ...defaultAttachmentSelectorActionSet.map((action) => (
    action.type === 'selectCommand' ? { ...action, Submenu: FilteredCommandsSubmenu } : action
  )),
  { ActionButton: BetailSelectorAction, Submenu: BetailSelectorSubmenu, type: 'fgBetail' },
];

export function FarmAttachmentSelector() {
  return <AttachmentSelector attachmentSelectorActionSet={farmAttachmentSelectorActionSet} />;
}

export function FarmAttachment(props) {
  const [preview, setPreview] = useState(null);
  const isDarkPreview = ['dark', 'galactic'].includes(getLocalThemePreference());
  const farmAttachments = props.attachments.filter((attachment) => attachment.type === 'fg_betail');
  const regularAttachments = props.attachments.filter((attachment) => attachment.type !== 'fg_betail');

  useEffect(() => {
    if (!preview) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  return (
    <>
      {regularAttachments.length ? <StreamAttachment {...props} attachments={regularAttachments} /> : null}
      {farmAttachments.map((attachment) => (
        <button type="button" className="fg-chat-betail-card" key={attachment.fg_betail_id || attachment.fg_betail_name} onClick={() => setPreview(attachment)}>
          <span className="fg-chat-betail-card-avatar">
            {attachment.fg_betail_image ? <img src={attachment.fg_betail_image} alt="" /> : <span className="fg-chat-betail-card-fallback"><Baby size={24} /></span>}
          </span>
          <span className="fg-chat-betail-card-copy">
            <small>Profil bétail</small>
            <strong>{attachment.fg_betail_name || 'Bétail sans nom'}</strong>
            <span>{attachment.fg_betail_matricule || 'Sans matricule'}{attachment.fg_betail_age != null ? ` · ${attachment.fg_betail_age} ans` : ''}</span>
          </span>
        </button>
      ))}
      {preview && typeof document !== 'undefined' ? createPortal(
        <div className={`fg-chat-betail-modal ${isDarkPreview ? 'is-dark' : ''}`} role="dialog" aria-modal="true" aria-label={`Profil de ${preview.fg_betail_name || 'ce bétail'}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <article className="fg-chat-betail-modal-card">
            <button type="button" className="fg-chat-betail-modal-close" onClick={() => setPreview(null)} aria-label="Fermer"><X size={20} /></button>
            {preview.fg_betail_image ? <img src={preview.fg_betail_image} alt="" /> : <span className="fg-chat-betail-modal-fallback"><Beef size={42} /></span>}
            <small>#{preview.fg_betail_matricule || 'XXXXX'}</small>
            <h2>{preview.fg_betail_name || 'Bétail sans nom'}</h2>
            <p>Âge : {preview.fg_betail_age != null ? `${preview.fg_betail_age} ans` : 'Non renseigné'}</p>
            {preview.fg_betail_premium ? <span className="fg-chat-betail-premium">Premium</span> : null}
            {preview.fg_betail_description ? (
              <section className="fg-chat-betail-description" aria-label="Description du bétail">
                <strong>Description</strong>
                <p>{preview.fg_betail_description}</p>
              </section>
            ) : null}
          </article>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

const farmMessageActionSet = defaultMessageActionSet
  .filter((action) => (
    action.type !== 'flag' &&
    action.type !== 'blockUser' &&
    action.type !== 'mute' &&
    !(action.type === 'reply' && action.placement === 'dropdown')
  ))
  .map((action) => (
    action.type === 'reply' && action.placement === 'quick'
      ? { ...action, type: 'quote', Component: QuickQuoteAction }
      : action.type === 'delete' && action.placement === 'dropdown'
        ? { ...action, Component: ConfirmDeleteAction }
      : action
  ));

export function FarmMessageActions() {
  return <MessageActions messageActionSet={farmMessageActionSet} />;
}

export function ImageOnlyMessageComposer({ mentionAllAppUsers = false, ...props }) {
  const messageComposer = useMessageComposerController();

  useEffect(() => {
    if (!messageComposer) return undefined;
    const previousAttachmentsConfig = messageComposer.config.attachments;
    if (mentionAllAppUsers) {
      const mentionSearch = new MentionsSearchSource(messageComposer.channel, { mentionAllAppUsers: true });
      messageComposer.textComposer.middlewareExecutor.replace([
        createMentionsMiddleware(messageComposer.channel, { searchSource: mentionSearch }),
      ]);
    }
    messageComposer.updateConfig({
      attachments: {
        acceptedFiles: ['image/*'],
        fileUploadFilter: (attachment) => String(attachment?.localMetadata?.file?.type || '').startsWith('image/'),
      },
    });
    return () => {
      messageComposer.updateConfig({ attachments: previousAttachmentsConfig });
    };
  }, [mentionAllAppUsers, messageComposer]);

  return <MessageComposer {...props} />;
}

function ChatHeader({ channel, friend, isBlocking, onBlock, onClose, onMinimize, onOpenProfile }) {
  const { jumpToMessage } = useChannelActionContext();
  const [presenceTick, setPresenceTick] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState(() => [...(channel?.state?.pinnedMessages || [])]);
  const [blockConfirmation, setBlockConfirmation] = useState(false);
  const optionsRef = useRef(null);
  const friendMember = channel?.state?.members?.[friend?.id];
  const streamFriend = friendMember?.user;
  const online = Boolean(streamFriend?.online);
  const avatar = streamFriend?.image || friend?.image || friend?.avatarUrl || '';
  const name = streamFriend?.name || friend?.name || friend?.username || 'Ami';

  useEffect(() => {
    if (!channel) return undefined;
    const listener = channel.on((event) => {
      if (event.type === 'user.presence.changed' || event.type === 'user.updated') {
        setPresenceTick((value) => value + 1);
      }
    });
    return () => listener.unsubscribe();
  }, [channel]);

  useEffect(() => {
    const syncPinnedMessages = () => setPinnedMessages([...(channel?.state?.pinnedMessages || [])]);
    syncPinnedMessages();
    if (!channel) return undefined;
    const listener = channel.on((event) => {
      if (event.type === 'message.updated' || event.type === 'message.deleted' || event.type === 'channel.truncated') {
        syncPinnedMessages();
      }
    });
    return () => listener.unsubscribe();
  }, [channel]);

  useEffect(() => {
    if (!optionsOpen) return undefined;
    const closeOptions = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && optionsRef.current?.contains(event.target)) return;
      setOptionsOpen(false);
      setPinnedOpen(false);
      setBlockConfirmation(false);
    };
    document.addEventListener('pointerdown', closeOptions);
    document.addEventListener('keydown', closeOptions);
    return () => {
      document.removeEventListener('pointerdown', closeOptions);
      document.removeEventListener('keydown', closeOptions);
    };
  }, [optionsOpen]);

  const handleBlock = async () => {
    if (isBlocking) return;
    if (!blockConfirmation) {
      setBlockConfirmation(true);
      return;
    }
    setOptionsOpen(false);
    setPinnedOpen(false);
    setBlockConfirmation(false);
    await onBlock();
  };

  return (
    <header className="fg-chat-header" data-presence-tick={presenceTick}>
      <span className="fg-chat-avatar-wrap">
        <ProfileAvatarImage avatarUrl={avatar} alt="" className="fg-chat-avatar" />
        <span className={`fg-chat-presence ${online ? 'is-online' : ''}`} aria-label={online ? 'En ligne' : 'Hors ligne'} />
      </span>
      <span className="fg-chat-title">
        <strong>{name}</strong>
        <small>{online ? 'En ligne' : 'Hors ligne'}</small>
      </span>
      <span className="fg-chat-header-options" ref={optionsRef}>
        <button
          type="button"
          className={`fg-chat-header-button ${optionsOpen ? 'is-active' : ''}`}
          onClick={() => {
            setOptionsOpen((open) => {
              if (open) {
                setPinnedOpen(false);
                setBlockConfirmation(false);
              }
              return !open;
            });
          }}
          aria-expanded={optionsOpen}
          aria-haspopup="menu"
          aria-label="Options de conversation"
          title="Options de conversation"
        >
          <MoreHorizontal size={17} />
        </button>
        {optionsOpen ? (
          <span className="fg-chat-options-menu" role="menu">
            <button type="button" role="menuitem" className="fg-chat-options-profile" onClick={() => { setOptionsOpen(false); setPinnedOpen(false); onOpenProfile(); }}>
              <UserRound size={15} />
              Accéder au profil
            </button>
            <button
              type="button"
              role="menuitem"
              className="fg-chat-options-pins"
              aria-expanded={pinnedOpen}
              onClick={() => setPinnedOpen((open) => !open)}
            >
              <Pin size={15} />
              Messages épinglés ({pinnedMessages.length})
            </button>
            <button type="button" role="menuitem" onClick={handleBlock} disabled={isBlocking}>
              {isBlocking ? <LoaderCircle className="is-spinning" size={15} /> : <ShieldBan size={15} />}
              {blockConfirmation ? 'Confirmer' : 'Bloquer l’utilisateur'}
            </button>
          </span>
        ) : null}
        {optionsOpen && pinnedOpen ? (
          <div className="fg-chat-pinned-panel" role="dialog" aria-label="Messages épinglés">
            <div className="fg-chat-pinned-panel__head">
              <span><Pin size={14} /> Messages épinglés ({pinnedMessages.length})</span>
              <button type="button" onClick={() => setPinnedOpen(false)} aria-label="Fermer les messages épinglés"><X size={14} /></button>
            </div>
            <div className="fg-chat-pinned-panel__list">
              {!pinnedMessages.length ? <p>Aucun message épinglé.</p> : null}
              {pinnedMessages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => {
                    jumpToMessage?.(message.id);
                    setPinnedOpen(false);
                    setOptionsOpen(false);
                  }}
                >
                  <strong>{message.user?.name || message.user?.username || 'Utilisateur'}</strong>
                  <small>{privateMessageSummary(message)}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </span>
      <button type="button" className="fg-chat-header-button" onClick={onMinimize} aria-label="Réduire la conversation" title="Réduire">
        <ChevronDown size={17} />
      </button>
      <button type="button" className="fg-chat-header-button" onClick={onClose} aria-label="Fermer la conversation" title="Fermer">
        <X size={18} />
      </button>
    </header>
  );
}

function ChatDockWindow({ chat, chatThemeClass, client }) {
  const { blockChatUser, blockingUserId, closeChat, minimizeChat, restoreChat } = useChatDock();
  const navigate = useNavigate();
  const friendUserId = chat.friend?.id;
  const isBlocking = blockingUserId === friendUserId;
  const friendMember = chat.channel?.state?.members?.[friendUserId];
  const minimizedFriend = friendMember?.user || chat.friend || {};
  const minimizedAvatar = friendMember?.user?.image || chat.friend?.image || chat.friend?.avatarUrl || '';
  const minimizedName = friendMember?.user?.name || friendMember?.user?.username || chat.friend?.name || chat.friend?.username || 'Ami';
  const avatarProfiles = useMemo(() => ({
    [String(client.userID || '')]: client.user || {},
    [String(friendUserId || '')]: {
      ...(chat.friend || {}),
      ...(friendMember?.user || {}),
      image: friendMember?.user?.image || chat.friend?.image || chat.friend?.avatarUrl || '',
    },
  }), [chat.friend, client.user, client.userID, friendMember?.user, friendUserId]);
  const componentOverrides = useMemo(() => ({
    Attachment: FarmAttachment,
    AttachmentSelector: FarmAttachmentSelector,
    Avatar: FarmPrivateAvatar,
    extractDisplayInfo: ({ user: streamUser }) => {
      const profile = avatarProfiles[String(streamUser?.id || '')] || streamUser || {};
      return {
        id: streamUser?.id,
        imageUrl: profile.image || profile.avatarUrl || streamUser?.image || '',
        userName: profile.username || profile.name || streamUser?.username || streamUser?.name || 'Utilisateur',
      };
    },
    MessageActions: FarmMessageActions,
    MessageUI: FarmPrivateMessageUI,
    QuotedMessage: FarmQuotedMessage,
    QuotedMessagePreview: FarmQuotedMessagePreview,
  }), [avatarProfiles]);

  if (chat.isLoading || !chat.channel) {
    return (
      <aside className={`fg-chat-dock fg-chat-dock--loading auth-theme ${chatThemeClass}`.trim()} aria-label={`Ouverture de la conversation avec ${minimizedName}`}>
        <div className="fg-chat-loading-header">
          <ProfileAvatarImage avatarUrl={minimizedAvatar} alt="" />
          <strong>{minimizedName}</strong>
          <button type="button" onClick={() => closeChat(friendUserId)} aria-label="Fermer"><X size={17} /></button>
        </div>
        <div className="fg-chat-loading-body" role="status">
          <LoaderCircle className="is-spinning" size={22} />
          <span>Connexion à la conversation…</span>
        </div>
      </aside>
    );
  }

  if (chat.isMinimized) {
    return (
      <aside className={`fg-chat-dock fg-chat-dock--minimized ${chat.unreadCount > 0 ? 'has-unread' : ''} auth-theme ${chatThemeClass}`.trim()} aria-label="Conversation réduite">
        <button type="button" className="fg-chat-minimized" onClick={() => restoreChat(friendUserId)} aria-label={`Ouvrir la conversation avec ${minimizedName}`}>
          <ProfileAvatarImage avatarUrl={minimizedAvatar} alt="" />
          <strong>{minimizedName}</strong>
          {chat.unreadCount > 0 ? (
            <span className="fg-chat-minimized-badge" aria-label={`${chat.unreadCount} message${chat.unreadCount > 1 ? 's' : ''} non lu${chat.unreadCount > 1 ? 's' : ''}`}>
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          ) : null}
          <ChevronDown className="fg-chat-minimized-chevron" size={17} />
        </button>
        <button
          type="button"
          className="fg-chat-minimized-close"
          onClick={() => closeChat(friendUserId)}
          aria-label="Fermer la conversation"
          title="Fermer"
        >
          <X size={17} />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`fg-chat-dock auth-theme ${chatThemeClass}`.trim()} aria-label={`Messagerie privée avec ${minimizedName}`}>
      <Chat client={client} theme="str-chat__theme-light">
        <Channel channel={chat.channel} TypingIndicator={TypingIndicator}>
          <WithComponents overrides={componentOverrides}>
            <div className="fg-chat-window">
              <ChatHeader
                channel={chat.channel}
                friend={chat.friend}
                isBlocking={isBlocking}
                onBlock={() => blockChatUser(friendUserId)}
                onClose={() => closeChat(friendUserId)}
                onMinimize={() => minimizeChat(friendUserId)}
                onOpenProfile={() => navigate(`/community/profile/${encodeURIComponent(minimizedFriend.username || minimizedFriend.name || friendUserId)}`)}
              />
              <div className="fg-chat-conversation">
                <MessageList messageActions={['edit', 'delete', 'pin', 'quote', 'react']} />
                <ImageOnlyMessageComposer focus />
              </div>
            </div>
          </WithComponents>
        </Channel>
      </Chat>
    </aside>
  );
}

export default function ChatDock() {
  const { client, chats } = useChatDock();
  const [theme, setTheme] = useState(() => getLocalThemePreference());

  useEffect(() => {
    const updateTheme = () => setTheme(getLocalThemePreference());
    window.addEventListener('farmgestion-theme-change', updateTheme);
    window.addEventListener('storage', updateTheme);
    return () => {
      window.removeEventListener('farmgestion-theme-change', updateTheme);
      window.removeEventListener('storage', updateTheme);
    };
  }, []);

  const chatThemeClass = useMemo(() => themeClassName(theme), [theme]);
  if (!client || !chats.length) return null;

  return (
    <div className="fg-chat-docks" aria-label="Conversations privées">
      {chats.map((chat) => (
        <ChatDockWindow
          key={chat.friend?.id || chat.channel.cid}
          chat={chat}
          chatThemeClass={chatThemeClass}
          client={client}
        />
      ))}
    </div>
  );
}
