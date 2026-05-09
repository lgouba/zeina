package bus

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSetGet(t *testing.T) {
	b := New()
	b.Set("a", "on")
	v, ok := b.Get("a")
	assert.True(t, ok)
	assert.Equal(t, "on", v)
}

func TestGetMissing(t *testing.T) {
	b := New()
	_, ok := b.Get("missing")
	assert.False(t, ok)
	assert.Equal(t, "default", b.GetString("missing", "default"))
	assert.True(t, b.GetBool("missing", true))
	assert.Equal(t, 1.5, b.GetFloat("missing", 1.5))
}

func TestTypedGettersWrongType(t *testing.T) {
	b := New()
	b.Set("a", 42) // int, not float64
	assert.Equal(t, 1.5, b.GetFloat("a", 1.5), "wrong type → default")
	assert.Equal(t, "def", b.GetString("a", "def"))
}

func TestConcurrentAccess(t *testing.T) {
	b := New()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); b.Set("k", "v") }()
		go func() { defer wg.Done(); b.GetString("k", "") }()
	}
	wg.Wait()
}
