import { useState } from 'react';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form onSubmit={async (e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr('');
        try { await login(String(f.get('email')), String(f.get('password'))); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <img src="/logo.png" alt="Matias Brasil Engenharia" />
        <h1>SGI Matias Brasil</h1>
        <label className="fld"><span>E-mail</span><input name="email" type="email" autoComplete="username" required /></label>
        <label className="fld"><span>Senha</span><input name="password" type="password" autoComplete="current-password" required /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn pri" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
