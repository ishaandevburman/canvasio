const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const statusEl = document.getElementById('status')
const roomLabelEl = document.getElementById('room-label')
const userListEl = document.getElementById('user-list')
const appEl = document.getElementById('app')
const joinModal = document.getElementById('join-modal')
const joinNameInput = document.getElementById('join-name-input')
const joinBtn = document.getElementById('join-btn')
const joinRoomLabel = document.getElementById('join-room-label')
const nameDisplay = document.getElementById('name-display')

const USER_COLORS = ['#e74c3c', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']

let tool = 'brush'
let color = '#000000'
let size = 3
let drawing = false
let currentPoints = []
let strokes = []
let pendingStrokes = {}
let strokeId = ''
let unsentPoints = []
let lastSendTime = 0
let strokeIdCounter = 0
let myUserId = ''
let users = []
let hasConnected = false

const SEND_INTERVAL = 30
const MIN_POINT_DIST = 2

const pathParts = window.location.pathname.split('/').filter(Boolean)
const roomId = (pathParts[0] === 'room' && pathParts[1]) ? pathParts[1] : 'default'
roomLabelEl.textContent = roomId === 'default' ? '' : roomId
joinRoomLabel.textContent = roomId === 'default' ? '' : 'Room: ' + roomId

let userId = localStorage.getItem('canvasio_userId')
if (!userId) {
  userId = 'user_' + Math.random().toString(16).slice(2, 10)
  localStorage.setItem('canvasio_userId', userId)
}

let displayName = localStorage.getItem('canvasio_displayName') || ''
if (displayName) joinNameInput.value = displayName

joinModal.style.display = 'flex'
joinNameInput.focus()

function startApp(name) {
  joinModal.style.display = 'none'
  appEl.style.display = 'block'
  nameDisplay.textContent = name
  resize()
  connect(name)
}

joinBtn.addEventListener('click', () => {
  const name = joinNameInput.value.trim()
  if (!name) return
  displayName = name
  localStorage.setItem('canvasio_displayName', name)
  startApp(name)
})

joinNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click()
})

function resize() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  redraw()
}

window.addEventListener('resize', resize)

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const s of strokes) {
    drawStroke(s)
  }
  for (const id in pendingStrokes) {
    drawStroke(pendingStrokes[id])
  }
}

function drawStroke(s) {
  if (s.points.length < 2) {
    ctx.fillStyle = s.tool === 'eraser' ? '#fff' : s.color
    ctx.beginPath()
    ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  ctx.strokeStyle = s.tool === 'eraser' ? '#fff' : s.color
  ctx.lineWidth = s.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(s.points[0].x, s.points[0].y)
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x, s.points[i].y)
  }
  ctx.stroke()
}

function drawSegment(points, color, size, tool) {
  if (points.length < 2) return
  ctx.strokeStyle = tool === 'eraser' ? '#fff' : color
  ctx.lineWidth = size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
}

function dist(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function nextStrokeId() {
  return `${Date.now()}_${strokeIdCounter++}`
}

// --- Cursor preview ---

const cursorEl = document.createElement('div')
cursorEl.id = 'cursor-preview'
document.body.appendChild(cursorEl)

let rafId = null
canvas.addEventListener('mousemove', (e) => {
  if (drawing) return
  cancelAnimationFrame(rafId)
  const cx = e.clientX, cy = e.clientY
  rafId = requestAnimationFrame(() => {
    const r = size / 2
    cursorEl.style.display = 'block'
    cursorEl.className = tool
    cursorEl.style.width = cursorEl.style.height = size + 'px'
    cursorEl.style.background = tool === 'eraser' ? 'transparent' : color
    cursorEl.style.borderColor = tool === 'eraser' ? '#999' : (color === '#ffffff' ? '#ccc' : color)
    cursorEl.style.transform = `translate(${cx - r}px, ${cy - r}px)`
  })
})

canvas.addEventListener('mouseleave', () => {
  if (!drawing) cursorEl.style.display = 'none'
})

// --- User list ---

function renderUsers() {
  if (users.length === 0) {
    userListEl.textContent = ''
    userListEl.style.display = 'none'
    return
  }
  userListEl.style.display = 'flex'
  userListEl.innerHTML = users.map((u, i) => {
    const label = u.id === myUserId ? `${escapeHtml(u.displayName)} (you)` : escapeHtml(u.displayName)
    return `<span class="user-chip"><span class="user-dot" style="background:${USER_COLORS[i % USER_COLORS.length]}"></span>${label}</span>`
  }).join('')
}

function escapeHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// --- WebSocket ---

let ws = null

function connect(name) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.host
  if (!host) {
    statusEl.textContent = 'Open via HTTP server (go run .)'
    statusEl.className = 'disconnected'
    return
  }
  if (!hasConnected) {
    statusEl.textContent = 'Connecting...'
    statusEl.className = 'disconnected'
  }
  try {
    ws = new WebSocket(`${protocol}//${host}/ws?room=${roomId}`)
  } catch (e) {
    statusEl.textContent = 'Connection failed'
    statusEl.className = 'disconnected'
    setTimeout(() => connect(name), 2000)
    return
  }
  ws.onopen = () => {
    hasConnected = true
    statusEl.textContent = 'Connected'
    statusEl.className = 'connected'
    ws.send(JSON.stringify({
      type: 'join',
      userId: userId,
      displayName: name,
    }))
  }
  ws.onclose = () => {
    statusEl.textContent = 'Disconnected'
    statusEl.className = 'disconnected'
    setTimeout(() => connect(name), 2000)
  }
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    switch (msg.type) {
      case 'init':
        strokes = msg.strokes || []
        pendingStrokes = {}
        myUserId = msg.userId || ''
        users = msg.users || []
        renderUsers()
        redraw()
        break
      case 'draw': {
        const d = msg.data
        if (d.pending) {
          drawSegment(d.points, d.color, d.size, d.tool)
          if (pendingStrokes[d.id]) {
            pendingStrokes[d.id].points.push(...d.points)
          } else {
            pendingStrokes[d.id] = { id: d.id, points: [...d.points], color: d.color, size: d.size, tool: d.tool }
          }
        } else {
          delete pendingStrokes[d.id]
          strokes.push(d)
          drawStroke(d)
        }
        break
      }
      case 'clear':
        strokes = []
        pendingStrokes = {}
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        break
      case 'user-joined':
        users = users.filter(u => u.id !== msg.userId)
        users.push({ id: msg.userId, displayName: msg.displayName })
        renderUsers()
        break
      case 'user-left':
        users = users.filter(u => u.id !== msg.userId)
        renderUsers()
        break
      case 'user-updated':
        const u = users.find(u => u.id === msg.userId)
        if (u) u.displayName = msg.displayName
        renderUsers()
        break
    }
  }
}

// --- Drawing ---

function getPos(e) {
  const rect = canvas.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function flushSend() {
  if (unsentPoints.length === 0) return
  const data = { id: strokeId, points: unsentPoints, color, size, tool, pending: true }
  ws.send(JSON.stringify({ type: 'draw', data }))
  unsentPoints = []
}

function startDraw(e) {
  e.preventDefault()
  drawing = true
  strokeId = nextStrokeId()
  const pos = getPos(e)
  currentPoints = [pos]
  unsentPoints = [pos]
  lastSendTime = performance.now()
  cursorEl.style.display = 'none'
}

function moveDraw(e) {
  e.preventDefault()
  if (!drawing) return
  const pos = getPos(e)
  const last = currentPoints[currentPoints.length - 1]
  if (last && dist(last, pos) < MIN_POINT_DIST) return

  currentPoints.push(pos)
  unsentPoints.push(pos)

  if (currentPoints.length >= 2) {
    drawSegment([currentPoints[currentPoints.length - 2], pos], color, size, tool)
  }

  const now = performance.now()
  if (now - lastSendTime >= SEND_INTERVAL) {
    flushSend()
    lastSendTime = now
  }
}

function endDraw(e) {
  e.preventDefault()
  if (!drawing) return
  drawing = false

  if (currentPoints.length > 0) {
    flushSend()
    const stroke = { id: strokeId, points: currentPoints, color, size, tool, pending: false }
    strokes.push(stroke)
    ws.send(JSON.stringify({ type: 'draw', data: stroke }))
  }

  currentPoints = []
  unsentPoints = []
  strokeId = ''
  cursorEl.style.display = 'block'
}

canvas.addEventListener('mousedown', startDraw)
window.addEventListener('mousemove', moveDraw)
window.addEventListener('mouseup', endDraw)

canvas.addEventListener('touchstart', startDraw, { passive: false })
window.addEventListener('touchmove', moveDraw, { passive: false })
window.addEventListener('touchend', endDraw, { passive: false })

// --- Toolbar ---

document.getElementById('tool-brush').addEventListener('click', () => {
  tool = 'brush'
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
  document.getElementById('tool-brush').classList.add('active')
  canvas.style.cursor = 'crosshair'
})

document.getElementById('tool-eraser').addEventListener('click', () => {
  tool = 'eraser'
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
  document.getElementById('tool-eraser').classList.add('active')
  canvas.style.cursor = 'cell'
})

document.getElementById('color-picker').addEventListener('input', (e) => {
  color = e.target.value
})

document.getElementById('size-slider').addEventListener('input', (e) => {
  size = parseInt(e.target.value)
  document.getElementById('size-label').textContent = size
})

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear the board for everyone?')) return
  strokes = []
  pendingStrokes = {}
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }))
  }
})

nameDisplay.addEventListener('click', () => {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = nameDisplay.textContent
  input.maxLength = 24
  input.className = 'name-edit-input'
  nameDisplay.textContent = ''
  nameDisplay.appendChild(input)
  input.focus()
  input.select()

  function done() {
    const newName = input.value.trim()
    if (newName && newName !== displayName) {
      displayName = newName
      localStorage.setItem('canvasio_displayName', newName)
      nameDisplay.textContent = newName
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set-name', displayName: newName }))
      }
    } else {
      nameDisplay.textContent = displayName
    }
  }

  input.addEventListener('blur', done)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur() }
    if (e.key === 'Escape') { nameDisplay.textContent = displayName }
  })
})
