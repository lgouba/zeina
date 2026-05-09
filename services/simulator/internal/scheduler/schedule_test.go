package scheduler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseEmpty(t *testing.T) {
	s, err := Parse("")
	require.NoError(t, err)
	assert.Nil(t, s)
}

func TestParseHappy(t *testing.T) {
	s, err := Parse("occupied 08:00-18:00 mon-fri")
	require.NoError(t, err)
	assert.Equal(t, 8, s.StartHour)
	assert.Equal(t, 0, s.StartMin)
	assert.Equal(t, 18, s.EndHour)
	assert.Equal(t, 0, s.EndMin)
	assert.True(t, s.Days[time.Monday])
	assert.True(t, s.Days[time.Friday])
	assert.False(t, s.Days[time.Saturday])
	assert.False(t, s.Days[time.Sunday])
}

func TestParseExplicitList(t *testing.T) {
	s, err := Parse("occupied 09:30-17:30 mon,wed,fri")
	require.NoError(t, err)
	assert.True(t, s.Days[time.Monday])
	assert.False(t, s.Days[time.Tuesday])
	assert.True(t, s.Days[time.Wednesday])
	assert.False(t, s.Days[time.Thursday])
	assert.True(t, s.Days[time.Friday])
}

func TestParseInvalid(t *testing.T) {
	cases := []string{
		"08:00-18:00 mon-fri",            // manque "occupied"
		"occupied 08-18 mon-fri",         // mauvais format heure
		"occupied 25:00-26:00 mon-fri",   // heure invalide
		"occupied 08:00-18:00 mon-zzz",   // jour invalide
		"occupied 08:00-18:00",           // pas de jours
	}
	for _, c := range cases {
		t.Run(c, func(t *testing.T) {
			_, err := Parse(c)
			require.Error(t, err)
		})
	}
}

func TestIsActiveSimple(t *testing.T) {
	s, err := Parse("occupied 08:00-18:00 mon-fri")
	require.NoError(t, err)
	tz, _ := time.LoadLocation("UTC")

	mondayMorning := time.Date(2026, 5, 4, 9, 0, 0, 0, tz) // lundi 9:00
	assert.True(t, s.IsActive(mondayMorning))

	mondayLate := time.Date(2026, 5, 4, 18, 30, 0, 0, tz) // lundi 18:30
	assert.False(t, s.IsActive(mondayLate))

	sundayNoon := time.Date(2026, 5, 3, 12, 0, 0, 0, tz)
	assert.False(t, s.IsActive(sundayNoon))

	mondayBoundaryStart := time.Date(2026, 5, 4, 8, 0, 0, 0, tz)
	assert.True(t, s.IsActive(mondayBoundaryStart))

	mondayBoundaryEnd := time.Date(2026, 5, 4, 17, 59, 0, 0, tz)
	assert.True(t, s.IsActive(mondayBoundaryEnd))

	mondayExactEnd := time.Date(2026, 5, 4, 18, 0, 0, 0, tz)
	assert.False(t, s.IsActive(mondayExactEnd))
}

func TestIsActiveOvernight(t *testing.T) {
	s, err := Parse("occupied 22:00-06:00 mon-sun")
	require.NoError(t, err)
	tz, _ := time.LoadLocation("UTC")

	assert.True(t, s.IsActive(time.Date(2026, 5, 4, 23, 30, 0, 0, tz)))
	assert.True(t, s.IsActive(time.Date(2026, 5, 4, 5, 0, 0, 0, tz)))
	assert.False(t, s.IsActive(time.Date(2026, 5, 4, 12, 0, 0, 0, tz)))
}

func TestIsActiveNil(t *testing.T) {
	var s *Schedule
	assert.False(t, s.IsActive(time.Now()))
}

func TestParseCircularRange(t *testing.T) {
	s, err := Parse("occupied 09:00-17:00 fri-mon") // fri, sat, sun, mon
	require.NoError(t, err)
	assert.True(t, s.Days[time.Friday])
	assert.True(t, s.Days[time.Saturday])
	assert.True(t, s.Days[time.Sunday])
	assert.True(t, s.Days[time.Monday])
	assert.False(t, s.Days[time.Tuesday])
}
