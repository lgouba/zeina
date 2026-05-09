// Package mqtt fournit un wrapper minimal autour de paho.mqtt.golang qui :
//   - centralise les options de connexion (auth, TLS, LWT)
//   - active reconnexion exponentielle automatique
//   - expose Connect/Disconnect/Publish/Subscribe/Unsubscribe en synchrone
//   - propage le contexte (annulation = disconnect)
//
// Tous les services Go (api, ingestor, rules-engine, simulator) utilisent ce
// helper afin que le comportement réseau soit homogène.
package mqtt

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// Options regroupe toute la config nécessaire pour ouvrir une session MQTT.
// Les défauts sont appliqués par DefaultOptions().
type Options struct {
	BrokerURL      string // ex: "tcp://mosquitto:1883"
	ClientID       string // si vide, généré (uuid)
	Username       string
	Password       string
	CleanSession   bool          // false = QoS 1/2 garanti à la reconnexion
	KeepAlive      time.Duration // défaut 30s
	ConnectTimeout time.Duration // défaut 10s
	WriteTimeout   time.Duration // défaut 5s
	OrderMatters   bool          // false = handlers parallèles (défaut)
	TLSConfig      *tls.Config   // si non-nil, mqtt:// → mqtts://
	WillTopic      string        // last will topic (vide = pas de LWT)
	WillPayload    []byte
	WillQoS        byte
	WillRetain     bool

	// Logger (optionnel) — si fourni, événements connexion/perte/reconnect loggés.
	Logger *zerolog.Logger
}

// DefaultOptions remplit les champs non renseignés avec des valeurs sensées.
func DefaultOptions(brokerURL string) Options {
	return Options{
		BrokerURL:      brokerURL,
		CleanSession:   false,
		KeepAlive:      30 * time.Second,
		ConnectTimeout: 10 * time.Second,
		WriteTimeout:   5 * time.Second,
		OrderMatters:   false,
	}
}

// Client — wrapper autour de paho.Client avec API contextuelle.
type Client struct {
	inner paho.Client
	opts  Options
	log   zerolog.Logger
}

// New crée un Client mais ne se connecte pas. Appeler Connect ensuite.
func New(opts Options) (*Client, error) {
	if opts.BrokerURL == "" {
		return nil, errors.New("mqtt: BrokerURL is required")
	}
	if opts.ClientID == "" {
		opts.ClientID = "zeina-" + uuid.NewString()
	}
	if opts.KeepAlive <= 0 {
		opts.KeepAlive = 30 * time.Second
	}
	if opts.ConnectTimeout <= 0 {
		opts.ConnectTimeout = 10 * time.Second
	}
	if opts.WriteTimeout <= 0 {
		opts.WriteTimeout = 5 * time.Second
	}

	var log zerolog.Logger
	if opts.Logger != nil {
		log = opts.Logger.With().Str("component", "mqtt").Str("client_id", opts.ClientID).Logger()
	} else {
		log = zerolog.Nop()
	}

	o := paho.NewClientOptions().
		AddBroker(opts.BrokerURL).
		SetClientID(opts.ClientID).
		SetCleanSession(opts.CleanSession).
		SetKeepAlive(opts.KeepAlive).
		SetConnectTimeout(opts.ConnectTimeout).
		SetWriteTimeout(opts.WriteTimeout).
		SetOrderMatters(opts.OrderMatters).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(60 * time.Second).
		SetConnectRetry(true).
		SetConnectRetryInterval(2 * time.Second).
		SetResumeSubs(true)

	if opts.Username != "" {
		o.SetUsername(opts.Username)
		o.SetPassword(opts.Password)
	}
	if opts.TLSConfig != nil {
		o.SetTLSConfig(opts.TLSConfig)
	}
	if opts.WillTopic != "" {
		o.SetBinaryWill(opts.WillTopic, opts.WillPayload, opts.WillQoS, opts.WillRetain)
	}

	o.OnConnect = func(_ paho.Client) {
		log.Info().Str("broker", opts.BrokerURL).Msg("mqtt connected")
	}
	o.OnConnectionLost = func(_ paho.Client, err error) {
		log.Warn().Err(err).Msg("mqtt connection lost")
	}
	o.OnReconnecting = func(_ paho.Client, _ *paho.ClientOptions) {
		log.Info().Msg("mqtt reconnecting")
	}

	return &Client{
		inner: paho.NewClient(o),
		opts:  opts,
		log:   log,
	}, nil
}

// Connect ouvre la session. Bloque jusqu'à connexion ou ctx done.
func (c *Client) Connect(ctx context.Context) error {
	tok := c.inner.Connect()
	if !waitToken(ctx, tok, c.opts.ConnectTimeout) {
		return fmt.Errorf("mqtt connect: %w", tokenErr(tok, ctx))
	}
	return nil
}

// Disconnect ferme la session proprement (laisse jusqu'à quiesce ms pour vider
// les inflight). Idempotent.
func (c *Client) Disconnect(quiesceMs uint) {
	if c.inner.IsConnected() {
		c.inner.Disconnect(quiesceMs)
	}
}

// IsConnected reflète l'état réseau actuel.
func (c *Client) IsConnected() bool {
	return c.inner.IsConnected()
}

// Publish envoie un message. Bloque jusqu'à ACK (QoS 1/2) ou ctx done.
func (c *Client) Publish(ctx context.Context, topic string, qos byte, retained bool, payload []byte) error {
	tok := c.inner.Publish(topic, qos, retained, payload)
	if !waitToken(ctx, tok, c.opts.WriteTimeout) {
		return fmt.Errorf("mqtt publish %s: %w", topic, tokenErr(tok, ctx))
	}
	return nil
}

// Handler — signature des callbacks de subscription.
type Handler func(topic string, payload []byte)

// Subscribe abonne au filtre topicFilter. Le handler est invoqué à chaque
// message reçu. Bloque jusqu'à ACK SUBACK.
func (c *Client) Subscribe(ctx context.Context, topicFilter string, qos byte, handler Handler) error {
	cb := func(_ paho.Client, m paho.Message) {
		handler(m.Topic(), m.Payload())
	}
	tok := c.inner.Subscribe(topicFilter, qos, cb)
	if !waitToken(ctx, tok, c.opts.WriteTimeout) {
		return fmt.Errorf("mqtt subscribe %s: %w", topicFilter, tokenErr(tok, ctx))
	}
	return nil
}

// SubscribeMultiple abonne à plusieurs filtres avec un seul handler — utile
// quand un service écoute mesures + commandes + état.
func (c *Client) SubscribeMultiple(ctx context.Context, filters map[string]byte, handler Handler) error {
	cb := func(_ paho.Client, m paho.Message) {
		handler(m.Topic(), m.Payload())
	}
	tok := c.inner.SubscribeMultiple(filters, cb)
	if !waitToken(ctx, tok, c.opts.WriteTimeout) {
		return fmt.Errorf("mqtt subscribe-multi: %w", tokenErr(tok, ctx))
	}
	return nil
}

// Unsubscribe désabonne d'un ou plusieurs filtres.
func (c *Client) Unsubscribe(ctx context.Context, topicFilters ...string) error {
	tok := c.inner.Unsubscribe(topicFilters...)
	if !waitToken(ctx, tok, c.opts.WriteTimeout) {
		return fmt.Errorf("mqtt unsubscribe: %w", tokenErr(tok, ctx))
	}
	return nil
}

// --- helpers ----------------------------------------------------------------

// waitToken bloque jusqu'à token complete OU ctx.Done OU timeout. Retourne
// true si token a complété sans erreur.
func waitToken(ctx context.Context, tok paho.Token, timeout time.Duration) bool {
	select {
	case <-tok.Done():
		return tok.Error() == nil
	case <-ctx.Done():
		return false
	case <-time.After(timeout):
		return false
	}
}

func tokenErr(tok paho.Token, ctx context.Context) error {
	if err := tok.Error(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return errors.New("timeout")
}
