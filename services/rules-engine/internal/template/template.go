// Package template — substitution de variables dans les messages de règles.
//
// Syntaxe :  texte avec {device.name} et {value}{unit}.
//
// Le moteur construit un Context au moment du tir d'une règle (déclencheur
// matché + conditions OK), puis le passe à l'executor pour résoudre les
// templates dans notify.message, email.subject/body, sms.message, webhook.body.
//
// Volontairement minimaliste : pas de Go html/template, pas de logique
// conditionnelle. Juste un find-replace sur des clés bien connues.
package template

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// Context — toutes les données disponibles pour la substitution.
// Les valeurs vides sont remplacées par "" (pas par le placeholder lui-même).
type Context struct {
	// Règle
	RuleID   uuid.UUID
	RuleName string

	// Tenant / site / zone
	TenantSlug string
	SiteSlug   string
	SiteName   string
	ZoneSlug   string
	ZoneName   string

	// Device qui a déclenché (pour cron : peut être vide)
	DeviceSlug string
	DeviceName string

	// Mesure courante
	Measurement string
	Unit        string
	Value       *float64 // nil pour cron
	Op          string   // ex: ">"
	Threshold   *float64 // valeur du trigger threshold

	// Niveau de l'action (pour notify/email/sms qui le portent)
	Level string

	// Horodatage du tir
	Timestamp time.Time
}

// vars construit la map de remplacement à partir du Context.
func (c Context) vars() map[string]string {
	v := map[string]string{
		"rule.id":     c.RuleID.String(),
		"rule.name":   c.RuleName,
		"tenant":      c.TenantSlug,
		"tenant.slug": c.TenantSlug,
		"site":        c.SiteName,
		"site.slug":   c.SiteSlug,
		"site.name":   c.SiteName,
		"zone":        c.ZoneName,
		"zone.slug":   c.ZoneSlug,
		"zone.name":   c.ZoneName,
		"device":      c.DeviceName,
		"device.slug": c.DeviceSlug,
		"device.name": c.DeviceName,
		"device.zone": c.ZoneName,
		"measurement": c.Measurement,
		"unit":        c.Unit,
		"op":          c.Op,
		"level":       c.Level,
	}
	ts := c.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	v["timestamp"] = ts.Format("2006-01-02 15:04:05")
	v["date"] = ts.Format("02/01/2006")
	v["time"] = ts.Format("15:04:05")
	if c.Value != nil {
		v["value"] = formatNum(*c.Value)
	}
	if c.Threshold != nil {
		v["threshold"] = formatNum(*c.Threshold)
	}
	// Aliases pratiques
	if c.DeviceName == "" {
		v["device"] = c.DeviceSlug
		v["device.name"] = c.DeviceSlug
	}
	if c.ZoneName == "" {
		v["zone"] = c.ZoneSlug
		v["zone.name"] = c.ZoneSlug
	}
	return v
}

// re — variables de la forme {token} où token = lettres/chiffres/_/. (clés dotted).
var re = regexp.MustCompile(`\{([a-zA-Z_][a-zA-Z0-9_.]*)\}`)

// Resolve remplace toutes les variables connues dans s. Les inconnues sont
// laissées telles quelles (ex: `{unknown}` reste `{unknown}`) pour que les
// erreurs de saisie soient visibles à l'usage.
func Resolve(s string, ctx Context) string {
	if s == "" {
		return s
	}
	vars := ctx.vars()
	return re.ReplaceAllStringFunc(s, func(match string) string {
		key := match[1 : len(match)-1]
		if v, ok := vars[key]; ok {
			return v
		}
		return match
	})
}

// ResolveSlice — utilitaire pour appliquer Resolve sur chaque élément.
func ResolveSlice(items []string, ctx Context) []string {
	if len(items) == 0 {
		return items
	}
	out := make([]string, len(items))
	for i, s := range items {
		out[i] = Resolve(s, ctx)
	}
	return out
}

func formatNum(f float64) string {
	// 2 décimales si non-entier, sinon entier sec.
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return fmt.Sprintf("%.2f", f)
}
