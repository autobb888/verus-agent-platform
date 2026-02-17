import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import Markdown from 'react-markdown';
import ResolvedId from './ResolvedId';
import { useDisplayName } from '../context/IdentityContext';
import { useAuth } from '../context/AuthContext';
import HeldMessageIndicator from './HeldMessageIndicator';
import SafetyScanBadge from './SafetyScanBadge';

const API_BASE = import.meta.env.VITE_API_URL || '';

function TypingName({ verusId }) {
  const name = useDisplayName(verusId);
  return <span>{name}</span>;
}
const WS_URL = import.meta.env.VITE_WS_URL || window.location.origin;

export default function Chat({ jobId, job }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [readReceipts, setReadReceipts] = useState({});
  const [expanded, setExpanded] = useState(false);
  const [heldMessages, setHeldMessages] = useState([]);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(0);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load initial messages via REST
  useEffect(() => {
    async function loadMessages() {
      try {
        const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/messages`, { credentials: 'include' });
        const data = await res.json();
        if (res.ok && data.data) {
          setMessages(data.data);
        }
      } catch { /* ignore */ }
    }
    loadMessages();
  }, [jobId]);

  // Socket.IO connection (get chat token first, then connect)
  useEffect(() => {
    let socket;
    let cancelled = false;

    async function connectChat() {
      // Get one-time chat token via REST API
      try {
        const tokenRes = await fetch(`${API_BASE}/v1/chat/token`, { credentials: 'include' });
        if (!tokenRes.ok) {
          console.warn('[Chat] Failed to get chat token:', tokenRes.status);
          return;
        }
        const tokenData = await tokenRes.json();
        const chatToken = tokenData.data?.token;
        if (!chatToken || cancelled) return;

        socket = io(WS_URL, {
          path: '/ws',
          auth: { token: chatToken },
          withCredentials: true,
          transports: ['websocket', 'polling'],
        });
      } catch (err) {
        console.warn('[Chat] Error getting chat token:', err);
        return;
      }
      if (cancelled) { socket?.disconnect(); return; }
      socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_job', { jobId });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('message', (msg) => {
      setMessages(prev => {
        // Deduplicate
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('typing', (data) => {
      if (data.verusId !== user?.verusId) {
        setTypingUser(data.verusId);
        // Clear after 3s
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
      }
    });

    socket.on('message_held', (data) => {
      setHeldMessages(prev => [...prev, { id: data.id || Date.now(), timestamp: Date.now() }]);
    });

    socket.on('read', (data) => {
      setReadReceipts(prev => ({ ...prev, [data.verusId]: data.readAt }));
    });

    socket.on('error', (err) => {
      console.warn('[Chat] Socket error:', err.message);
    });

    } // end connectChat

    connectChat();

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.emit('leave_job', { jobId });
        socketRef.current.disconnect();
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [jobId, user?.verusId]);

  // Send read receipt when viewing messages
  useEffect(() => {
    if (connected && messages.length > 0 && socketRef.current) {
      socketRef.current.emit('read', { jobId });
    }
  }, [messages.length, connected, jobId]);

  function handleSend(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content || !socketRef.current || !connected) return;

    socketRef.current.emit('message', { jobId, content });
    setInput('');
  }

  function handleInputChange(e) {
    setInput(e.target.value);
    // Send typing indicator (throttled to once per 2s)
    const now = Date.now();
    if (socketRef.current && connected && now - lastTypingSentRef.current > 2000) {
      socketRef.current.emit('typing', { jobId });
      lastTypingSentRef.current = now;
    }
  }

  const height = expanded ? '600px' : '400px';

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height, transition: 'height 0.2s' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid var(--border-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            Chat
          </h3>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
            display: 'inline-block',
          }} title={connected ? 'Connected' : 'Disconnected'} />
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 14,
          }}
        >
          {expanded ? '↓ Collapse' : '↑ Expand'}
        </button>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
            No messages yet. Start the conversation!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderVerusId === user?.verusId;
            const isFlagged = msg.safetyScore != null && msg.safetyScore >= 0.4;
            return (
              <div
                key={msg.id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  maxWidth: '80%',
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                  background: isMe ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-tertiary)',
                  border: isFlagged ? '1px solid #eab308' : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ResolvedId address={msg.senderVerusId} size="sm" showAddress={false} />
                  {msg.signed && (
                    <span style={{ fontSize: 10, color: '#22c55e' }}>✓ signed</span>
                  )}
                  <SafetyScanBadge score={msg.safetyScore} warning={isFlagged} />
                  {isFlagged && (
                    <span style={{ fontSize: 10, color: '#eab308' }}>⚠️ Flagged</span>
                  )}
                </div>
                <div style={{ margin: 0, color: 'var(--text-primary)', fontSize: 14, wordBreak: 'break-word' }} className="chat-markdown">
                  <Markdown>{msg.content}</Markdown>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
                  </span>
                  {isMe && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {Object.keys(readReceipts).length > 0 ? '✓✓' : '✓'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        {heldMessages.map(h => (
          <HeldMessageIndicator key={h.id} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingUser && (
        <div style={{ padding: '4px 16px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          <TypingName verusId={typingUser} /> is typing...
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex', gap: 8, padding: '12px 16px',
          borderTop: '1px solid var(--border-primary)',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          maxLength={4000}
          style={{
            flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
            borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
            outline: 'none', fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || !connected}
          className="btn-primary"
          style={{ padding: '8px 16px' }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
