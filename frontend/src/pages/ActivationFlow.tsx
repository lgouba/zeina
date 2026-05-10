// Composant partagé entre /first-login et /forgot-password.
//
// Étapes :
//   1. Saisie du code 6 chiffres (l'email est pré-rempli depuis l'URL ou
//      vide à compléter)
//   2. Saisie du nouveau mot de passe (avec confirm) — visible une fois le
//      code validé
//   3. Auto-login + redirection vers /
//
// Utilisé tel quel pour first_login. Pour password_reset, la page parent
// peut afficher en amont un formulaire "saisis ton email" qui appelle
// /v1/auth/forgot-password puis bascule sur ce composant.

import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ArrowLeft, CheckCircle2 } from "lucide-react";
import { api, HttpError } from "../lib/api";
import { useAuth } from "../lib/auth";

type Purpose = "first_login" | "password_reset";

interface VerifyResp {
  nonce: string;
  expires_at: string;
}

interface SetPwdResp {
  access_token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    tenant_role: string;
    is_superadmin: boolean;
    tenant_id: string;
    full_name?: string;
  };
}

interface Props {
  purpose: Purpose;
  title: string;
  intro: string;
}

export function ActivationFlow({ purpose, title, intro }: Props) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { acceptSession } = useAuth();

  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [nonce, setNonce] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Si l'URL contient ?email=, focus auto sur le code (sinon sur l'email).
  useEffect(() => {
    if (params.get("email") && step === 1) {
      const el = document.getElementById("code-input") as HTMLInputElement | null;
      el?.focus();
    }
  }, [params, step]);

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setError("Le code doit contenir 6 chiffres.");
      return;
    }
    setLoading(true); setError(null);
    try {
      const r = await api.post<VerifyResp>("/v1/auth/verify-code", { email, code, purpose });
      setNonce(r.nonce);
      setStep(2);
    } catch (err) {
      setError(err instanceof HttpError ? err.payload.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    const pwdErr = validatePasswordClient(password);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!nonce) {
      setError("Session expirée — recommencez avec un nouveau code.");
      setStep(1);
      return;
    }
    setLoading(true); setError(null);
    try {
      const r = await api.post<SetPwdResp>("/v1/auth/set-password", { nonce, password });
      // Auto-login propre : on délègue à AuthProvider (set state + persist + /me).
      await acceptSession(r.access_token, r.user as never, r.expires_at);
      navigate("/");
    } catch (err) {
      setError(err instanceof HttpError ? err.payload.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6 bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl dark:shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-brand-500/10 p-2">
            <Activity className="h-7 w-7 text-brand-500 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{intro}</p>
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={submitCode} className="space-y-4">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                className="mt-1 block w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Code reçu par email (6 chiffres)</span>
              <input id="code-input" type="text" inputMode="numeric" pattern="\d{6}" required
                value={code} maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                className="mt-1 block w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] focus:border-brand-500 focus:outline-none" />
            </label>

            {error && <ErrorBox msg={error} />}

            <button type="submit" disabled={loading || code.length !== 6}
              className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition">
              {loading ? "Vérification…" : "Vérifier le code"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Code vérifié. Définissez votre mot de passe.</span>
            </div>

            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Nouveau mot de passe</span>
              <input type="password" required minLength={10} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
              <span className="mt-1 block text-[11px] text-slate-400">10 caractères min, au moins une lettre et un chiffre.</span>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Confirmer</span>
              <input type="password" required minLength={10} value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 block w-full rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            </label>

            {error && <ErrorBox msg={error} />}

            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition">
              {loading ? "Création…" : "Créer mon mot de passe"}
            </button>
          </form>
        )}

        <Link to="/login" className="flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" /> Retour à la connexion
        </Link>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{msg}</div>;
}

// validatePasswordClient — miroir simplifié de la politique serveur.
// Le serveur reste autorité ; ceci évite juste un round-trip pour les erreurs
// évidentes côté UI.
function validatePasswordClient(p: string): string | null {
  if (p.length < 10) return "Le mot de passe doit faire au moins 10 caractères.";
  if (p.length > 128) return "Le mot de passe est trop long (128 caractères max).";
  if (p !== p.trim()) return "Pas d'espace au début ou à la fin.";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) return "Caractère de contrôle interdit.";
  return null;
}
