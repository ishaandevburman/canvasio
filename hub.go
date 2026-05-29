package main

import (
	"encoding/json"
	"log"
	"sync"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Stroke struct {
	ID      string  `json:"id"`
	Points  []Point `json:"points"`
	Color   string  `json:"color"`
	Size    float64 `json:"size"`
	Tool    string  `json:"tool"`
	Pending bool    `json:"pending"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]bool
	strokes []Stroke
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*Client]bool),
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()

	completed := []Stroke{}
	h.mu.RLock()
	for _, s := range h.strokes {
		if !s.Pending {
			completed = append(completed, s)
		}
	}
	h.mu.RUnlock()

	data, err := json.Marshal(map[string]any{
		"type":   "init",
		"strokes": completed,
	})
	if err != nil {
		log.Printf("marshal init error: %v", err)
		return
	}
	c.send <- data
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	close(c.send)
}

func (h *Hub) Broadcast(msg []byte, sender *Client) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(msg, &envelope); err != nil {
		return
	}

	switch envelope.Type {
	case "draw":
		var payload struct {
			Data Stroke `json:"data"`
		}
		if err := json.Unmarshal(msg, &payload); err != nil {
			return
		}
		if !payload.Data.Pending {
			h.mu.Lock()
			h.strokes = append(h.strokes, payload.Data)
			h.mu.Unlock()
		}

	case "clear":
		h.mu.Lock()
		h.strokes = nil
		h.mu.Unlock()
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client == sender {
			continue
		}
		select {
		case client.send <- msg:
		default:
		}
	}
}
