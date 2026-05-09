// Mot de passe oublié — 2 phases :
//   A. L'utilisateur n'a pas encore reçu de code → on lui demande son email
//      et on appelle /v1/auth/forgot-password (toujours OK, anti-énumération).
//   B. Une fois le code envoyé (ou si arrivée par lien email), on bascule
//      sur ActivationFlow purpose=password_reset.

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, ArrowLeft, MailCheck } from "lucide-react";
import { api, HttpError } from "../lib/api";
import { ActivationFlow } from "./ActivationFlow";

export function ForgotPasswordPage() {
  const [params, setParams] = useSearchParams();
  const hasEmail = !!params.get("email");

  // Si on arrive avec ?email=, on est probablement sur le lien du mail :
  // on saute direct à ActivationFlow.
  if (hasEmail) {
    return (
      <ActivationFlow
        purpose="password_reset"
        title="Réinitialiser mon mot de passe"
        intro="Saisissez le code reçu par email"
      />
    );
  }

  return <RequestEmailForm onSent={(email) => setParams({ email })} />;
}

function RequestEmailForm({ onSent }: { onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await api.post("/v1/auth/forgot-password", { email });
      onSent(email);
    } catch (err) {
      setError(err instanceof HttpError ? err.payload.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit}
        className="w-full max-w-sm space-y-6 bg-slate-900 rounded-2xl p-8 border border-slate-800 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-500/10 p-2">
            <Activity className="h-7 w-7 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Mot de passe oublié</h1>
            <p className="text-xs text-slate-400">Recevez un code de réinitialisation</p>
          </div>
        </div>

        <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-800/50 rounded-lg p-3">
          <MailCheck className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
          <span>Si un compte existe pour cet email, un code à 6 chiffres vous sera envoyé. Le code expire après 15 minutes.</span>
        </div>

        <label className="block">
          <span className="text-xs text-slate-400">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
        </label>

        {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>}

        <button type="submit" disabled={loading || !email}
          className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition">
          {loading ? "Envoi…" : "Envoyer le code"}
        </button>

        <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" /> Retour à la connexion
        </Link>
      </form>
    </div>
  );
}
