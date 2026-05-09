package mailer

import (
	"fmt"
	"html"
	"strings"
)

// WelcomeData regroupe les variables utilisées par le template "première
// connexion" envoyé à un user créé par un admin.
type WelcomeData struct {
	FullName string // peut être vide → "Bonjour"
	Email    string
	Code     string // 6 chiffres
	URL      string // ex: https://zeina.qalitylabs.fr/first-login?email=alice@x.com
	BrandName string
	ExpireMinutes int // ex: 15
}

// ResetData regroupe les variables du template "mot de passe oublié".
type ResetData struct {
	FullName string
	Email    string
	Code     string
	URL      string
	BrandName string
	ExpireMinutes int
}

// BuildWelcome rend les versions HTML + texte du mail "première connexion".
func BuildWelcome(d WelcomeData) (subject, htmlBody, textBody string) {
	if d.BrandName == "" {
		d.BrandName = "ZEINA"
	}
	if d.ExpireMinutes == 0 {
		d.ExpireMinutes = 15
	}
	greeting := "Bonjour"
	if d.FullName != "" {
		greeting = "Bonjour " + d.FullName
	}
	subject = fmt.Sprintf("%s — Activation de votre compte", d.BrandName)

	htmlBody = layout(d.BrandName, fmt.Sprintf(`
		<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a;">Bienvenue sur %s</h1>
		<p>%s,</p>
		<p>Un compte a été créé pour vous sur la plateforme <strong>%s</strong>.</p>
		<p>Pour activer votre compte et définir votre mot de passe, utilisez le code de vérification ci-dessous :</p>
		%s
		<p style="margin-top:24px;">Cliquez sur le bouton pour saisir votre code et créer votre mot de passe :</p>
		<p style="text-align:center;margin:24px 0;">
			<a href="%s" style="display:inline-block;background:#0ea5e9;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Activer mon compte</a>
		</p>
		<p style="font-size:13px;color:#64748b;">Ce code expire dans <strong>%d minutes</strong> et n'est utilisable qu'une seule fois.<br>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
	`, html.EscapeString(d.BrandName), html.EscapeString(greeting), html.EscapeString(d.BrandName),
		codeBlock(d.Code), html.EscapeString(d.URL), d.ExpireMinutes))

	var t strings.Builder
	fmt.Fprintf(&t, "%s,\n\n", greeting)
	fmt.Fprintf(&t, "Un compte a été créé pour vous sur la plateforme %s.\n\n", d.BrandName)
	fmt.Fprintf(&t, "Code de vérification : %s\n", d.Code)
	fmt.Fprintf(&t, "Ce code expire dans %d minutes.\n\n", d.ExpireMinutes)
	fmt.Fprintf(&t, "Activer votre compte : %s\n\n", d.URL)
	fmt.Fprintf(&t, "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n")
	textBody = t.String()
	return
}

// BuildReset rend les versions HTML + texte du mail "mot de passe oublié".
func BuildReset(d ResetData) (subject, htmlBody, textBody string) {
	if d.BrandName == "" {
		d.BrandName = "ZEINA"
	}
	if d.ExpireMinutes == 0 {
		d.ExpireMinutes = 15
	}
	greeting := "Bonjour"
	if d.FullName != "" {
		greeting = "Bonjour " + d.FullName
	}
	subject = fmt.Sprintf("%s — Réinitialisation de votre mot de passe", d.BrandName)

	htmlBody = layout(d.BrandName, fmt.Sprintf(`
		<h1 style="margin:0 0 16px;font-size:22px;color:#0f172a;">Réinitialiser votre mot de passe</h1>
		<p>%s,</p>
		<p>Vous avez demandé à réinitialiser votre mot de passe sur <strong>%s</strong>.</p>
		<p>Voici votre code de vérification :</p>
		%s
		<p style="margin-top:24px;">Cliquez sur le bouton pour saisir votre code et choisir un nouveau mot de passe :</p>
		<p style="text-align:center;margin:24px 0;">
			<a href="%s" style="display:inline-block;background:#0ea5e9;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Réinitialiser mon mot de passe</a>
		</p>
		<p style="font-size:13px;color:#64748b;">Ce code expire dans <strong>%d minutes</strong> et n'est utilisable qu'une seule fois.<br>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email — votre mot de passe actuel reste valide.</p>
	`, html.EscapeString(greeting), html.EscapeString(d.BrandName),
		codeBlock(d.Code), html.EscapeString(d.URL), d.ExpireMinutes))

	var t strings.Builder
	fmt.Fprintf(&t, "%s,\n\n", greeting)
	fmt.Fprintf(&t, "Vous avez demandé à réinitialiser votre mot de passe sur %s.\n\n", d.BrandName)
	fmt.Fprintf(&t, "Code de vérification : %s\n", d.Code)
	fmt.Fprintf(&t, "Ce code expire dans %d minutes.\n\n", d.ExpireMinutes)
	fmt.Fprintf(&t, "Réinitialiser : %s\n\n", d.URL)
	fmt.Fprintf(&t, "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.\n")
	textBody = t.String()
	return
}

// codeBlock — rend le code 6 chiffres dans une grosse boîte centrée.
func codeBlock(code string) string {
	return fmt.Sprintf(`
		<div style="margin:24px 0;text-align:center;">
			<div style="display:inline-block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:18px 32px;">
				<span style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:8px;color:#0f172a;">%s</span>
			</div>
		</div>
	`, html.EscapeString(code))
}

// layout — coquille HTML commune (header logo + corps + footer).
func layout(brand, body string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;">
	<table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 16px;">
		<tr><td align="center">
			<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%%;background:white;border-radius:16px;box-shadow:0 1px 3px rgba(15,23,42,0.08);overflow:hidden;">
				<tr><td style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:24px 32px;color:white;">
					<div style="font-size:18px;font-weight:700;letter-spacing:-0.5px;">%s</div>
					<div style="font-size:13px;opacity:0.85;">Hyperviseur IoT</div>
				</td></tr>
				<tr><td style="padding:32px;">%s</td></tr>
				<tr><td style="background:#f8fafc;padding:16px 32px;font-size:12px;color:#94a3b8;text-align:center;">
					Email envoyé automatiquement par %s — ne pas répondre.
				</td></tr>
			</table>
		</td></tr>
	</table>
</body></html>`, html.EscapeString(brand), body, html.EscapeString(brand))
}
