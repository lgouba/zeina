package jwt

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "this-is-a-32+byte-test-secret-only-for-tests"

func newTestSigner(t *testing.T) *Signer {
	t.Helper()
	s, err := NewSigner(testSecret, 15*time.Minute, 7*24*time.Hour)
	require.NoError(t, err)
	return s
}

func TestNewSigner_RejectsShortSecret(t *testing.T) {
	_, err := NewSigner("short", time.Minute, time.Hour)
	require.Error(t, err)
}

func TestSignAndParseAccess(t *testing.T) {
	s := newTestSigner(t)
	uid := uuid.New()

	tok, err := s.SignAccess(uid, "acme", "admin", false)
	require.NoError(t, err)
	assert.NotEmpty(t, tok)
	assert.Equal(t, 3, strings.Count(tok, ".")+1) // header.payload.signature

	c, err := s.ParseAccess(tok)
	require.NoError(t, err)
	assert.Equal(t, uid.String(), c.Subject)
	assert.Equal(t, "acme", c.TenantID)
	assert.Equal(t, "admin", c.Role)
	assert.Equal(t, TokenAccess, c.Type)
}

func TestParseAccess_RejectsRefreshToken(t *testing.T) {
	s := newTestSigner(t)
	tok, err := s.SignRefresh(uuid.New(), "acme", "viewer", false)
	require.NoError(t, err)

	_, err = s.ParseAccess(tok)
	require.Error(t, err)
}

func TestParse_RejectsTamperedToken(t *testing.T) {
	s := newTestSigner(t)
	tok, _ := s.SignAccess(uuid.New(), "acme", "admin", false)
	tampered := tok[:len(tok)-2] + "AA"
	_, err := s.ParseAccess(tampered)
	require.Error(t, err)
}

func TestParse_RejectsExpiredToken(t *testing.T) {
	s, err := NewSigner(testSecret, time.Nanosecond, time.Hour)
	require.NoError(t, err)
	tok, _ := s.SignAccess(uuid.New(), "acme", "admin", false)
	time.Sleep(2 * time.Millisecond)
	_, err = s.ParseAccess(tok)
	require.Error(t, err)
}

func TestParse_RejectsWrongSigner(t *testing.T) {
	s1 := newTestSigner(t)
	s2, _ := NewSigner("a-different-secret-of-32-or-more-bytes!", time.Minute, time.Hour)
	tok, _ := s1.SignAccess(uuid.New(), "acme", "admin", false)
	_, err := s2.ParseAccess(tok)
	require.Error(t, err)
}
