// Package scheduler parse et évalue les schedules d'occupation type
//
//	"occupied 08:00-18:00 mon-fri"
//
// utilisés par les capteurs PIR virtuels pour simuler une occupation réaliste.
package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Schedule représente une fenêtre récurrente jours+heures.
//
// Si le schedule est nil, IsActive retourne false (interpréter comme "pas
// d'occupation programmée" — le profil de présence prend alors le relais avec
// une probabilité par défaut).
type Schedule struct {
	StartHour, StartMin int
	EndHour, EndMin     int
	Days                map[time.Weekday]bool
}

// Parse accepte deux formes :
//   - "" → nil, nil
//   - "occupied HH:MM-HH:MM dow1-dow2" — exemples :
//     "occupied 08:00-18:00 mon-fri"
//     "occupied 09:00-17:00 mon-sat"
//     "occupied 00:00-23:59 mon-sun"
//
// Les jours sont en anglais 3 lettres minuscules : mon|tue|wed|thu|fri|sat|sun.
// Le séparateur jour peut être "-" pour une plage continue ou "," pour une liste
// (mais une seule de ces formes par schedule).
func Parse(spec string) (*Schedule, error) {
	if spec = strings.TrimSpace(spec); spec == "" {
		return nil, nil
	}
	parts := strings.Fields(spec)
	if len(parts) != 3 || parts[0] != "occupied" {
		return nil, fmt.Errorf("schedule: expected 'occupied HH:MM-HH:MM dow-dow', got %q", spec)
	}
	sh, sm, eh, em, err := parseHours(parts[1])
	if err != nil {
		return nil, fmt.Errorf("schedule: %w", err)
	}
	days, err := parseDays(parts[2])
	if err != nil {
		return nil, fmt.Errorf("schedule: %w", err)
	}
	return &Schedule{
		StartHour: sh, StartMin: sm,
		EndHour: eh, EndMin: em,
		Days: days,
	}, nil
}

// IsActive retourne true si t tombe dans la fenêtre du schedule.
// Comparaison en heure locale du t passé en argument (l'appelant choisit le TZ).
func (s *Schedule) IsActive(t time.Time) bool {
	if s == nil {
		return false
	}
	if !s.Days[t.Weekday()] {
		return false
	}
	cur := t.Hour()*60 + t.Minute()
	start := s.StartHour*60 + s.StartMin
	end := s.EndHour*60 + s.EndMin
	if start <= end {
		return cur >= start && cur < end
	}
	// Fenêtre nocturne (ex: 22:00-06:00)
	return cur >= start || cur < end
}

func parseHours(s string) (sh, sm, eh, em int, err error) {
	a, b, ok := strings.Cut(s, "-")
	if !ok {
		return 0, 0, 0, 0, fmt.Errorf("invalid time range %q", s)
	}
	if sh, sm, err = parseHM(a); err != nil {
		return
	}
	eh, em, err = parseHM(b)
	return
}

func parseHM(s string) (h, m int, err error) {
	hs, ms, ok := strings.Cut(s, ":")
	if !ok {
		return 0, 0, fmt.Errorf("invalid time %q (expected HH:MM)", s)
	}
	h, err = strconv.Atoi(hs)
	if err != nil || h < 0 || h > 23 {
		return 0, 0, fmt.Errorf("invalid hour %q", hs)
	}
	m, err = strconv.Atoi(ms)
	if err != nil || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("invalid minute %q", ms)
	}
	return h, m, nil
}

var dayNames = map[string]time.Weekday{
	"sun": time.Sunday, "mon": time.Monday, "tue": time.Tuesday,
	"wed": time.Wednesday, "thu": time.Thursday,
	"fri": time.Friday, "sat": time.Saturday,
}

func parseDays(spec string) (map[time.Weekday]bool, error) {
	out := map[time.Weekday]bool{}

	// Forme "mon,wed,fri" → liste explicite
	if strings.Contains(spec, ",") {
		for _, name := range strings.Split(spec, ",") {
			d, ok := dayNames[strings.ToLower(strings.TrimSpace(name))]
			if !ok {
				return nil, fmt.Errorf("unknown day %q", name)
			}
			out[d] = true
		}
		return out, nil
	}

	// Forme "mon-fri" → plage
	a, b, ok := strings.Cut(spec, "-")
	if !ok {
		// Forme "mon" — un seul jour
		d, ok := dayNames[strings.ToLower(spec)]
		if !ok {
			return nil, fmt.Errorf("unknown day %q", spec)
		}
		out[d] = true
		return out, nil
	}
	start, ok1 := dayNames[strings.ToLower(a)]
	end, ok2 := dayNames[strings.ToLower(b)]
	if !ok1 || !ok2 {
		return nil, fmt.Errorf("unknown day in range %q", spec)
	}
	// Parcours circulaire (gère "fri-mon" → fri, sat, sun, mon)
	for d := start; ; d = (d + 1) % 7 {
		out[d] = true
		if d == end {
			break
		}
	}
	return out, nil
}
