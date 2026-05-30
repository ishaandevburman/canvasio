package main

import (
	"encoding/json"
	"sync"
)

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Stroke struct {
	ID      string   `json:"id"`
	Points  []Point  `json:"points"`
	Color   string   `json:"color"`
	Size    float64  `json:"size"`
	Tool    string   `json:"tool"`
	Pending bool     `json:"pending"`
	UserID  string   `json:"userId,omitempty"`
}

type User struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type Hub struct {
	roomID      string
	roomManager *RoomManager
	mu          sync.RWMutex
	clients     map[*Client]bool
	strokes     []Stroke
}

func NewHub(roomID string) *Hub {
	return &Hub{
		roomID:  roomID,
		clients: make(map[*Client]bool),
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.clients, c)
	empty := len(h.clients) == 0
	h.mu.Unlock()
	c.closeSend()

	if empty {
		h.roomManager.removeRoom(h.roomID)
	}

	if c.replaced || c.userID == "" {
		return
	}

	// A new connection with the same userId may have joined while we
	// weren't holding the lock. If so, skip user-left (the new
	// connection's HandleJoin already sent or will send user-joined).
	h.mu.RLock()
	for cl := range h.clients {
		if cl.userID == c.userID {
			h.mu.RUnlock()
			return
		}
	}
	h.mu.RUnlock()

	leftMsg, _ := json.Marshal(map[string]any{
		"type":   "user-left",
		"userId": c.userID,
	})
	h.mu.RLock()
	for cl := range h.clients {
		select {
		case cl.send <- leftMsg:
		default:
		}
	}
	h.mu.RUnlock()
}

func (h *Hub) HandleJoin(c *Client, msg []byte) {
	var payload struct {
		UserID      string `json:"userId"`
		DisplayName string `json:"displayName"`
	}
	if err := json.Unmarshal(msg, &payload); err != nil {
		return
	}

	c.userID = payload.UserID
	c.displayName = payload.DisplayName
	if c.displayName == "" {
		c.displayName = "Anonymous"
	}

	h.mu.Lock()
	for cl := range h.clients {
		if cl != c && cl.userID == payload.UserID {
			cl.replaced = true
			delete(h.clients, cl)
			cl.closeSend()
			cl.conn.Close()
		}
	}

	completed := make([]Stroke, 0)
	for _, s := range h.strokes {
		if !s.Pending {
			completed = append(completed, s)
		}
	}

	users := make([]User, 0)
	for cl := range h.clients {
		if cl.userID != "" {
			users = append(users, User{ID: cl.userID, DisplayName: cl.displayName})
		}
	}
	h.mu.Unlock()

	initMsg, _ := json.Marshal(map[string]any{
		"type":   "init",
		"strokes": completed,
		"users":  users,
		"userId": c.userID,
	})
	select {
	case c.send <- initMsg:
	default:
	}

	joinedMsg, _ := json.Marshal(map[string]any{
		"type":        "user-joined",
		"userId":      c.userID,
		"displayName": c.displayName,
	})

	h.mu.RLock()
	defer h.mu.RUnlock()
	for cl := range h.clients {
		if cl == c {
			continue
		}
		select {
		case cl.send <- joinedMsg:
		default:
		}
	}
}

func (h *Hub) HandleSetName(c *Client, msg []byte) {
	var payload struct {
		DisplayName string `json:"displayName"`
	}
	if err := json.Unmarshal(msg, &payload); err != nil {
		return
	}
	c.displayName = payload.DisplayName

	updateMsg, _ := json.Marshal(map[string]any{
		"type":        "user-updated",
		"userId":      c.userID,
		"displayName": c.displayName,
	})

	h.mu.RLock()
	defer h.mu.RUnlock()
	for cl := range h.clients {
		if cl == c {
			continue
		}
		select {
		case cl.send <- updateMsg:
		default:
		}
	}
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
		if sender.userID == "" {
			return
		}
		var payload struct {
			Data Stroke `json:"data"`
		}
		if err := json.Unmarshal(msg, &payload); err != nil {
			return
		}
		payload.Data.UserID = sender.userID
		if !payload.Data.Pending {
			h.mu.Lock()
			h.strokes = append(h.strokes, payload.Data)
			h.mu.Unlock()
		}
		if b, err := json.Marshal(map[string]any{"type": "draw", "data": payload.Data}); err == nil {
			msg = b
		}

	case "clear":
		h.mu.Lock()
		h.strokes = nil
		h.mu.Unlock()
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for cl := range h.clients {
		if cl == sender {
			continue
		}
		select {
		case cl.send <- msg:
		default:
		}
	}
}

type RoomManager struct {
	mu    sync.RWMutex
	rooms map[string]*Hub
}

func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Hub),
	}
}

func (rm *RoomManager) GetOrCreate(roomID string) *Hub {
	rm.mu.RLock()
	hub, ok := rm.rooms[roomID]
	rm.mu.RUnlock()
	if ok {
		return hub
	}

	rm.mu.Lock()
	defer rm.mu.Unlock()

	if hub, ok := rm.rooms[roomID]; ok {
		return hub
	}

	hub = NewHub(roomID)
	hub.roomManager = rm
	rm.rooms[roomID] = hub
	return hub
}

func (rm *RoomManager) removeRoom(roomID string) {
	rm.mu.Lock()
	delete(rm.rooms, roomID)
	rm.mu.Unlock()
}
