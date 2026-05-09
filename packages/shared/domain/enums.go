// Package domain regroupe les types métier partagés entre tous les services.
// Les valeurs des constantes correspondent aux ENUMs PostgreSQL définis dans
// migrations/0001_init.up.sql — toute modification doit être faite des deux
// côtés en parallèle.
package domain

// UserRole — rôles utilisateur.
type UserRole string

const (
	RoleAdmin   UserRole = "admin"
	RoleManager UserRole = "manager"
	RoleViewer  UserRole = "viewer"
)

func (r UserRole) Valid() bool {
	switch r {
	case RoleAdmin, RoleManager, RoleViewer:
		return true
	}
	return false
}

// DeviceType — typologie de capteur ou actionneur.
type DeviceType string

const (
	DeviceTypeEnvironment DeviceType = "environment"
	DeviceTypePresence    DeviceType = "presence"
	DeviceTypeActuator    DeviceType = "actuator"
	DeviceTypeLinky       DeviceType = "linky"
	DeviceTypeMeter       DeviceType = "meter"
	DeviceTypeGateway     DeviceType = "gateway"
)

func (t DeviceType) Valid() bool {
	switch t {
	case DeviceTypeEnvironment, DeviceTypePresence, DeviceTypeActuator,
		DeviceTypeLinky, DeviceTypeMeter, DeviceTypeGateway:
		return true
	}
	return false
}

// DeviceStatus — état opérationnel d'un device.
type DeviceStatus string

const (
	DeviceStatusProvisioned DeviceStatus = "provisioned"
	DeviceStatusOnline      DeviceStatus = "online"
	DeviceStatusOffline     DeviceStatus = "offline"
	DeviceStatusDisabled    DeviceStatus = "disabled"
)

// Quality — qualité d'une mesure (champ "quality" du payload MQTT).
type Quality string

const (
	QualityGood      Quality = "good"
	QualityUncertain Quality = "uncertain"
	QualityBad       Quality = "bad"
)

func (q Quality) Valid() bool {
	switch q {
	case QualityGood, QualityUncertain, QualityBad:
		return true
	}
	return false
}

// CommandStatus — état d'une commande envoyée à un actionneur.
type CommandStatus string

const (
	CommandStatusPending CommandStatus = "pending"
	CommandStatusSent    CommandStatus = "sent"
	CommandStatusAcked   CommandStatus = "acked"
	CommandStatusFailed  CommandStatus = "failed"
	CommandStatusTimeout CommandStatus = "timeout"
)

// RuleExecutionResult — issue de l'exécution d'une règle.
type RuleExecutionResult string

const (
	RuleResultSuccess RuleExecutionResult = "success"
	RuleResultPartial RuleExecutionResult = "partial"
	RuleResultFailure RuleExecutionResult = "failure"
	RuleResultSkipped RuleExecutionResult = "skipped"
)
