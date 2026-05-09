// Package config centralise le chargement de configuration via viper.
//
// Convention : chaque service appelle Load() au démarrage avec son nom et un
// pointeur vers sa propre struct typée. La struct est remplie depuis :
//  1. valeurs par défaut (.SetDefault avant Load)
//  2. fichier YAML si fourni (chemin via paramètre ou variable d'env <SVC>_CONFIG)
//  3. variables d'environnement (préfixées par le nom du service en majuscules)
//
// Les noms de champs YAML sont snake_case ; les variables d'env sont
// SCREAMING_SNAKE_CASE.
package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/viper"
)

// Loader fournit Set + Load sur viper. Conserver une instance par service.
type Loader struct {
	v       *viper.Viper
	service string
}

// NewLoader crée un loader pour le service donné. envPrefix est utilisé pour
// les variables d'environnement (ex: "API" → "API_PORT", "API_JWT_SECRET").
// Si envPrefix est vide, on utilise le nom du service en uppercase.
func NewLoader(service, envPrefix string) *Loader {
	if envPrefix == "" {
		envPrefix = strings.ToUpper(service)
	}
	v := viper.New()
	v.SetEnvPrefix(envPrefix)
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_", "-", "_"))
	return &Loader{v: v, service: service}
}

// SetDefault expose viper.SetDefault.
func (l *Loader) SetDefault(key string, value any) {
	l.v.SetDefault(key, value)
}

// BindEnv force le binding d'une clé sur une variable d'env spécifique
// (utile quand le nom d'env diffère de la convention préfixe+clé).
func (l *Loader) BindEnv(key, envVar string) error {
	return l.v.BindEnv(key, envVar)
}

// LoadFile charge un fichier YAML facultatif. Le service appelant peut
// court-circuiter en passant un chemin vide — seules les défauts + l'env
// sont alors utilisés.
func (l *Loader) LoadFile(path string) error {
	if path == "" {
		return nil
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("config: file not found: %s", path)
	}
	l.v.SetConfigFile(path)
	if err := l.v.ReadInConfig(); err != nil {
		return fmt.Errorf("config: read %s: %w", path, err)
	}
	return nil
}

// Unmarshal remplit out (pointeur vers struct) à partir des sources chargées.
func (l *Loader) Unmarshal(out any) error {
	if err := l.v.Unmarshal(out); err != nil {
		return fmt.Errorf("config: unmarshal: %w", err)
	}
	return nil
}

// Viper retourne l'instance sous-jacente — pour cas avancés.
func (l *Loader) Viper() *viper.Viper {
	return l.v
}

// MustGetString panic si la clé est absente. À n'utiliser qu'au démarrage du
// service, pour les secrets indispensables (ex: DATABASE_URL).
func MustGetString(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("config: required env var %s is empty", key))
	}
	return v
}

// GetStringDefault lit une variable d'env, retourne def si vide.
func GetStringDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
