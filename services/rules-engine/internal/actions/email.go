// Package actions — provider d'envoi d'emails via SMTP standard.
//
// Configuration via variables d'environnement (lues dans cmd/rules/main.go) :
//
//   SMTP_HOST       — hôte SMTP (ex: smtp.gmail.com)
//   SMTP_PORT       — port (587 par défaut, 465 pour SSL implicite)
//   SMTP_USERNAME   — login (souvent l'adresse expéditrice)
//   SMTP_PASSWORD   — mot de passe ou app-password
//   SMTP_FROM       — adresse "From" (défaut = SMTP_USERNAME)
//   SMTP_FROM_NAME  — nom affiché (ex: "ZEINA Hyperviseur")
//   SMTP_TLS        — "starttls" (défaut), "tls", ou "none"
//
// Si SMTP_HOST n'est pas défini, le provider est "stub" — il n'envoie rien
// mais retourne nil (l'action est marquée success avec un flag delivered=false
// dans la trace d'exécution).

package actions

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/smtp"
	"strings"
)

type EmailConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
	TLSMode  string // starttls | tls | none
}

// Configured indique si un envoi SMTP réel est possible.
func (c EmailConfig) Configured() bool {
	return c.Host != "" && c.From != ""
}

// EmailProvider envoie des emails via SMTP. Si non configuré, Send retourne
// (false, nil) — l'action est considérée comme un succès mais avec
// delivered=false dans la trace.
type EmailProvider struct {
	cfg EmailConfig
}

func NewEmailProvider(cfg EmailConfig) *EmailProvider {
	if cfg.From == "" {
		cfg.From = cfg.Username
	}
	if cfg.TLSMode == "" {
		cfg.TLSMode = "starttls"
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	return &EmailProvider{cfg: cfg}
}

// Send envoie un email à `to` (peut contenir plusieurs adresses). Retourne
// (delivered, err).
//   - delivered=true, err=nil  : SMTP a accepté le message
//   - delivered=false, err=nil : provider non configuré (mode stub)
//   - delivered=false, err≠nil : tentative d'envoi a échoué
func (p *EmailProvider) Send(to []string, subject, body string) (bool, error) {
	if !p.cfg.Configured() {
		return false, nil
	}
	if len(to) == 0 {
		return false, errors.New("no recipient")
	}

	addr := fmt.Sprintf("%s:%d", p.cfg.Host, p.cfg.Port)
	from := p.cfg.From
	fromHeader := from
	if p.cfg.FromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", p.cfg.FromName, from)
	}

	msg := buildMessage(fromHeader, to, subject, body)

	var auth smtp.Auth
	if p.cfg.Username != "" && p.cfg.Password != "" {
		auth = smtp.PlainAuth("", p.cfg.Username, p.cfg.Password, p.cfg.Host)
	}

	switch strings.ToLower(p.cfg.TLSMode) {
	case "tls":
		if err := sendImplicitTLS(addr, p.cfg.Host, auth, from, to, msg); err != nil {
			return false, err
		}
	default: // starttls / none — net/smtp gère STARTTLS automatiquement
		if err := smtp.SendMail(addr, auth, from, to, msg); err != nil {
			return false, err
		}
	}
	return true, nil
}

func buildMessage(from string, to []string, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: ")
	b.WriteString(from)
	b.WriteString("\r\n")
	b.WriteString("To: ")
	b.WriteString(strings.Join(to, ", "))
	b.WriteString("\r\n")
	b.WriteString("Subject: ")
	b.WriteString(subject)
	b.WriteString("\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	b.WriteString("\r\n")
	return []byte(b.String())
}

// sendImplicitTLS établit une connexion TLS d'emblée (port 465 typiquement)
// et envoie le mail. net/smtp ne le gère pas seul.
func sendImplicitTLS(addr, host string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
	if err != nil {
		return fmt.Errorf("tls dial %s: %w", addr, err)
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	if auth != nil {
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth: %w", err)
			}
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, addr := range to {
		if err := c.Rcpt(addr); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
