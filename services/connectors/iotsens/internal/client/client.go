// Package client encapsule l'accès à l'API IoTSens (HTTP REST avec X-API-Key).
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Measurement — payload natif IoTSens (format inventé pour la démo).
type Measurement struct {
	Timestamp string  `json:"timestamp"` // RFC3339
	Type      string  `json:"type"`
	Value     float64 `json:"value"`
	Unit      string  `json:"unit"`
	Quality   string  `json:"quality"`
}

func (m Measurement) ParsedTime() (time.Time, error) {
	return time.Parse(time.RFC3339Nano, m.Timestamp)
}

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		http:    &http.Client{Timeout: timeout},
	}
}

// Measurements récupère les mesures d'un device depuis `since`.
func (c *Client) Measurements(ctx context.Context, deviceID string, since time.Time) ([]Measurement, error) {
	u := fmt.Sprintf("%s/api/v1/devices/%s/measurements?since=%s",
		c.baseURL, url.PathEscape(deviceID), url.QueryEscape(since.UTC().Format(time.RFC3339Nano)))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("iotsens GET %s: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("iotsens GET %s: status %d: %s", u, resp.StatusCode, string(body))
	}
	var out []Measurement
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("iotsens decode: %w", err)
	}
	return out, nil
}

// Command envoie une commande pour un device IoTSens.
func (c *Client) Command(ctx context.Context, deviceID string, body []byte) error {
	u := fmt.Sprintf("%s/api/v1/devices/%s/commands", c.baseURL, url.PathEscape(deviceID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("iotsens POST command: status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
