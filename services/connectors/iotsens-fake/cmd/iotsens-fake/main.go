// fake-iotsens — serveur HTTP qui simule une API IoTSens.
//
// Endpoints :
//
//   GET  /api/v1/devices                              → liste des devices
//   GET  /api/v1/devices/{id}/measurements?since=ts   → mesures depuis ts (RFC3339)
//   POST /api/v1/devices/{id}/commands                → envoi commande (renvoie 202)
//
// Auth : header X-API-Key (valeur configurable via env IOTSENS_FAKE_API_KEY).
//
// Génère en continu des mesures réalistes pour 4 devices d'exemple :
//   IOTS-TEMP-001 : temperature + humidity
//   IOTS-CO2-001  : co2
//   IOTS-METER-01 : énergie (Wh)
//   IOTS-PIR-001  : présence (0/1)
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ----------------------------------------------------------------------------
// Modèle de données API IoTSens (format inventé pour la démo)
// ----------------------------------------------------------------------------

type apiDevice struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Types []string `json:"measurement_types"`
}

type apiMeasurement struct {
	Timestamp string  `json:"timestamp"` // RFC3339
	Type      string  `json:"type"`      // ex: "temperature"
	Value     float64 `json:"value"`
	Unit      string  `json:"unit"`
	Quality   string  `json:"quality"`
}

// ----------------------------------------------------------------------------
// Devices simulés (in-memory)
// ----------------------------------------------------------------------------

type simDevice struct {
	id        string
	name      string
	gen       func(t time.Time, r *rand.Rand) []apiMeasurement
	r         *rand.Rand
	mu        sync.Mutex
	history   []apiMeasurement // ring buffer (max 1000)
}

func newSimDevice(id, name string, gen func(time.Time, *rand.Rand) []apiMeasurement) *simDevice {
	h := fnv.New64a()
	_, _ = h.Write([]byte(id))
	return &simDevice{
		id: id, name: name, gen: gen,
		r: rand.New(rand.NewSource(int64(h.Sum64()))),
	}
}

func (d *simDevice) tick(now time.Time) {
	ms := d.gen(now, d.r)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.history = append(d.history, ms...)
	if len(d.history) > 1000 {
		d.history = d.history[len(d.history)-1000:]
	}
}

// since renvoie les mesures dont timestamp > since.
func (d *simDevice) since(since time.Time) []apiMeasurement {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]apiMeasurement, 0, 16)
	for _, m := range d.history {
		t, _ := time.Parse(time.RFC3339Nano, m.Timestamp)
		if t.After(since) {
			out = append(out, m)
		}
	}
	return out
}

// ----------------------------------------------------------------------------
// Server
// ----------------------------------------------------------------------------

type server struct {
	apiKey  string
	mu      sync.RWMutex
	devices map[string]*simDevice
}

func (s *server) authOK(r *http.Request) bool {
	return r.Header.Get("X-API-Key") == s.apiKey
}

func (s *server) get(id string) (*simDevice, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.devices[id]
	return d, ok
}

func (s *server) all() []*simDevice {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*simDevice, 0, len(s.devices))
	for _, d := range s.devices {
		out = append(out, d)
	}
	return out
}

func (s *server) add(d *simDevice) {
	s.mu.Lock()
	s.devices[d.id] = d
	s.mu.Unlock()
}

func (s *server) listDevices(w http.ResponseWriter, r *http.Request) {
	if !s.authOK(r) { http.Error(w, "forbidden", 403); return }
	devs := s.all()
	out := make([]apiDevice, 0, len(devs))
	for _, d := range devs {
		var types []string
		sample := d.gen(time.Now(), d.r)
		seen := map[string]bool{}
		for _, m := range sample {
			if !seen[m.Type] {
				types = append(types, m.Type); seen[m.Type] = true
			}
		}
		out = append(out, apiDevice{ID: d.id, Name: d.name, Types: types})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (s *server) measurements(w http.ResponseWriter, r *http.Request, deviceID string) {
	if !s.authOK(r) { http.Error(w, "forbidden", 403); return }
	d, ok := s.get(deviceID)
	if !ok { http.Error(w, "device not found", 404); return }

	sinceStr := r.URL.Query().Get("since")
	since := time.Now().Add(-5 * time.Minute)
	if sinceStr != "" {
		if t, err := time.Parse(time.RFC3339Nano, sinceStr); err == nil {
			since = t
		}
	}
	out := d.since(since)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// ---- Admin endpoint pour provisionner dynamiquement un device simulé ----

type adminCreateReq struct {
	ID      string `json:"id"`      // ex: "MY-CUSTOM-001"
	Name    string `json:"name"`    // libellé humain (optionnel)
	Profile string `json:"profile"` // temp_humidity | co2 | meter | presence
}

func (s *server) adminCreate(w http.ResponseWriter, r *http.Request) {
	if !s.authOK(r) { http.Error(w, "forbidden", 403); return }
	if r.Method != http.MethodPost { http.Error(w, "method", 405); return }
	var req adminCreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), 400); return
	}
	if req.ID == "" {
		http.Error(w, "id required", 400); return
	}
	var gen func(time.Time, *rand.Rand) []apiMeasurement
	switch req.Profile {
	case "temp_humidity", "":
		gen = genTempHumidity
	case "co2":
		gen = genCO2
	case "meter":
		gen = genMeter
	case "presence":
		gen = genPresence
	default:
		http.Error(w, "unknown profile (use temp_humidity|co2|meter|presence)", 400); return
	}
	name := req.Name
	if name == "" { name = req.ID }

	d := newSimDevice(req.ID, name, gen)
	// Pré-remplir un peu d'historique pour que le 1er poll ait des données
	now := time.Now()
	for i := 30; i > 0; i-- {
		d.tick(now.Add(-time.Duration(i*10) * time.Second))
	}
	s.add(d)

	log.Printf("[admin] device provisioned: id=%s profile=%s", req.ID, req.Profile)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id": req.ID, "name": name, "profile": req.Profile, "status": "ok",
	})
}

func (s *server) command(w http.ResponseWriter, r *http.Request, deviceID string) {
	if !s.authOK(r) { http.Error(w, "forbidden", 403); return }
	if _, ok := s.devices[deviceID]; !ok { http.Error(w, "device not found", 404); return }
	// On ignore le contenu pour la démo, juste 202.
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"status":"queued"}`))
}

// ----------------------------------------------------------------------------
// Generators réalistes
// ----------------------------------------------------------------------------

func genTempHumidity(t time.Time, r *rand.Rand) []apiMeasurement {
	hour := float64(t.Hour()) + float64(t.Minute())/60.0
	temp := 21.0 + 4.0*math.Sin(math.Pi*(hour-6)/12.0)
	if hour < 6 || hour > 20 { temp = 19.0 }
	temp += r.NormFloat64() * 0.3
	hum := 55.0 - math.Max(0, temp-22)*1.5 + r.NormFloat64()*1.5
	now := t.UTC().Format(time.RFC3339Nano)
	return []apiMeasurement{
		{Timestamp: now, Type: "temperature", Value: round1(temp), Unit: "C", Quality: "good"},
		{Timestamp: now, Type: "humidity",    Value: round1(hum),  Unit: "%", Quality: "good"},
	}
}

func genCO2(t time.Time, r *rand.Rand) []apiMeasurement {
	hour := t.Hour()
	base := 450.0
	if hour >= 8 && hour <= 18 { base = 700.0 + 150.0*math.Sin(math.Pi*float64(hour-8)/10) }
	val := base + r.NormFloat64()*20
	return []apiMeasurement{{
		Timestamp: t.UTC().Format(time.RFC3339Nano),
		Type: "co2", Value: round0(val), Unit: "ppm", Quality: "good",
	}}
}

var meterIndex = 1234.0
var meterMu sync.Mutex
func genMeter(t time.Time, r *rand.Rand) []apiMeasurement {
	meterMu.Lock()
	defer meterMu.Unlock()
	hour := t.Hour()
	power := 250.0
	if hour >= 8 && hour <= 18 { power = 800.0 }
	power += r.NormFloat64() * 30
	meterIndex += power * 10.0 / 3600.0 // 10s incremental
	return []apiMeasurement{
		{Timestamp: t.UTC().Format(time.RFC3339Nano), Type: "pact", Value: round0(power), Unit: "W", Quality: "good"},
		{Timestamp: t.UTC().Format(time.RFC3339Nano), Type: "base", Value: round0(meterIndex), Unit: "Wh", Quality: "good"},
	}
}

func genPresence(t time.Time, r *rand.Rand) []apiMeasurement {
	hour := t.Hour()
	prob := 0.05
	if hour >= 9 && hour <= 18 && t.Weekday() >= time.Monday && t.Weekday() <= time.Friday {
		prob = 0.85
	}
	val := 0.0
	if r.Float64() < prob { val = 1.0 }
	return []apiMeasurement{{
		Timestamp: t.UTC().Format(time.RFC3339Nano),
		Type: "presence", Value: val, Unit: "bool", Quality: "good",
	}}
}

func round0(v float64) float64 { return math.Round(v) }
func round1(v float64) float64 { return math.Round(v*10) / 10 }

// ----------------------------------------------------------------------------

func main() {
	addr := flag.String("addr", envOr("IOTSENS_FAKE_ADDR", ":8081"), "HTTP listen address")
	apiKey := flag.String("api-key", envOr("IOTSENS_FAKE_API_KEY", "demo-key-iotsens"), "API key required in X-API-Key header")
	tick := flag.Duration("tick", 10*time.Second, "interval between measurement generations")
	flag.Parse()

	s := &server{
		apiKey: *apiKey,
		devices: map[string]*simDevice{
			"IOTS-TEMP-001": newSimDevice("IOTS-TEMP-001", "Salle réunion T°/H", genTempHumidity),
			"IOTS-CO2-001":  newSimDevice("IOTS-CO2-001",  "Open space CO2",     genCO2),
			"IOTS-METER-01": newSimDevice("IOTS-METER-01", "Compteur atelier",   genMeter),
			"IOTS-PIR-001":  newSimDevice("IOTS-PIR-001",  "PIR couloir",        genPresence),
		},
	}

	// Boucle de génération
	go func() {
		t := time.NewTicker(*tick)
		defer t.Stop()
		// Pre-fill avec un peu d'historique pour que les premiers polls aient des données.
		now := time.Now()
		for i := 30; i > 0; i-- {
			past := now.Add(-time.Duration(i) * (*tick))
			for _, d := range s.all() { d.tick(past) }
		}
		for {
			now := <-t.C
			for _, d := range s.all() {
				d.tick(now)
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/admin/devices", s.adminCreate) // provision dynamique
	mux.HandleFunc("/api/v1/devices", s.listDevices)
	mux.HandleFunc("/api/v1/devices/", func(w http.ResponseWriter, r *http.Request) {
		// /api/v1/devices/{id}/measurements
		// /api/v1/devices/{id}/commands
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/devices/")
		parts := strings.Split(path, "/")
		if len(parts) < 2 {
			http.Error(w, "not found", 404); return
		}
		deviceID := parts[0]
		switch parts[1] {
		case "measurements":
			if r.Method != http.MethodGet { http.Error(w, "method", 405); return }
			s.measurements(w, r, deviceID)
		case "commands":
			if r.Method != http.MethodPost { http.Error(w, "method", 405); return }
			s.command(w, r, deviceID)
		default:
			http.Error(w, "not found", 404)
		}
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","vendor":"iotsens-fake"}`))
	})

	log.Printf("[iotsens-fake] listening on %s, api_key=%s, devices=%d", *addr, mask(*apiKey), len(s.devices))
	if err := http.ListenAndServe(*addr, logRequests(mux)); err != nil {
		log.Fatal(err)
	}
}

func logRequests(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		h.ServeHTTP(sw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(t))
	})
}

type statusWriter struct { http.ResponseWriter; status int }
func (s *statusWriter) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }

func envOr(k, d string) string { if v := os.Getenv(k); v != "" { return v }; return d }
func mask(s string) string { if len(s) < 8 { return "***" }; return s[:4] + "***" + s[len(s)-2:] }

// silence unused if compiled bare
var _ = fmt.Sprintf
