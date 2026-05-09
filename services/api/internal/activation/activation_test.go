package activation

import (
	"regexp"
	"testing"
)

// TestGenerateCode_Format vérifie que le code est toujours sur 6 chiffres
// (avec leading zeros si nécessaire).
func TestGenerateCode_Format(t *testing.T) {
	re := regexp.MustCompile(`^\d{6}$`)
	// 200 itérations augmente la chance de tomber sur des codes < 100000 qui
	// révèleraient un fmt.Sprintf raté.
	for i := 0; i < 200; i++ {
		code, err := GenerateCode()
		if err != nil {
			t.Fatalf("GenerateCode err: %v", err)
		}
		if !re.MatchString(code) {
			t.Fatalf("code %q ne matche pas /^\\d{6}$/", code)
		}
	}
}

// TestGenerateCode_Distribution vérifie qu'on n'obtient pas toujours le
// même code (sanity check du RNG).
func TestGenerateCode_Distribution(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		c, _ := GenerateCode()
		seen[c] = true
	}
	if len(seen) < 40 {
		t.Fatalf("trop de doublons dans 50 tirages : %d uniques", len(seen))
	}
}
