import type { UserProfile } from '../lib/api';
import type { ConversationItem } from '../pages/DashboardPage';
import './Sidebar.css';

interface SidebarProps {
  user: UserProfile;
  conversations: ConversationItem[];
  activeChat: string | null;
  onlineUsers: Set<string>;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onLogout: () => void;
  loading: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(id: string) {
  const colors = [
    '#e2a43b', '#60a5fa', '#f87171', '#34d399', '#a78bfa',
    '#fb923c', '#f472b6', '#38bdf8', '#4ade80', '#facc15',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export default function Sidebar({ user, conversations, activeChat, onlineUsers, onSelectChat, onNewChat, onLogout, loading }: SidebarProps) {
  return (
    <aside className="sidebar glass">
      {/* Header */}
      <div className="sidebar__header">
        <div className="sidebar__brand">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="10" fill="var(--accent)" fillOpacity="0.15"/>
            <path d="M10 18C10 13.58 13.58 10 18 10C22.42 10 26 13.58 26 18V22C26 23.1 25.1 24 24 24H12C10.9 24 10 23.1 10 22V18Z" stroke="var(--accent)" strokeWidth="1.8" fill="none"/>
            <circle cx="15" cy="18" r="1.2" fill="var(--accent)"/>
            <circle cx="21" cy="18" r="1.2" fill="var(--accent)"/>
          </svg>
          <span className="sidebar__brand-text text-display">WhisperBox</span>
        </div>
        <button className="btn-icon" onClick={onNewChat} title="New conversation" id="btn-new-chat">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 10h12M10 4v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Conversations */}
      <div className="sidebar__list">
        {loading ? (
          <div className="sidebar__loading">
            {[1,2,3].map(i => (
              <div key={i} className="sidebar__skeleton" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="sidebar__skeleton-avatar" />
                <div className="sidebar__skeleton-text">
                  <div className="sidebar__skeleton-line" style={{ width: '60%' }} />
                  <div className="sidebar__skeleton-line" style={{ width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="sidebar__empty">
            <p>No conversations yet</p>
            <button className="btn btn-ghost" onClick={onNewChat}>Start chatting</button>
          </div>
        ) : (
          conversations.map((conv, i) => (
            <button
              key={conv.user_id}
              className={`sidebar__item ${activeChat === conv.user_id ? 'sidebar__item--active' : ''} animate-slide-up delay-${Math.min(i + 1, 5)}`}
              onClick={() => onSelectChat(conv.user_id)}
              id={`conv-${conv.user_id}`}
            >
              <div className="sidebar__avatar" style={{ background: getAvatarColor(conv.user_id) }}>
                {getInitials(conv.display_name)}
                {onlineUsers.has(conv.user_id) && <span className="sidebar__online-dot" />}
              </div>
              <div className="sidebar__item-info">
                <div className="sidebar__item-top">
                  <span className="sidebar__item-name">{conv.display_name}</span>
                  <span className="sidebar__item-time">{formatTime(conv.last_message_at)}</span>
                </div>
                <div className="sidebar__item-bottom">
                  <span className="sidebar__item-username">@{conv.username}</span>
                  {(conv.unread ?? 0) > 0 && (
                    <span className="sidebar__unread">{conv.unread}</span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* User footer */}
      <div className="sidebar__footer">
        <div className="sidebar__user">
          <div className="sidebar__avatar sidebar__avatar--sm" style={{ background: getAvatarColor(user.id) }}>
            {getInitials(user.display_name)}
          </div>
          <div className="sidebar__user-info">
            <span className="sidebar__user-name">{user.display_name}</span>
            <span className="sidebar__user-username">@{user.username}</span>
          </div>
        </div>
        <button className="btn-icon" onClick={onLogout} title="Logout" id="btn-logout">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M6.5 15.5H3.5a1 1 0 01-1-1v-11a1 1 0 011-1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 12.5l3.5-3.5L12 5.5M7 9h8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
