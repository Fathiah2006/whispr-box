import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import './Auth.css';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError('Failed to log in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page noise-overlay">
      <div className="auth-ambient-orb auth-ambient-orb--1" />
      <div className="auth-ambient-orb auth-ambient-orb--2" />

      <div className="auth-card animate-scale-in">
        <div className="auth-card__header">
          <div className="auth-logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect width="36" height="36" rx="10" fill="var(--accent)" fillOpacity="0.15"/>
              <path d="M10 18C10 13.58 13.58 10 18 10C22.42 10 26 13.58 26 18V22C26 23.1 25.1 24 24 24H12C10.9 24 10 23.1 10 22V18Z" stroke="var(--accent)" strokeWidth="1.8" fill="none"/>
              <circle cx="15" cy="18" r="1.2" fill="var(--accent)"/>
              <circle cx="21" cy="18" r="1.2" fill="var(--accent)"/>
              <path d="M15 21C15 21 16.5 22.5 18 22.5C19.5 22.5 21 21 21 21" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-display auth-title">Welcome back</h1>
          <p className="auth-subtitle">Your messages are end-to-end encrypted</p>
        </div>

        {error && (
          <div className="auth-error animate-slide-up">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="input-with-icon">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading || !username || !password}>
            {loading ? (
              <>
                <span className="spinner" />
                Decrypting keys…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>Don't have an account? <Link to="/register">Create one</Link></p>
        </div>

        <div className="auth-e2e-badge badge badge-encrypted">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1"/>
            <path d="M4 5.5V4a2 2 0 114 0v1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          End-to-End Encrypted
        </div>
      </div>
    </div>
  );
}
