package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
)

type noDirFS struct {
	http.FileSystem
}

func (n noDirFS) Open(name string) (http.File, error) {
	f, err := n.FileSystem.Open(name)
	if err != nil {
		return nil, err
	}
	s, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if s.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	rm := NewRoomManager()

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(noDirFS{http.Dir("static")})))

	http.HandleFunc("/room/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	http.HandleFunc("/room", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/room/default", http.StatusFound)
	})

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/room/default", http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		roomID := r.URL.Query().Get("room")
		if roomID == "" {
			roomID = "default"
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("upgrade error: %v", err)
			return
		}

		hub := rm.GetOrCreate(roomID)
		client := NewClient(hub, conn)
		hub.Register(client)

		go client.WritePump()
		go client.ReadPump()
	})

	log.Println("canvasio running on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
