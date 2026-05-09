// Package mailer encapsule l'envoi d'emails transactionnels via SMTP.
//
// Configuration via variables d'environnement (lues dans cmd/api/main.go) :
//
//	SMTP_HOST       — hôte SMTP (vide = mode stub, pas d'envoi réel)
//	SMTP_PORT       — défaut 587
//	SMTP_USERNAME   — login SMTP
//	SMTP_PASSWORD   — mot de passe SMTP
//	SMTP_FROM       — adresse "From" (défaut = SMTP_USERNAME)
//	SMTP_FROM_NAME  — nom affiché (ex: "ZEINA Hyperviseur")
//	SMTP_TLS        — "starttls" (défaut), "tls" (SSL implicite, port 465), "none"
//
// En mode stub, Send retourne nil et logge le contenu — utile en dev/CI.
package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"net/smtp"
	"strings"

	"github.com/rs/zerolog"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	FromName string
	TLSMode  string // starttls | tls | none
}

func (c Config) Configured() bool {
	return c.Host != "" && c.From != ""
}

type Mailer struct {
	cfg Config
	log zerolog.Logger
}

func New(cfg Config, log zerolog.Logger) *Mailer {
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	if cfg.TLSMode == "" {
		cfg.TLSMode = "starttls"
	}
	if cfg.From == "" {
		cfg.From = cfg.Username
	}
	return &Mailer{cfg: cfg, log: log}
}

// Send envoie un email HTML (avec fallback texte) à `to`.
// Retourne nil sans envoi si le mailer est non configuré (mode stub).
func (m *Mailer) Send(to []string, subject, htmlBody, textBody string) error {
	if !m.cfg.Configured() {
		m.log.Info().
			Strs("to", to).Str("subject", subject).
			Msg("mailer stub — message not actually sent")
		return nil
	}
	if len(to) == 0 {
		return errors.New("mailer: no recipient")
	}

	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)
	from := m.cfg.From
	fromHeader := from
	if m.cfg.FromName != "" {
		fromHeader = fmt.Sprintf("%s <%s>", m.cfg.FromName, from)
	}

	msg := buildMultipart(fromHeader, to, subject, htmlBody, textBody)

	var auth smtp.Auth
	if m.cfg.Username != "" && m.cfg.Password != "" {
		auth = smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)
	}

	switch strings.ToLower(m.cfg.TLSMode) {
	case "tls":
		return sendImplicitTLS(addr, m.cfg.Host, auth, from, to, msg)
	default: // starttls / none — net/smtp gère STARTTLS si offert par le serveur
		return smtp.SendMail(addr, auth, from, to, msg)
	}
}

// buildMultipart assemble un message multipart/alternative avec une partie
// text/plain (fallback) et text/html (preferred). Boundary fixe — c'est OK
// pour des messages courts type code 6 chiffres.
func buildMultipart(from string, to []string, subject, htmlBody, textBody string) []byte {
	const boundary = "zeinaboundary8a3c1f9d"
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
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")

	// Partie texte
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(textBody)
	b.WriteString("\r\n\r\n")

	// Partie HTML
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(htmlBody)
	b.WriteString("\r\n\r\n")
	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

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
