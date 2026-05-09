// Package topics centralise la convention de topics MQTT ZEINA.
//
// Format mesures :
//
//	qlab/{tenant}/{site}/{zone}/{device}/{measurement}
//
// Format commande :
//
//	qlab/{tenant}/{site}/{zone}/{device}/cmd/{action}
//
// Format état (ACK) :
//
//	qlab/{tenant}/{site}/{zone}/{device}/state
//
// Tous les segments doivent matcher [a-z0-9-_] et ne contenir ni '/', ni '+',
// ni '#' (caractères réservés MQTT). Aucun segment ne peut être vide.
//
// Le préfixe "qlab" est figé pour permettre :
//   - une ACL Mosquitto compacte (`topic readwrite qlab/#`),
//   - une cohabitation avec d'autres systèmes sur le même broker.
package topics

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Prefix racine. Modifier nécessite de mettre à jour mosquitto/config/acl.
const Prefix = "qlab"

// Sous-chemins réservés (segment d'index 5).
const (
	subCommand = "cmd"
	subState   = "state"
)

// Kind — discrimine les types de topics ZEINA après parsing.
type Kind int

const (
	KindUnknown Kind = iota
	KindMeasurement
	KindCommand
	KindState
)

func (k Kind) String() string {
	switch k {
	case KindMeasurement:
		return "measurement"
	case KindCommand:
		return "command"
	case KindState:
		return "state"
	default:
		return "unknown"
	}
}

// Parts — résultat de Parse. Selon Kind :
//   - KindMeasurement : Measurement renseigné, Action vide
//   - KindCommand     : Action renseigné, Measurement vide
//   - KindState       : Measurement et Action vides
type Parts struct {
	Tenant      string
	Site        string
	Zone        string
	Device      string
	Kind        Kind
	Measurement string // KindMeasurement
	Action      string // KindCommand
}

// segmentRe — caractères autorisés dans un segment de topic (avant tout
// encodage MQTT). Volontairement strict : pas d'espace, pas de wildcard.
var segmentRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// ErrInvalidTopic — toute erreur de parsing/build de topic la wrappe.
var ErrInvalidTopic = errors.New("invalid topic")

// validateSegment retourne nil si s est un segment valide.
func validateSegment(field, s string) error {
	if s == "" {
		return fmt.Errorf("%w: %s is empty", ErrInvalidTopic, field)
	}
	if strings.ContainsAny(s, "/+#") {
		return fmt.Errorf("%w: %s contains reserved char (/, +, #)", ErrInvalidTopic, field)
	}
	if !segmentRe.MatchString(s) {
		return fmt.Errorf("%w: %s=%q must match [a-z0-9][a-z0-9_-]*", ErrInvalidTopic, field, s)
	}
	return nil
}

func validateAll(fields map[string]string) error {
	// Iteration ordre indéterminé mais le premier error suffit.
	for k, v := range fields {
		if err := validateSegment(k, v); err != nil {
			return err
		}
	}
	return nil
}

// BuildMeasurementTopic construit qlab/{tenant}/{site}/{zone}/{device}/{measurement}.
func BuildMeasurementTopic(tenant, site, zone, device, measurement string) (string, error) {
	if err := validateAll(map[string]string{
		"tenant": tenant, "site": site, "zone": zone,
		"device": device, "measurement": measurement,
	}); err != nil {
		return "", err
	}
	return strings.Join([]string{Prefix, tenant, site, zone, device, measurement}, "/"), nil
}

// BuildCommandTopic construit qlab/{tenant}/{site}/{zone}/{device}/cmd/{action}.
func BuildCommandTopic(tenant, site, zone, device, action string) (string, error) {
	if err := validateAll(map[string]string{
		"tenant": tenant, "site": site, "zone": zone,
		"device": device, "action": action,
	}); err != nil {
		return "", err
	}
	return strings.Join([]string{Prefix, tenant, site, zone, device, subCommand, action}, "/"), nil
}

// BuildStateTopic construit qlab/{tenant}/{site}/{zone}/{device}/state.
func BuildStateTopic(tenant, site, zone, device string) (string, error) {
	if err := validateAll(map[string]string{
		"tenant": tenant, "site": site, "zone": zone, "device": device,
	}); err != nil {
		return "", err
	}
	return strings.Join([]string{Prefix, tenant, site, zone, device, subState}, "/"), nil
}

// SubscriptionAllMeasurements — topic filter pour ingestor :
//
//	qlab/+/+/+/+/+
//
// Capture toutes les mesures sans capturer cmd/state (qui ont 7 ou 6 segments
// avec un littéral en position 5). Les états remontent comme un message
// 6-segments avec dernier segment "state" — l'ingestor doit le filtrer.
func SubscriptionAllMeasurements() string {
	return Prefix + "/+/+/+/+/+"
}

// SubscriptionAllCommands — topic filter pour les actionneurs et le rules-engine
// qui veut observer les commandes émises :
//
//	qlab/+/+/+/+/cmd/+
func SubscriptionAllCommands() string {
	return Prefix + "/+/+/+/+/cmd/+"
}

// SubscriptionAllStates — topic filter pour observer les ACK et états périodiques :
//
//	qlab/+/+/+/+/state
func SubscriptionAllStates() string {
	return Prefix + "/+/+/+/+/state"
}

// SubscriptionTenantWildcard — un tenant entier (toutes mesures + cmd + state).
func SubscriptionTenantWildcard(tenant string) (string, error) {
	if err := validateSegment("tenant", tenant); err != nil {
		return "", err
	}
	return Prefix + "/" + tenant + "/#", nil
}

// Parse décompose un topic ZEINA reçu et retourne ses parties + le Kind.
// Retourne ErrInvalidTopic si le format ne match aucune des trois formes.
func Parse(topic string) (Parts, error) {
	if topic == "" {
		return Parts{}, fmt.Errorf("%w: empty topic", ErrInvalidTopic)
	}
	segs := strings.Split(topic, "/")
	if len(segs) < 6 {
		return Parts{}, fmt.Errorf("%w: too few segments", ErrInvalidTopic)
	}
	if segs[0] != Prefix {
		return Parts{}, fmt.Errorf("%w: must start with %q", ErrInvalidTopic, Prefix)
	}

	p := Parts{
		Tenant: segs[1],
		Site:   segs[2],
		Zone:   segs[3],
		Device: segs[4],
	}
	if err := validateAll(map[string]string{
		"tenant": p.Tenant, "site": p.Site, "zone": p.Zone, "device": p.Device,
	}); err != nil {
		return Parts{}, err
	}

	switch {
	case len(segs) == 6 && segs[5] == subState:
		p.Kind = KindState
		return p, nil

	case len(segs) == 7 && segs[5] == subCommand:
		p.Kind = KindCommand
		p.Action = segs[6]
		if err := validateSegment("action", p.Action); err != nil {
			return Parts{}, err
		}
		return p, nil

	case len(segs) == 6:
		// Tout topic 6-segments dont le dernier n'est pas "state" est une mesure.
		// Un segment nommé "cmd" en position 5 d'un 6-tuple est ambigu : on le
		// rejette pour éviter une mesure nommée "cmd" qui collisionnerait
		// avec le préfixe commande à 7 segments.
		if segs[5] == subCommand {
			return Parts{}, fmt.Errorf("%w: measurement cannot be named %q", ErrInvalidTopic, subCommand)
		}
		p.Kind = KindMeasurement
		p.Measurement = segs[5]
		if err := validateSegment("measurement", p.Measurement); err != nil {
			return Parts{}, err
		}
		return p, nil

	default:
		return Parts{}, fmt.Errorf("%w: unrecognized shape (%d segments)", ErrInvalidTopic, len(segs))
	}
}
