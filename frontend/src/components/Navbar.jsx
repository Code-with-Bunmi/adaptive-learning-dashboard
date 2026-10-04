import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo2.png" alt="OALD" className="h-9" />
          <span className="font-display text-lg font-semibold tracking-tight">
            Adaptive Learning Dashboard
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-4">
            <span className="label hidden sm:inline">
              {ROLE_LABEL[user.role]} · {user.name}
            </span>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded-full border border-ink/20 px-4 py-1.5 text-sm font-medium transition hover:border-ink hover:bg-ink hover:text-paper"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
