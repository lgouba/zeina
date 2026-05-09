import { useState, type FormEvent } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { HttpError } from "../lib/api";
import { Activity } from "lucide-react";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@acme.test");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (err instanceof HttpError) setError(err.payload.message);
      else setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 bg-slate-900 rounded-2xl p-8 border border-slate-800 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-500/10 p-2">
            <Activity className="h-7 w-7 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">ZEINA</h1>
            <p className="text-xs text-slate-400">Hyperviseur énergie & environnement</p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-400">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Mot de passe</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </label>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>
        )}

        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition">
          {loading ? "Connexion…" : "Se connecter"}
        </button>

        <p className="text-xs text-slate-500 text-center">
          Démo : <code className="text-slate-300">admin@acme.test</code> / <code className="text-slate-300">admin123</code>
        </p>
      </form>
    </div>
  );
}
