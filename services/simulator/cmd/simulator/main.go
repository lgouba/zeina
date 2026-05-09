// Binaire `simulator` — démarre N capteurs/actionneurs virtuels selon un
// fichier YAML, publie sur MQTT, gère les commandes entrantes pour les
// actuators. Sortie propre sur SIGTERM/SIGINT.
package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/zeina/hyperviseur/packages/shared/logger"
	"github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"

	"github.com/zeina/hyperviseur/services/simulator/internal/bus"
	"github.com/zeina/hyperviseur/services/simulator/internal/config"
	"github.com/zeina/hyperviseur/services/simulator/internal/profiles"
	"github.com/zeina/hyperviseur/services/simulator/internal/publisher"
	"github.com/zeina/hyperviseur/services/simulator/internal/runner"
	"github.com/zeina/hyperviseur/services/simulator/internal/scheduler"
)

func main() {
	var (
		configPath = flag.String("config", envOr("SIMULATOR_CONFIG", "/etc/simulator/simulator.yml"), "path to simulator.yml")
		logLevel   = flag.String("log-level", envOr("LOG_LEVEL", "info"), "log level")
		logFormat  = flag.String("log-format", envOr("LOG_FORMAT", "json"), "log format (json|console)")
	)
	flag.Parse()

	log := logger.New(logger.Options{Level: *logLevel, Format: *logFormat, Service: "simulator"})

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Str("path", *configPath).Msg("load config")
	}
	// Override des creds MQTT via env (utile en prod où les passwords sont
	// générés aléatoirement et injectés via le compose).
	if v := os.Getenv("MQTT_BROKER"); v != "" {
		cfg.Broker = v
	}
	if v := os.Getenv("MQTT_USER"); v != "" {
		cfg.Username = v
	}
	if v := os.Getenv("MQTT_PASSWORD"); v != "" {
		cfg.Password = v
	}
	log.Info().
		Str("broker", cfg.Broker).
		Str("tenant", cfg.Tenant).
		Int("sites", len(cfg.Sites)).
		Int64("seed", cfg.Seed).
		Msg("config loaded")

	totalDevices := countDevices(cfg)
	log.Info().Int("devices", totalDevices).Msg("preparing devices")

	// MQTT client unique partagé par tous les devices virtuels.
	clientID := cfg.ClientIDPrefix + "-" + cfg.Tenant
	mqttOpts := mqtt.DefaultOptions(cfg.Broker)
	mqttOpts.ClientID = clientID
	mqttOpts.Username = cfg.Username
	mqttOpts.Password = cfg.Password
	mqttOpts.Logger = &log

	client, err := mqtt.New(mqttOpts)
	if err != nil {
		log.Fatal().Err(err).Msg("mqtt new")
	}

	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	connectCtx, connectCancel := context.WithTimeout(rootCtx, 30*time.Second)
	if err := client.Connect(connectCtx); err != nil {
		connectCancel()
		log.Fatal().Err(err).Msg("mqtt connect")
	}
	connectCancel()

	pub := publisher.New(client, cfg.Tenant, cfg.MeasurementQoS, cfg.StateQoS)

	// --- instanciation des devices ----------------------------------------
	devices, actuatorsByTopic, err := buildDevices(cfg, pub, log)
	if err != nil {
		log.Fatal().Err(err).Msg("build devices")
	}

	// --- subscribe aux commandes pour tous les actuators ------------------
	if len(actuatorsByTopic) > 0 {
		filters := make(map[string]byte, len(actuatorsByTopic))
		for f := range actuatorsByTopic {
			filters[f] = 1
		}
		err := client.SubscribeMultiple(rootCtx, filters, func(topic string, payload []byte) {
			d, ok := lookupActuator(actuatorsByTopic, topic)
			if !ok {
				log.Warn().Str("topic", topic).Msg("command for unknown device")
				return
			}
			d.OnCommand(rootCtx, payload)
		})
		if err != nil {
			log.Fatal().Err(err).Msg("subscribe commands")
		}
		log.Info().Int("actuators", len(actuatorsByTopic)).Msg("subscribed to command topics")
	}

	// --- run all devices --------------------------------------------------
	var wg sync.WaitGroup
	for _, d := range devices {
		wg.Add(1)
		go func(d *runner.Device) {
			defer wg.Done()
			d.Run(rootCtx, cfg.Seed)
		}(d)
	}

	// --- graceful shutdown ------------------------------------------------
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutting down")
	cancelRoot()

	// Laisser jusqu'à 5s aux goroutines pour terminer leur tick courant.
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Warn().Msg("forced shutdown after 5s wait")
	}
	client.Disconnect(500)
	log.Info().Msg("bye")
}

// buildDevices instancie tous les devices déclarés dans la config et retourne
// la slice de runners + une map topic → actuator pour le routage des commandes.
func buildDevices(cfg *config.Config, pub *publisher.Publisher, log zerolog.Logger) ([]*runner.Device, map[string]*runner.Device, error) {
	devices := make([]*runner.Device, 0, 32)
	actuators := make(map[string]*runner.Device)

	for _, site := range cfg.Sites {
		// Un bus par site — un compteur central (Linky tableau) doit voir
		// les relais des autres zones du site pour simuler la consommation.
		// Les couplages YAML référencent les devices par leur slug, donc les
		// IDs doivent rester uniques au niveau site.
		b := bus.New()
		for _, zone := range site.Zones {
			for _, dev := range zone.Devices {
				profile, err := profiles.New(dev.Type, dev.InitialState, dev.Measurements)
				if err != nil {
					return nil, nil, err
				}
				sch, err := scheduler.Parse(dev.Schedule)
				if err != nil {
					return nil, nil, err
				}
				rd := runner.New(
					site.ID, zone.ID, dev.ID, dev.Type,
					profile, dev.Interval, sch, b,
					dev.Couplings.LightRelay, dev.Couplings.Presence,
					pub, log,
				)
				devices = append(devices, rd)

				if dev.Type == "actuator" {
					filter, err := publisher.CommandFilter(cfg.Tenant, site.ID, zone.ID, dev.ID)
					if err != nil {
						return nil, nil, err
					}
					actuators[filter] = rd
				}
			}
		}
	}
	return devices, actuators, nil
}

// lookupActuator résout un topic concret (ex: qlab/acme/hq/z/relay-01/cmd/set)
// vers le device, en se basant sur les filtres (qlab/.../cmd/+) enregistrés.
func lookupActuator(by map[string]*runner.Device, topic string) (*runner.Device, bool) {
	parts, err := topics.Parse(topic)
	if err != nil || parts.Kind != topics.KindCommand {
		return nil, false
	}
	// On retire la dernière partie (action) pour reconstruire le filtre.
	prefix := topic[:len(topic)-len(parts.Action)] + "+"
	d, ok := by[prefix]
	return d, ok
}

func countDevices(cfg *config.Config) int {
	n := 0
	for _, s := range cfg.Sites {
		for _, z := range s.Zones {
			n += len(z.Devices)
		}
	}
	return n
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
