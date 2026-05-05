import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { addWSListener, type WSEvent } from '../lib/ws';
import Sidebar from '../components/Sidebar';
import ChatView from '../components/ChatView';
import SearchModal from '../components/SearchModal';
import './Dashboard.css';

export interface ConversationItem {
  user_id: string;
  display_name: string;
  username: string;
  last_message_at: string;
  online?: boolean;
  unread?: number;
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await api.getConversations();
      setConversations(data.map(c => ({ ...c, online: false, unread: 0 })));
    } catch {
      // silently retry later
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  // WebSocket event handling
  useEffect(() => {
    const unsub = addWSListener((event: WSEvent) => {
      if (event.event === 'user.online') {
        setOnlineUsers(prev => new Set(prev).add(event.user_id));
      } else if (event.event === 'user.offline') {
        setOnlineUsers(prev => {
          const next = new Set(prev);
          next.delete(event.user_id);
          return next;
        });
      } else if (event.event === 'message.receive') {
        const fromId = event.from_user_id;
        // Update conversation list
        setConversations(prev => {
          const exists = prev.find(c => c.user_id === fromId);
          if (exists) {
            return prev.map(c =>
              c.user_id === fromId
                ? { ...c, last_message_at: event.created_at, unread: (c.unread || 0) + (activeChat !== fromId ? 1 : 0) }
                : c
            ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          } else {
            // New conversation — reload list
            loadConversations();
            return prev;
          }
        });
      }
    });
    return unsub;
  }, [activeChat, loadConversations]);

  const handleSelectUser = (userId: string, displayName: string, username: string) => {
    setActiveChat(userId);
    // Ensure conversation exists in list
    setConversations(prev => {
      if (prev.find(c => c.user_id === userId)) {
        return prev.map(c => c.user_id === userId ? { ...c, unread: 0 } : c);
      }
      return [{ user_id: userId, display_name: displayName, username, last_message_at: new Date().toISOString(), online: false, unread: 0 }, ...prev];
    });
    setShowSearch(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const activeChatUser = conversations.find(c => c.user_id === activeChat);

  if (!user) return null;

  return (
    <div className={`dashboard noise-overlay ${activeChat ? 'dashboard--chat-active' : ''}`}>
      <Sidebar
        user={user}
        conversations={conversations}
        activeChat={activeChat}
        onlineUsers={onlineUsers}
        onSelectChat={(id) => {
          setActiveChat(id);
          setConversations(prev => prev.map(c => c.user_id === id ? { ...c, unread: 0 } : c));
        }}
        onNewChat={() => setShowSearch(true)}
        onLogout={handleLogout}
        loading={loading}
      />
      <main className="dashboard__main">
        {activeChat && activeChatUser ? (
          <ChatView
            key={activeChat}
            recipientId={activeChat}
            recipientName={activeChatUser.display_name}
            recipientUsername={activeChatUser.username}
            isOnline={onlineUsers.has(activeChat)}
            onBack={() => setActiveChat(null)}
          />
        ) : (
          <div className="dashboard__empty animate-fade-in">
            <div className="dashboard__empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="14" width="48" height="36" rx="8" stroke="var(--text-muted)" strokeWidth="2" fill="none" opacity="0.4"/>
                <path d="M8 22L32 38L56 22" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" opacity="0.3"/>
                <circle cx="32" cy="30" r="4" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.6"/>
                <path d="M28 30l2.5 2.5L36 27" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
              </svg>
            </div>
            <h2 className="text-display">Select a conversation</h2>
            <p>Choose an existing chat or start a new encrypted conversation</p>
          </div>
        )}
      </main>

      {showSearch && (
        <SearchModal
          onSelect={handleSelectUser}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}
