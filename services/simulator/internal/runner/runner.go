// Package runner orchestre l'exécution d'un device virtuel : ticker
// périodique, lecture des commandes MQTT entrantes, gestion d'état interne
// du profil.
package runner

import (
	"context"
	"hash/fnv"
	"math/rand"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/zeina/hyperviseur/packages/shared/domain"
	"github.com/zeina/hyperviseur/services/simulator/internal/bus"
	"github.com/zeina/hyperviseur/services/simulator/internal/profiles"
	"github.com/zeina/hyperviseur/services/simulator/internal/publisher"
	"github.com/zeina/hyperviseur/services/simulator/internal/scheduler"
)

// Device — un device virtuel prêt à tourner.
//
// Run() bloque sur sa boucle de tick. OnCommand() est invoqué de façon
// concurrente par le subscribe handler MQTT — protégé par cmdMu pour
// sérialiser les commandes consécutives sur un même actuator.
type Device struct {
	SiteID       string
	ZoneID       string
	DeviceID     string
	Type         string
	Profile      profiles.Profile
	Interval     time.Duration
	Schedule     *scheduler.Schedule
	Bus          *bus.Bus
	LightRelayID string
	PresenceID   string

	pub *publisher.Publisher
	log zerolog.Logger

	// Partagés entre Run() et OnCommand() — un actuator ne tick pas mais
	// reçoit des commandes, donc on garde l'état interne ici plutôt que
	// dans une variable locale de Run().
	cmdMu     sync.Mutex
	lastState *profiles.State
}

// New crée un Device prêt à Run.
func New(
	siteID, zoneID, deviceID, deviceType string,
	profile profiles.Profile,
	interval time.Duration,
	sch *scheduler.Schedule,
	b *bus.Bus,
	lightRelayID, presenceID string,
	pub *publisher.Publisher,
	log zerolog.Logger,
) *Device {
	return &Device{
		SiteID: siteID, ZoneID: zoneID, DeviceID: deviceID, Type: deviceType,
		Profile: profile, Interval: interval, Schedule: sch, Bus: b,
		LightRelayID: lightRelayID, PresenceID: presenceID,
		pub: pub,
		log: log.With().Str("device", deviceID).Str("zone", zoneID).Str("type", deviceType).Logger(),
	}
}

// Run démarre la boucle de tick. Bloque jusqu'à ctx.Done.
//
// Pour les actuators (Interval = 0) : publie l'état initial puis reste en
// attente de commandes (alimentées via OnCommand).
func (d *Device) Run(ctx context.Context, seed int64) {
	st := &profiles.State{
		DeviceID:     d.DeviceID,
		ZoneID:       d.ZoneID,
		SiteID:       d.SiteID,
		Now:          time.Now().UTC(),
		Rand:         rand.New(rand.NewSource(deviceSeed(seed, d.DeviceID))),
		Schedule:     d.Schedule,
		Bus:          d.Bus,
		LightRelayID: d.LightRelayID,
		PresenceID:   d.PresenceID,
		Internal:     d.Profile.InitState(),
	}

	// Sauvegarde la State initiale pour OnCommand (cas actuator).
	d.cmdMu.Lock()
	d.lastState = st
	d.cmdMu.Unlock()

	// Publication d'état initial (actuator only) — retained pour que tout
	// futur subscriber (frontend qui se reconnecte, rules-engine au démarrage,
	// API qui resubscribe après une coupure) reçoive immédiatement l'état.
	if init := d.Profile.InitialStatePayload(st); init != nil {
		if err := d.pub.State(ctx, d.SiteID, d.ZoneID, d.DeviceID, init, true); err != nil {
			d.log.Warn().Err(err).Msg("publish initial state failed")
		} else {
			d.log.Info().Msg("initial state published (retained)")
		}
	}

	if d.Interval <= 0 {
		<-ctx.Done()
		return
	}

	t := time.NewTicker(d.Interval)
	defer t.Stop()

	// Premier tick immédiat pour ne pas attendre Interval avant la 1re publi.
	d.tickAndPublish(ctx, st)

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			st.Now = now
			d.tickAndPublish(ctx, st)
		}
	}
}

func (d *Device) tickAndPublish(ctx context.Context, st *profiles.State) {
	if st.Now.IsZero() {
		st.Now = time.Now().UTC()
	}
	now := st.Now
	readings := d.Profile.Tick(ctx, st)
	for _, r := range readings {
		if err := d.pub.Measurement(ctx, d.SiteID, d.ZoneID, d.DeviceID, r.Name, r.Value, r.Unit, r.Quality, now); err != nil {
			d.log.Warn().Err(err).Str("measurement", r.Name).Msg("publish failed")
		}
	}
}

// OnCommand est invoqué par le subscribe handler MQTT du main quand un
// message arrive sur qlab/<tenant>/<site>/<zone>/<device>/cmd/<action>.
// Décode la payload, délègue au profil, publie le state ACK.
func (d *Device) OnCommand(ctx context.Context, payload []byte) {
	d.cmdMu.Lock()
	defer d.cmdMu.Unlock()

	cmd, err := domain.DecodeCommand(payload)
	if err != nil {
		d.log.Warn().Err(err).Msg("decode command failed")
		return
	}
	st := d.lastState
	if st == nil {
		// Commande arrivée avant le premier Run → init paresseuse.
		st = &profiles.State{
			DeviceID: d.DeviceID, ZoneID: d.ZoneID, SiteID: d.SiteID,
			Now: time.Now().UTC(), Bus: d.Bus,
			Internal: d.Profile.InitState(),
		}
		d.lastState = st
	}
	st.Now = time.Now().UTC()

	out, err := d.Profile.HandleCommand(ctx, st, cmd)
	if err != nil {
		d.log.Warn().Err(err).Msg("profile handle command failed")
		return
	}
	if out != nil {
		// ACK : retained = true aussi → l'état post-commande devient le
		// nouveau "dernier état connu" pour tout subscriber futur. Les ACK
		// avec cmd_id écrasent simplement le state initial dans la file
		// retained de Mosquitto. Un client qui se connecte après aura le
		// dernier cmd_id, ce qui est inoffensif (l'API peut l'ignorer).
		if err := d.pub.State(ctx, d.SiteID, d.ZoneID, d.DeviceID, out, true); err != nil {
			d.log.Warn().Err(err).Msg("publish state ACK failed")
			return
		}
		d.log.Info().Str("cmd_id", cmd.ID).Msg("command acked")
	}
}

// deviceSeed dérive un seed reproductible spécifique au device. Avec le même
// seed root + même device ID, on obtient toujours la même séquence — utile
// pour les tests et la reproductibilité des démos.
func deviceSeed(root int64, deviceID string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(deviceID))
	return root ^ int64(h.Sum64())
}
