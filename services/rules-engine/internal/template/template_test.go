package template

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestResolveBasic(t *testing.T) {
	val := 23.5
	thr := 20.0
	ctx := Context{
		RuleName:    "Surchauffe bureau",
		DeviceSlug:  "am319-01",
		DeviceName:  "AM319 Bureau Léon",
		ZoneSlug:    "salle-204",
		ZoneName:    "Salle 204",
		Measurement: "temperature",
		Unit:        "°C",
		Value:       &val,
		Threshold:   &thr,
		Op:          ">",
		Level:       "warning",
	}
	got := Resolve("Alerte {rule.name} : {device.name} en {zone.name} a {measurement} = {value}{unit} (seuil {threshold}{unit})", ctx)
	want := "Alerte Surchauffe bureau : AM319 Bureau Léon en Salle 204 a temperature = 23.50°C (seuil 20°C)"
	if got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

func TestResolveUnknownKept(t *testing.T) {
	out := Resolve("foo {bar} baz", Context{})
	if !strings.Contains(out, "{bar}") {
		t.Errorf("unknown placeholder should be kept: %q", out)
	}
}

func TestResolveDeviceFallbackToSlug(t *testing.T) {
	ctx := Context{DeviceSlug: "am319-01"}
	got := Resolve("dev={device.name}", ctx)
	if got != "dev=am319-01" {
		t.Errorf("expected fallback to slug, got %q", got)
	}
}

func TestResolveZoneFallbackToSlug(t *testing.T) {
	ctx := Context{ZoneSlug: "salle-204"}
	got := Resolve("z={zone}", ctx)
	if got != "z=salle-204" {
		t.Errorf("expected zone fallback to slug, got %q", got)
	}
}

func TestResolveIntFormatting(t *testing.T) {
	v := 42.0
	ctx := Context{Value: &v}
	got := Resolve("{value}", ctx)
	if got != "42" {
		t.Errorf("integer-valued float should render as int, got %q", got)
	}
}

func TestResolveFloatFormatting(t *testing.T) {
	v := 23.456
	ctx := Context{Value: &v}
	got := Resolve("{value}", ctx)
	if got != "23.46" {
		t.Errorf("float should render with 2 decimals, got %q", got)
	}
}

func TestResolveSlice(t *testing.T) {
	ctx := Context{DeviceSlug: "x"}
	out := ResolveSlice([]string{"to-{device.slug}@a.com", "fixed@b.com"}, ctx)
	if out[0] != "to-x@a.com" || out[1] != "fixed@b.com" {
		t.Errorf("got %v", out)
	}
}

func TestResolveTimestamp(t *testing.T) {
	ctx := Context{}
	got := Resolve("{timestamp}", ctx)
	// Just check format YYYY-MM-DD HH:MM:SS — non-empty + dashes/colons present.
	if len(got) < 10 || !strings.Contains(got, "-") || !strings.Contains(got, ":") {
		t.Errorf("timestamp should render, got %q", got)
	}
}

func TestResolveRuleID(t *testing.T) {
	id := uuid.New()
	ctx := Context{RuleID: id}
	got := Resolve("{rule.id}", ctx)
	if got != id.String() {
		t.Errorf("rule.id mismatch: %q vs %q", got, id.String())
	}
}
