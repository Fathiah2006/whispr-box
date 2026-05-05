import { useState, useEffect, useRef } from 'react';
import * as api from '../lib/api';
import './SearchModal.css';

interface SearchModalProps {
  onSelect: (userId: string, displayName: string, username: string) => void;
  onClose: () => void;
}

export default function SearchModal({ onSelect, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<api.UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number>();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchUsers(query.trim());
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 350);
    return () => window.clearTimeout(debounceRef.current);
  }, [query]);

  function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  function getColor(id: string) {
    const colors = ['#e2a43b', '#60a5fa', '#f87171', '#34d399', '#a78bfa', '#fb923c', '#f472b6', '#38bdf8'];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
    return colors[Math.abs(h) % colors.length];
  }

  return (
    <div className="search-overlay animate-fade-in" onClick={onClose}>
      <div className="search-modal animate-scale-in glass" onClick={e => e.stopPropagation()}>
        <div className="search-modal__header">
          <h2 className="text-display">New conversation</h2>
          <button className="btn-icon" onClick={onClose} id="btn-close-search">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="search-modal__input-wrap">
          <svg className="search-modal__icon" width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-modal__input"
            value={query}
            onChange={e => {
              const val = e.target.value;
              setQuery(val);
              if (!val.trim()) {
                setResults([]);
                setSearched(false);
              }
            }}
            placeholder="Search by name or @username..."
            id="search-users-input"
          />
        </div>

        <div className="search-modal__results">
          {loading && (
            <div className="search-modal__loading">
              <div className="spinner" />
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="search-modal__empty">No users found</div>
          )}

          {results.map((u, i) => (
            <button
              key={u.id}
              className={`search-modal__result animate-slide-up delay-${Math.min(i + 1, 5)}`}
              onClick={() => onSelect(u.id, u.display_name, u.username)}
              id={`search-result-${u.id}`}
            >
              <div className="search-modal__avatar" style={{ background: getColor(u.id) }}>
                {getInitials(u.display_name)}
              </div>
              <div className="search-modal__result-info">
                <span className="search-modal__result-name">{u.display_name}</span>
                <span className="search-modal__result-username">@{u.username}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
