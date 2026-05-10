// Compilateur graph → RuleDefinition.
//
// L'éditeur visuel xyflow émet un format `{nodes, edges}` plus expressif
// que la RuleDefinition linéaire utilisée par le moteur. Pour ne pas
// casser le moteur, on compile le graph en RuleDefinition au save dans
// rules.definition. Le format graph est conservé en parallèle dans
// rules.definition_graph pour pouvoir réafficher l'éditeur tel quel.
//
// Topologie supportée en V1 :
//
//	[Trigger] → [Condition?] → [Action 1, 2, 3, …]
//
//	avec Condition optionnelle, et chaque Action peut être branchée sur la
//	sortie "true" ou "false" du Condition (champ branch dans le legacy).
//
// Types de nodes : trigger / condition / action_email / action_sms /
// action_alarm / action_webhook / action_actuator / action_notify

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
// JSONB. Erreur si le graph est mal formé (trigger manquant, action sans
// trigger, etc.).
func compileGraphToDefinition(raw json.RawMessage) (json.RawMessage, error) {
	var g graphDoc
	if err := json.Unmarshal(raw, &g); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	// Index par ID pour résolution rapide.
	byID := map[string]graphNode{}
	for _, n := range g.Nodes {
		byID[n.ID] = n
	}

	// Localise le trigger (1 seul attendu en V1).
	var trigger *graphNode
	for i, n := range g.Nodes {
		if n.Type == "trigger" {
			if trigger != nil {
				return nil, errors.New("plusieurs blocs trigger trouvés (1 seul attendu)")
			}
			trigger = &g.Nodes[i]
		}
	}
	if trigger == nil {
		return nil, errors.New("aucun bloc trigger — la règle doit avoir un point de départ")
	}

	// Construit la map des edges sortantes par source.
	outEdges := map[string][]graphEdge{}
	for _, e := range g.Edges {
		outEdges[e.Source] = append(outEdges[e.Source], e)
	}

	// Conditions : un seul bloc condition supporté en V1.
	var conditionNode *graphNode
	for _, e := range outEdges[trigger.ID] {
		if t, ok := byID[e.Target]; ok && t.Type == "condition" {
			n := t
			conditionNode = &n
			break
		}
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
		for _, e := range outEdges[trigger.ID] {
			if t, ok := byID[e.Target]; ok && isActionType(t.Type) {
				actionsList = append(actionsList, actionWithBranch{node: t, branch: "true"})
			}
		}
	}

	if len(actionsList) == 0 {
		return nil, errors.New("aucune action — connectez au moins une action en sortie du trigger ou du condition")
	}

	// Sérialise en RuleDefinition compatible avec rules-engine.
	def := map[string]interface{}{}
	def["trigger"] = trigger.Data
	if conditionNode != nil {
		// Le bloc condition côté UI peut contenir conditions[] + conditions_op.
		if conds, ok := conditionNode.Data["conditions"]; ok {
			def["conditions"] = conds
		}
		if op, ok := conditionNode.Data["conditions_op"]; ok {
			def["conditions_op"] = op
		}
	}
	// Cooldown / retrigger_mode propagés depuis le trigger node si présents.
	if cd, ok := trigger.Data["cooldown_seconds"]; ok {
		def["cooldown_seconds"] = cd
	}
	if rm, ok := trigger.Data["retrigger_mode"]; ok {
		def["retrigger_mode"] = rm
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
