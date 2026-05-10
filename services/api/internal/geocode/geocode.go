// Package geocode — résout une adresse postale en coordonnées GPS.
//
// Stratégie (deux providers gratuits et souverains) :
//
//  1. Base Adresse Nationale FR (api-adresse.data.gouv.fr) — gratuit, sans
//     clé, hébergé par l'État FR. Très précis pour les adresses françaises.
//  2. Nominatim OpenStreetMap (fallback international) — gratuit, sans clé.
//     Limité à 1 req/s par fair-use ; on respecte le User-Agent obligatoire.
//
// Aucun service commercial (Google, Mapbox) → conforme à notre positionnement
// souverain. Les deux APIs sont en lecture publique, pas de données envoyées
// hors UE (BAN = FR, Nominatim = DE).
package geocode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound — aucune coordonnée trouvée pour cette adresse.
var ErrNotFound = errors.New("geocode: address not found")

// Result — résultat d'un géocodage réussi.
type Result struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Provider string  `json:"provider"` // "ban" ou "nominatim"
	Label    string  `json:"label"`    // adresse normalisée renvoyée par le provider
}

// Geocoder — client HTTP réutilisable. Thread-safe.
type Geocoder struct {
	client    *http.Client
	userAgent string
}

// New — crée un Geocoder avec timeout 5s et User-Agent requis par Nominatim.
func New() *Geocoder {
	return &Geocoder{
		client:    &http.Client{Timeout: 5 * time.Second},
		userAgent: "Zeina-Hyperviseur/1.0 (contact@qalitylabs.fr)",
	}
}

// Geocode — résout une adresse en (lat, lng). Tente BAN d'abord, puis
// Nominatim. Retourne ErrNotFound si aucun provider ne trouve.
func (g *Geocoder) Geocode(ctx context.Context, address string) (*Result, error) {
	addr := strings.TrimSpace(address)
	if addr == "" {
		return nil, ErrNotFound
	}

	if r, err := g.geocodeBAN(ctx, addr); err == nil {
		return r, nil
	}
	if r, err := g.geocodeNominatim(ctx, addr); err == nil {
		return r, nil
	}
	return nil, ErrNotFound
}

// --- BAN (Base Adresse Nationale FR) --------------------------------------

type banResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates [2]float64 `json:"coordinates"` // [lng, lat]
		} `json:"geometry"`
		Properties struct {
			Label string  `json:"label"`
			Score float64 `json:"score"`
		} `json:"properties"`
	} `json:"features"`
}

func (g *Geocoder) geocodeBAN(ctx context.Context, addr string) (*Result, error) {
	u := "https://api-adresse.data.gouv.fr/search/?limit=1&q=" + url.QueryEscape(addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", g.userAgent)

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ban status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}
	var parsed banResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Features) == 0 {
		return nil, ErrNotFound
	}
	// BAN renvoie un score 0..1 — on ignore les matches trop faibles
	// (typiquement une faute de frappe / adresse partielle hors FR).
	f := parsed.Features[0]
	if f.Properties.Score < 0.4 {
		return nil, ErrNotFound
	}
	return &Result{
		Lat: f.Geometry.Coordinates[1], Lng: f.Geometry.Coordinates[0],
		Provider: "ban",
		Label:    f.Properties.Label,
	}, nil
}

// --- Nominatim (fallback international) -----------------------------------

type nominatimItem struct {
	Lat         string `json:"lat"`
	Lon         string `json:"lon"`
	DisplayName string `json:"display_name"`
}

func (g *Geocoder) geocodeNominatim(ctx context.Context, addr string) (*Result, error) {
	u := "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + url.QueryEscape(addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// User-Agent OBLIGATOIRE selon la politique d'usage Nominatim.
	req.Header.Set("User-Agent", g.userAgent)
	req.Header.Set("Accept-Language", "fr")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}
	var items []nominatimItem
	if err := json.Unmarshal(body, &items); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, ErrNotFound
	}
	lat, err1 := strconv.ParseFloat(items[0].Lat, 64)
	lng, err2 := strconv.ParseFloat(items[0].Lon, 64)
	if err1 != nil || err2 != nil {
		return nil, ErrNotFound
	}
	return &Result{
		Lat: lat, Lng: lng,
		Provider: "nominatim",
		Label:    items[0].DisplayName,
	}, nil
}
