import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../lib/api';
import * as cryptoLib from '../lib/crypto';
import { addWSListener, sendWSMessage, isWSConnected, type WSEvent } from '../lib/ws';
import { cacheMessage, getCachedMessages, deleteMessage, editMessage } from '../lib/cache';
import { playNotificationSound, showBrowserNotification } from '../lib/notifications';
import { parseMessage, type StructuredMessage, type MessageType } from '../lib/types';
import VideoCall from './VideoCall';
import './ChatView.css';

interface ChatViewProps {
  recipientId: string;
  recipientName: string;
  recipientUsername: string;
  isOnline: boolean;
  onBack?: () => void;
}

interface DecryptedMessage {
  id: string;
  fromMe: boolean;
  plaintext: string; // legacy text or JSON string
  parsed: StructuredMessage;
  created_at: string;
  failed?: boolean;
}

export default function ChatView({ recipientId, recipientName, recipientUsername, isOnline, onBack }: ChatViewProps) {
  const { user, privateKey, publicKey } = useAuth();
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [recipientPubKey, setRecipientPubKey] = useState<CryptoKey | null>(null);
  
  // Edit & Delete State
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Video Call State
  const [callState, setCallState] = useState<'none' | 'incoming' | 'active'>('none');
  const [incomingOffer, setIncomingOffer] = useState<RTCSessionDescriptionInit | undefined>(undefined);
  const [isInitiator, setIsInitiator] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // Fetch recipient's public key
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { public_key } = await api.getUserPublicKey(recipientId);
        if (!cancelled) {
          const key = await cryptoLib.importPublicKey(public_key);
          setRecipientPubKey(key);
        }
      } catch { /* empty */ }
    })();
    return () => { cancelled = true; };
  }, [recipientId]);

  // Load history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await getCachedMessages(recipientId);
      if (!cancelled && cached.length > 0) {
        setMessages(cached.map(c => ({
          id: c.id,
          fromMe: c.fromMe,
          plaintext: c.plaintext,
          parsed: parseMessage(c.plaintext),
          created_at: c.created_at,
        })));
        scrollToBottom();
      }

      try {
        const apiMsgs = await api.getMessages(recipientId);
        if (cancelled || !privateKey || !user) return;

        let decrypted: DecryptedMessage[] = [];
        for (const msg of apiMsgs.reverse()) {
          const fromMe = msg.from_user_id === user.id;
          try {
            const plaintext = await cryptoLib.decryptMessage(msg.payload, privateKey, fromMe);
            const parsed = parseMessage(plaintext);
            
            if (['call-offer', 'call-answer', 'ice-candidate', 'call-end'].includes(parsed.type)) {
              // Ignore signaling messages
            } else if (parsed.type === 'delete') {
              // Apply tombstone to history
              const targetId = parsed.content;
              decrypted = decrypted.filter(m => m.id !== targetId);
              await deleteMessage(targetId);
            } else if (parsed.type === 'edit') {
              // Apply edit to history
              const targetId = parsed.metadata?.targetId;
              if (targetId) {
                decrypted = decrypted.map(m => {
                  if (m.id === targetId) {
                    const newParsed = { type: 'text' as const, content: parsed.content };
                    const newPlaintext = JSON.stringify(newParsed);
                    return { ...m, plaintext: newPlaintext, parsed: newParsed };
                  }
                  return m;
                });
                await editMessage(targetId, JSON.stringify({ type: 'text', content: parsed.content }));
              }
            } else {
              decrypted.push({ id: msg.id, fromMe, plaintext, parsed, created_at: msg.created_at });
              await cacheMessage({ id: msg.id, conversationUserId: recipientId, fromMe, plaintext, created_at: msg.created_at });
            }
          } catch {
            decrypted.push({ id: msg.id, fromMe, plaintext: '', parsed: { type: 'text', content: '[Decryption failed]' }, created_at: msg.created_at, failed: true });
          }
        }
        if (!cancelled) {
          setMessages(decrypted);
          scrollToBottom();
        }
      } catch { /* empty */ } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipientId, privateKey, user, scrollToBottom]);

  // Handle incoming messages & signaling
  useEffect(() => {
    const unsub = addWSListener(async (event: WSEvent) => {
      if (event.event !== 'message.receive' || !privateKey) return;
      if (event.from_user_id !== recipientId) {
        playNotificationSound();
        showBrowserNotification('New message', 'You have a new encrypted message');
        return;
      }

      try {
        const plaintext = await cryptoLib.decryptMessage(event.payload, privateKey, false);
        const parsed = parseMessage(plaintext);

        if (parsed.type === 'call-offer') {
          setIncomingOffer(JSON.parse(parsed.content));
          setCallState('incoming');
          playNotificationSound();
          return;
        }
        
        if (['call-answer', 'ice-candidate', 'call-end'].includes(parsed.type)) {
          window.postMessage({ type: 'webrtc-signal', payload: { signalType: parsed.type, content: parsed.content } }, '*');
          if (parsed.type === 'call-end') setCallState('none');
          return;
        }

        // Tombstones
        if (parsed.type === 'delete') {
          const targetId = parsed.content;
          setMessages(prev => prev.filter(m => m.id !== targetId));
          await deleteMessage(targetId);
          return;
        }
        if (parsed.type === 'edit') {
          const targetId = parsed.metadata?.targetId;
          if (targetId) {
            const newParsed = { type: 'text' as const, content: parsed.content };
            const newPlaintext = JSON.stringify(newParsed);
            setMessages(prev => prev.map(m => m.id === targetId ? { ...m, plaintext: newPlaintext, parsed: newParsed } : m));
            await editMessage(targetId, newPlaintext);
          }
          return;
        }

        const newMsg: DecryptedMessage = { id: event.id, fromMe: false, plaintext, parsed, created_at: event.created_at };
        setMessages(prev => prev.find(m => m.id === event.id) ? prev : [...prev, newMsg]);
        await cacheMessage({ id: event.id, conversationUserId: recipientId, fromMe: false, plaintext, created_at: event.created_at });
        scrollToBottom();
        playNotificationSound();
      } catch { /* empty */ }
    });
    return unsub;
  }, [recipientId, privateKey, scrollToBottom]);

  const internalSend = async (payloadObj: StructuredMessage) => {
    if (!recipientPubKey || !publicKey || !privateKey || !user) return;
    
    // For backwards compatibility with older clients: send normal text as raw strings, not JSON
    let plaintext: string;
    if (payloadObj.type === 'text' && !payloadObj.metadata) {
      plaintext = payloadObj.content;
    } else {
      plaintext = JSON.stringify(payloadObj);
    }

    const payload = await cryptoLib.encryptMessage(plaintext, recipientPubKey, publicKey);
    
    const isSignaling = ['call-offer', 'call-answer', 'ice-candidate', 'call-end'].includes(payloadObj.type);

    if (isSignaling) {
      if (isWSConnected()) {
        sendWSMessage(recipientId, payload);
      } else {
        await api.sendMessageHTTP(recipientId, payload);
      }
      return;
    }

    // For persistent messages, use HTTP to get the real database ID back
    const isVisibleMsg = ['text', 'image', 'file'].includes(payloadObj.type);
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();

    if (isVisibleMsg) {
      setMessages(prev => [...prev, { id: tempId, fromMe: true, plaintext, parsed: payloadObj, created_at: now }]);
      scrollToBottom();
    }

    try {
      // Always use HTTP for chat messages so we get the real ID to allow editing/deleting
      const sentMsg = await api.sendMessageHTTP(recipientId, payload);
      
      if (isVisibleMsg) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: sentMsg.id, created_at: sentMsg.created_at } : m));
        await cacheMessage({ id: sentMsg.id, conversationUserId: recipientId, fromMe: true, plaintext, created_at: sentMsg.created_at });
      }
    } catch {
      if (isVisibleMsg) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true } : m));
      }
    }
  };

  const handleSendText = async () => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    try {
      if (editingMsgId) {
        // Edit flow
        await internalSend({ type: 'edit', content: text, metadata: { targetId: editingMsgId } });
        const newParsed = { type: 'text' as const, content: text };
        const newPlaintext = JSON.stringify(newParsed);
        setMessages(prev => prev.map(m => m.id === editingMsgId ? { ...m, plaintext: newPlaintext, parsed: newParsed } : m));
        await editMessage(editingMsgId, newPlaintext);
        setEditingMsgId(null);
      } else {
        // New message flow
        await internalSend({ type: 'text', content: text });
      }
      setInput('');
    } catch { /* empty */ } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const triggerDeleteMessage = (msgId: string) => {
    setDeleteConfirmId(msgId);
  };

  const confirmDeleteMessage = async () => {
    if (!deleteConfirmId) return;
    const msgId = deleteConfirmId;
    setDeleteConfirmId(null);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    await deleteMessage(msgId);
    await internalSend({ type: 'delete', content: msgId });
  };

  const handleStartEdit = (msg: DecryptedMessage) => {
    if (msg.parsed.type !== 'text') return;
    setEditingMsgId(msg.id);
    setInput(msg.parsed.content);
    inputRef.current?.focus();
  };

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('File is too large. Limit is 2MB for E2EE payload.');
      return;
    }
    setSending(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = ev.target?.result as string;
        const isImage = file.type.startsWith('image/');
        await internalSend({
          type: isImage ? 'image' : 'file',
          content: base64,
          metadata: { fileName: file.name, mimeType: file.type, size: file.size }
        });
        setSending(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setSending(false);
    }
    e.target.value = '';
  };

  const startCall = () => { setIsInitiator(true); setCallState('active'); };
  const acceptCall = () => { setIsInitiator(false); setCallState('active'); };
  const declineCall = () => { internalSend({ type: 'call-end', content: '' }); setCallState('none'); };

  const formatMsgTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="chat">
      <div className="chat__header glass">
        <div className="chat__header-user">
          {onBack && (
            <button className="btn-icon chat__back-btn" onClick={onBack}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          )}
          <div className="chat__header-info">
            <h2 className="chat__header-name">{recipientName}</h2>
            <span className="chat__header-status">
              {isOnline ? (
                <><span className="chat__status-dot chat__status-dot--online" /> Online</>
              ) : (
                <><span className="chat__status-dot" /> @{recipientUsername}</>
              )}
            </span>
          </div>
        </div>
        <div className="chat__header-actions">
          <button className="btn-icon" onClick={startCall} title="Start Video Call">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M14 6l4-3v14l-4-3V6zM3 6h9v8H3V6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className="chat__header-badge badge badge-encrypted">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1"/>
              <path d="M4 5.5V4a2 2 0 114 0v1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            <span className="hide-on-mobile">E2EE</span>
          </div>
        </div>
      </div>

      <div className="chat__messages">
        {loadingHistory && (
          <div className="chat__loading">
            <div className="spinner spinner-lg" />
            <span>Decrypting messages…</span>
          </div>
        )}

        {!loadingHistory && messages.length === 0 && (
          <div className="chat__empty animate-fade-in">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="10" width="36" height="28" rx="6" stroke="var(--text-muted)" strokeWidth="1.5" fill="none" opacity="0.4"/>
              <path d="M16 22h16M16 28h10" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
            </svg>
            <p>Send an encrypted message or file to start</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={`chat__bubble ${msg.fromMe ? 'chat__bubble--sent' : 'chat__bubble--received'} ${msg.failed ? 'chat__bubble--failed' : ''}`}
            style={{ animationDelay: `${Math.min(i * 10, 100)}ms` }}
          >
            {msg.fromMe && !msg.failed && (
              <div className="chat__bubble-actions">
                {msg.parsed.type === 'text' && (
                  <button className="chat__bubble-action-btn" onClick={() => handleStartEdit(msg)} title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                  </button>
                )}
                <button className="chat__bubble-action-btn chat__bubble-action-btn--danger" onClick={() => triggerDeleteMessage(msg.id)} title="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            )}
            <div className="chat__bubble-content">
              {msg.parsed.type === 'image' && <img src={msg.parsed.content} alt="Attachment" className="chat__image-attachment" />}
              {msg.parsed.type === 'file' && (
                <a href={msg.parsed.content} download={msg.parsed.metadata?.fileName || 'download'} className="chat__file-attachment">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span>{msg.parsed.metadata?.fileName || 'Download File'}</span>
                </a>
              )}
              {msg.parsed.type === 'text' && <p>{msg.parsed.content}</p>}
              
              <span className="chat__bubble-time">
                {msg.parsed.metadata?.targetId ? '(edited) ' : ''}{formatMsgTime(msg.created_at)}
                {msg.fromMe && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="chat__check">
                    <path d="M3 7l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat__input-bar glass">
        {editingMsgId && (
          <div className="chat__edit-banner">
            <span>Editing message</span>
            <button className="btn-icon" onClick={() => { setEditingMsgId(null); setInput(''); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        )}
        <div className="chat__input-wrapper">
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileAttach} />
          <button className="btn-icon chat__attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file (Max 2MB)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
          </button>
          <textarea
            ref={inputRef}
            className="chat__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
            placeholder={editingMsgId ? "Edit your message…" : "Type an encrypted message…"}
            rows={1}
          />
          <button className="btn btn-primary chat__send-btn" onClick={handleSendText} disabled={sending || (!input.trim() && !sending) || !recipientPubKey}>
            {sending ? <span className="spinner" /> : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M3 9h12M11 5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {deleteConfirmId && (
        <div className="chat__modal-overlay">
          <div className="chat__modal-card animate-scale-in">
            <h3>Delete Message?</h3>
            <p>This message will be deleted for everyone in this conversation.</p>
            <div className="chat__modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button className="btn chat__btn-danger" onClick={confirmDeleteMessage}>Delete for everyone</button>
            </div>
          </div>
        </div>
      )}

      {callState === 'incoming' && (
        <div className="incoming-call-modal">
          <div className="incoming-call-card animate-scale-in">
            <div className="incoming-call-avatar">{recipientName[0].toUpperCase()}</div>
            <h3 className="incoming-call-name">{recipientName}</h3>
            <p className="incoming-call-text">is calling you (Encrypted)</p>
            <div className="incoming-call-actions">
              <button className="btn btn-accept" onClick={acceptCall}>Accept</button>
              <button className="btn btn-decline" onClick={declineCall}>Decline</button>
            </div>
          </div>
        </div>
      )}

      {callState === 'active' && (
        <VideoCall 
          isInitiator={isInitiator}
          incomingOffer={incomingOffer}
          onSendSignal={(type, content) => internalSend({ type: type as MessageType, content })}
          onClose={() => { setCallState('none'); setIncomingOffer(undefined); }}
        />
      )}
    </div>
  );
}
