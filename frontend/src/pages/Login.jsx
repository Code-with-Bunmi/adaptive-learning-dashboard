import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../hooks/useAuth.jsx';

const DEV_ACCOUNTS = [
  { role: 'Student', email: 'olowookere.bunmi001@gmail.com', note: 'Sample student — Chapter 3 demo' },
  { role: 'Teacher', email: 'teacher@demo.oau.edu.ng' },
  { role: 'Admin', email: 'admin@demo.oau.edu.ng' },
];

export default function Login() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithGoogleCode, loginAsDevUser } = useAuth();
  const navigate = useNavigate();

  const googleLogin = useGoogleLogin({
    flow: 'auth-code',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
      'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
      'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    ].join(' '),
    onSuccess: async ({ code }) => {
      setLoading(true);
      setError('');
      try {
        const user = await loginWithGoogleCode(code);
        navigate(`/${user.role}`);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    onError: () => setError('Google sign-in was cancelled or failed. Please try again.'),
  });

  const handleDevLogin = async (email) => {
    setLoading(true);
    setError('');
    try {
      const user = await loginAsDevUser(email);
      navigate(`/${user.role}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6"
      style={{
        backgroundImage:
          'linear-gradient(rgba(31,58,95,0.75), rgba(31,58,95,0.75)), url("/hero.jpg")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="w-full max-w-sm text-center">
        <img src="/logo.png" alt="OALD" className="mx-auto mb-6 h-20" />
        <h1 className="font-display text-2xl font-semibold text-white">
          Adaptive Learning Analytics Dashboard
        </h1>
        <p className="mt-2 text-sm text-white/80">
          Obafemi Awolowo University · Faculty of Computer Science and Engineering
        </p>

        <button
          onClick={() => googleLogin()}
          disabled={loading}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-full border border-white/30 bg-white px-6 py-3 text-sm font-semibold text-ink shadow-card transition hover:border-white disabled:opacity-60"
        >
          <GoogleIcon />
          {loading ? 'Signing in…' : 'Sign in with Google'}
        </button>

        <p className="mt-3 text-xs text-white/80">
          Your role (Student, Teacher, or Admin) is determined automatically from your Google
          Classroom account. We never see or store your Google password.
        </p>

        {error && <p className="mt-4 rounded-lg bg-atrisk/20 px-3 py-2 text-sm text-white">{error}</p>}

        {import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true' && (
          <div className="mt-10 rounded-xl border border-dashed border-white/30 bg-white/95 p-5 text-left">
            <p className="label mb-3">Dev-only bypass (no real Google account needed)</p>
            <div className="space-y-1.5">
              {DEV_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  onClick={() => handleDevLogin(acc.email)}
                  disabled={loading}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-paper disabled:opacity-60"
                >
                  <span>
                    <span className="font-medium text-ink">{acc.role}</span>
                    {acc.note && <span className="ml-2 text-xs text-slate-600">{acc.note}</span>}
                  </span>
                  <span className="font-mono text-xs text-slate-600">{acc.email}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-600">
              This panel only renders in a dev build, and the underlying route 404s outside
              <code className="mx-1 rounded bg-paper px-1 py-0.5">NODE_ENV=development</code>
              on the server regardless.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}