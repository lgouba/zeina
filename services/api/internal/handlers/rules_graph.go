// Compilateur graph → RuleDefinition.
//
// L'éditeur visuel xyflow émet un format `{nodes, edges}` plus expressif
// que la RuleDefinition linéaire utilisée par le moteur. Pour ne pas
// casser le moteur, on compile le graph en RuleDefinition au save dans
// rules.definition. Le format graph est conservé en parallèle dans
// rules.definition_graph pour pouvoir réafficher l'éditeur tel quel.
//
// Topologies supportées :
//
//   A. Équipement → Condition → Actions
//      Equipment (source de données) fournit le device + ses mesures dispos.
//      Condition compare une de ces mesures à un seuil (op + value).
//      Compile vers trigger.type = "threshold".
//
//   B. Trigger périodique (cron) → Condition? → Actions
//      Compile vers trigger.type = "cron".
//
//   C. Trigger threshold legacy → Condition? → Actions (pour les anciennes
//      règles éditées dans l'éditeur graph).
//
// Types de nodes :
//   equipment, trigger (legacy/cron), condition, action_*

package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
)

// graphDoc — format JSON émis par le frontend xyflow.
type graphDoc struct {
	Nodes []graphNode `json:"nodes"`
	Edges []graphEdge `json:"edges"`
}

type graphNode struct {
	ID   string                 `json:"id"`
	Type string                 `json:"type"` // trigger | condition | action_email | …
	Data map[string]interface{} `json:"data"`
}

type graphEdge struct {
	ID           string `json:"id"`
	Source       string `json:"source"`
	Target       string `json:"target"`
	SourceHandle string `json:"sourceHandle,omitempty"` // "true" | "false" | "" (output)
}

// compileGraphToDefinition convertit le graph visuel en RuleDefinition
// JSONB. Erreur si le graph est mal formé.
func compileGraphToDefinition(raw json.RawMessage) (json.RawMessage, error) {
	var g graphDoc
	if err := json.Unmarshal(raw, &g); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	byID := map[string]graphNode{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}

	// Map edges sortantes par source.
	outEdges := map[string][]graphEdge{}
	for _, e := range g.Edges {
		outEdges[e.Source] = append(outEdges[e.Source], e)
	}

	// Localise le point d'entrée : Equipment (V2) ou Trigger (V1/legacy).
	var sourceNode *graphNode
	for i, n := range g.Nodes {
		if n.Type == "equipment" || n.Type == "trigger" {
			if sourceNode != nil {
				return nil, errors.New("plusieurs blocs source (Équipement/Trigger) trouvés — 1 seul attendu")
			}
			sourceNode = &g.Nodes[i]
		}
	}
	if sourceNode == nil {
		return nil, errors.New("aucun bloc Équipement ou Trigger — la règle doit avoir un point de départ")
	}

	// Cherche un Condition relié au sourceNode.
	var conditionNode *graphNode
	for _, e := range outEdges[sourceNode.ID] {
		if t, ok := byID[e.Target]; ok && t.Type == "condition" {
			n := t
			conditionNode = &n
			break
		}
	}

	// Construit le trigger legacy à partir d'Equipment + Condition (cas A) ou
	// d'un Trigger natif (cas B/C).
	trigger := buildTriggerFromGraph(sourceNode, conditionNode)
	if trigger == nil {
		return nil, errors.New("le bloc Équipement doit être relié à un bloc Condition pour définir un seuil")
	}

	// Construit la liste des actions :
	// - si pas de Condition : actions = directement les targets du trigger
	// - sinon : actions = targets de la Condition, avec branch="true" ou "false"
	type actionWithBranch struct {
		node   graphNode
		branch string
	}
	var actionsList []actionWithBranch

	if conditionNode != nil {
		for _, e := range outEdges[conditionNode.ID] {
			if t, ok := byID[e.Target]; ok && isActionType(t.Type) {
				branch := e.SourceHandle
				if branch == "" {
					branch = "true"
				}
				actionsList = append(actionsList, actionWithBranch{node: t, branch: branch})
			}
		}
	} else {
		for _, e := range outEdges[sourceNode.ID] {
			if t, ok := byID[e.Target]; ok && isActionType(t.Type) {
				actionsList = append(actionsList, actionWithBranch{node: t, branch: "true"})
			}
		}
	}

	if len(actionsList) == 0 {
		return nil, errors.New("aucune action — connectez au moins une action en sortie")
	}

	// Sérialise en RuleDefinition compatible avec rules-engine.
	def := map[string]interface{}{}
	def["trigger"] = trigger
	// Cooldown / retrigger_mode propagés depuis le source node ou le condition node.
	if cd, ok := sourceNode.Data["cooldown_seconds"]; ok {
		def["cooldown_seconds"] = cd
	}
	if rm, ok := sourceNode.Data["retrigger_mode"]; ok {
		def["retrigger_mode"] = rm
	}
	if conditionNode != nil {
		if cd, ok := conditionNode.Data["cooldown_seconds"]; ok {
			def["cooldown_seconds"] = cd
		}
		if rm, ok := conditionNode.Data["retrigger_mode"]; ok {
			def["retrigger_mode"] = rm
		}
		// Conditions secondaires (autres que celle qui sert de threshold).
		if conds, ok := conditionNode.Data["extra_conditions"]; ok {
			def["conditions"] = conds
		}
		if op, ok := conditionNode.Data["conditions_op"]; ok {
			def["conditions_op"] = op
		}
	}

	// Actions : on injecte le `branch` dans chaque action data.
	actions := make([]map[string]interface{}, 0, len(actionsList))
	for _, a := range actionsList {
		ad := cloneMap(a.node.Data)
		// le type effectif (notify/email/sms/...) est dérivé du node type
		ad["type"] = strapTypePrefix(a.node.Type)
		if a.branch != "" && a.branch != "true" {
			ad["branch"] = a.branch
		}
		actions = append(actions, ad)
	}
	def["actions"] = actions

	return json.Marshal(def)
}

// buildTriggerFromGraph fusionne (Equipment + Condition) ou (Trigger natif)
// en un objet trigger compatible avec rules-engine (threshold / cron / etc.).
//
//   - Equipment.device_slug → trigger.device_slug
//   - Condition.measurement → trigger.measurement
//   - Condition.op + value   → trigger.op + value
//   - Trigger natif : on retourne tel quel (data du bloc)
func buildTriggerFromGraph(source, cond *graphNode) map[string]interface{} {
	if source == nil {
		return nil
	}
	if source.Type == "trigger" {
		// Cas legacy : le bloc trigger contient déjà tout.
		out := cloneMap(source.Data)
		if _, ok := out["type"]; !ok {
			out["type"] = "threshold"
		}
		return out
	}
	// Cas equipment : nécessite un Condition relié pour fournir mesure + seuil.
	if cond == nil {
		return nil
	}
	device, _ := source.Data["device_slug"].(string)
	measurement, _ := cond.Data["measurement"].(string)
	op, _ := cond.Data["op"].(string)
	if device == "" || measurement == "" || op == "" {
		return nil
	}
	t := map[string]interface{}{
		"type":         "threshold",
		"device_slug":  device,
		"measurement":  measurement,
		"op":           op,
	}
	if v, ok := cond.Data["value"]; ok {
		t["value"] = v
	}
	if s, ok := cond.Data["sustained_seconds"]; ok {
		t["sustained_seconds"] = s
	}
	return t
}

// isActionType — true si le node type représente une action exécutable.
func isActionType(t string) bool {
	switch t {
	case "action_notify", "action_email", "action_sms", "action_alarm",
		"action_webhook", "action_actuator":
		return true
	}
	return false
}

// strapTypePrefix retire le préfixe "action_" pour obtenir le type legacy
// utilisé par le rules-engine (notify, email, sms, alarm, webhook, set_actuator).
func strapTypePrefix(t string) string {
	switch t {
	case "action_notify":
		return "notify"
	case "action_email":
		return "email"
	case "action_sms":
		return "sms"
	case "action_alarm":
		return "alarm"
	case "action_webhook":
		return "webhook"
	case "action_actuator":
		return "set_actuator"
	}
	return t
}

func cloneMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
