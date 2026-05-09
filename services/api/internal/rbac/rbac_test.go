package rbac

import (
	"encoding/json"
	"testing"
)

func TestLevel_Allows(t *testing.T) {
	tests := []struct {
		have, need Level
		want       bool
	}{
		// write couvre tout
		{LevelWrite, LevelWrite, true},
		{LevelWrite, LevelRead, true},
		{LevelWrite, LevelNone, true},
		// read couvre read et none
		{LevelRead, LevelWrite, false},
		{LevelRead, LevelRead, true},
		{LevelRead, LevelNone, true},
		// none ne couvre que none
		{LevelNone, LevelWrite, false},
		{LevelNone, LevelRead, false},
		{LevelNone, LevelNone, true},
		// niveau invalide ⇒ rang 0 ⇒ comportement de none
		{Level("garbage"), LevelRead, false},
	}
	for _, tt := range tests {
		t.Run(string(tt.have)+"_allows_"+string(tt.need), func(t *testing.T) {
			if got := tt.have.Allows(tt.need); got != tt.want {
				t.Errorf("(%q).Allows(%q) = %v, want %v", tt.have, tt.need, got, tt.want)
			}
		})
	}
}

func TestPermissionSet_Get(t *testing.T) {
	p := PermissionSet{
		FeatureDashboard: LevelWrite,
		FeatureDevices:   LevelRead,
	}
	cases := []struct {
		f    Feature
		want Level
	}{
		{FeatureDashboard, LevelWrite},
		{FeatureDevices, LevelRead},
		{FeatureRules, LevelNone},   // absent ⇒ none
		{FeatureMembers, LevelNone}, // absent ⇒ none
	}
	for _, c := range cases {
		if got := p.Get(c.f); got != c.want {
			t.Errorf("Get(%q) = %q, want %q", c.f, got, c.want)
		}
	}
	// nil PermissionSet ⇒ none partout
	var nilP PermissionSet
	if got := nilP.Get(FeatureDashboard); got != LevelNone {
		t.Errorf("nil.Get = %q, want none", got)
	}
}

func TestParsePermissions(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want PermissionSet
	}{
		{
			name: "empty",
			raw:  "",
			want: PermissionSet{},
		},
		{
			name: "valid full",
			raw:  `{"dashboard":"write","devices":"read","rules":"none","members":"none"}`,
			want: PermissionSet{
				FeatureDashboard: LevelWrite,
				FeatureDevices:   LevelRead,
				FeatureRules:     LevelNone,
				FeatureMembers:   LevelNone,
			},
		},
		{
			name: "invalid level dropped",
			raw:  `{"dashboard":"write","devices":"super-write"}`,
			want: PermissionSet{FeatureDashboard: LevelWrite},
		},
		{
			name: "unknown feature kept (forward compat)",
			raw:  `{"future":"read","dashboard":"write"}`,
			want: PermissionSet{
				Feature("future"): LevelRead,
				FeatureDashboard:  LevelWrite,
			},
		},
		{
			name: "garbage json",
			raw:  `not json`,
			want: PermissionSet{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParsePermissions([]byte(tt.raw))
			if len(got) != len(tt.want) {
				t.Fatalf("len = %d, want %d (got=%v)", len(got), len(tt.want), got)
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Errorf("%q: got %q, want %q", k, got[k], v)
				}
			}
		})
	}
}

func TestParsePermissions_RoundTrip(t *testing.T) {
	original := PermissionSet{
		FeatureDashboard: LevelWrite,
		FeatureDevices:   LevelRead,
		FeatureRules:     LevelNone,
		FeatureMembers:   LevelWrite,
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	parsed := ParsePermissions(raw)
	if len(parsed) != len(original) {
		t.Fatalf("roundtrip lost data: %v vs %v", original, parsed)
	}
	for k, v := range original {
		if parsed[k] != v {
			t.Errorf("%q: %q vs %q", k, parsed[k], v)
		}
	}
}

func TestFullAccess(t *testing.T) {
	full := FullAccess()
	for _, f := range AllFeatures {
		if got := full.Get(f); got != LevelWrite {
			t.Errorf("FullAccess[%q] = %q, want write", f, got)
		}
	}
	if len(full) != len(AllFeatures) {
		t.Errorf("len(FullAccess) = %d, want %d", len(full), len(AllFeatures))
	}
}

func TestSiteAccess_Effective(t *testing.T) {
	// Cas 1 : superadmin → write partout, indépendamment des permissions
	super := SiteAccess{IsSuperadmin: true, Permissions: PermissionSet{FeatureDashboard: LevelNone}}
	for _, f := range AllFeatures {
		if got := super.Effective(f); got != LevelWrite {
			t.Errorf("superadmin should be write on %q, got %q", f, got)
		}
	}

	// Cas 2 : owner du tenant → write partout aussi
	owner := SiteAccess{IsOwner: true, Permissions: PermissionSet{FeatureRules: LevelNone}}
	for _, f := range AllFeatures {
		if got := owner.Effective(f); got != LevelWrite {
			t.Errorf("owner should be write on %q, got %q", f, got)
		}
	}

	// Cas 3 : membre simple → niveau lu sur PermissionSet
	member := SiteAccess{Permissions: PermissionSet{
		FeatureDashboard: LevelRead,
		FeatureDevices:   LevelWrite,
	}}
	if got := member.Effective(FeatureDashboard); got != LevelRead {
		t.Errorf("member.dashboard = %q, want read", got)
	}
	if got := member.Effective(FeatureDevices); got != LevelWrite {
		t.Errorf("member.devices = %q, want write", got)
	}
	if got := member.Effective(FeatureRules); got != LevelNone {
		t.Errorf("member.rules (absent) = %q, want none", got)
	}
}

// Garde-fou : écarte les régressions silencieuses sur le contrat des features.
func TestAllFeatures_StableSet(t *testing.T) {
	expected := []Feature{FeatureDashboard, FeatureDevices, FeatureRules, FeatureMembers}
	if len(AllFeatures) != len(expected) {
		t.Fatalf("AllFeatures changed: got %v, expected %v", AllFeatures, expected)
	}
	for i, f := range expected {
		if AllFeatures[i] != f {
			t.Errorf("AllFeatures[%d] = %q, want %q", i, AllFeatures[i], f)
		}
	}
}
