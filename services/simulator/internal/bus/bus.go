// Package bus fournit un canal d'état partagé entre devices d'un même site.
//
// Cas d'usage :
//   - le profil "lux" (zone open-space) lit l'état du relais lumière voisin
//     pour décider si la pièce est éclairée artificiellement
//   - le profil "linky" (zone tableau-elec) lit l'état des relais lumière du
//     site + le présence courant pour simuler les pics de consommation
//   - le profil "co2" lit le présence courant pour ajuster l'occupation
//
// Le scope est volontairement le site et non la zone : un compteur électrique
// central agrège la consommation de tous les zones, et il est plus naturel
// que les couplages YAML référencent les devices par leur slug sans
// hiérarchie supplémentaire. Conséquence : les slugs de device doivent être
// uniques au niveau site (le validator de config le garantit déjà).
package bus

import "sync"

// Bus — sac à clés/valeurs thread-safe scoped à une zone.
type Bus struct {
	mu    sync.RWMutex
	state map[string]any
}

func New() *Bus {
	return &Bus{state: make(map[string]any)}
}

// Set écrit l'état d'un device. Override sans erreur.
func (b *Bus) Set(deviceID string, value any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.state[deviceID] = value
}

// Get retourne (valeur, true) si le device a déjà publié au moins une fois.
func (b *Bus) Get(deviceID string) (any, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	v, ok := b.state[deviceID]
	return v, ok
}

// GetString — helper pour les états textuels (ex: relais "on"/"off").
// Retourne def si la clé est absente ou de type incompatible.
func (b *Bus) GetString(deviceID, def string) string {
	v, ok := b.Get(deviceID)
	if !ok {
		return def
	}
	if s, ok := v.(string); ok {
		return s
	}
	return def
}

// GetBool — helper pour les états booléens (ex: présence 0/1).
func (b *Bus) GetBool(deviceID string, def bool) bool {
	v, ok := b.Get(deviceID)
	if !ok {
		return def
	}
	if b, ok := v.(bool); ok {
		return b
	}
	return def
}

// GetFloat — helper pour les valeurs numériques.
func (b *Bus) GetFloat(deviceID string, def float64) float64 {
	v, ok := b.Get(deviceID)
	if !ok {
		return def
	}
	if f, ok := v.(float64); ok {
		return f
	}
	return def
}
