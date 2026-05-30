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
const sizeSlider = document.getElementById('size-slider')
const sizeInput = document.getElementById('size-input')
const clearModal = document.getElementById('clear-modal')

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
let localPendingClear = false
let hasConnected = false
let viewport = { x: 0, y: 0, zoom: 1 }
let shapeStart = null

const SEND_INTERVAL = 30
const MIN_POINT_DIST = 2

function screenToWorld(sx, sy) {
  return { x: (sx - viewport.x) / viewport.zoom, y: (sy - viewport.y) / viewport.zoom }
}

function worldToScreen(wx, wy) {
  return { x: wx * viewport.zoom + viewport.x, y: wy * viewport.zoom + viewport.y }
}

const pathParts = window.location.pathname.split('/').filter(Boolean)
let roomId = (pathParts[0] === 'room' && pathParts[1]) ? pathParts[1] : 'default'
roomId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
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
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  for (const s of strokes) {
    drawStroke(s)
  }
  for (const id in pendingStrokes) {
    drawStroke(pendingStrokes[id])
  }
}

function drawStroke(s) {
  ctx.save()
  ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y)
  const sw = s.tool === 'eraser' ? '#fff' : s.color
  if (s.tool === 'rect' || s.tool === 'circle' || s.tool === 'line') {
    if (s.points.length < 2) { ctx.restore(); return }
    ctx.strokeStyle = sw
    ctx.lineWidth = s.size
    const p0 = s.points[0], p1 = s.points[s.points.length - 1]
    if (s.tool === 'rect') {
      ctx.strokeRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y))
    } else if (s.tool === 'circle') {
      ctx.beginPath()
      ctx.ellipse((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, Math.abs(p1.x - p0.x) / 2, Math.abs(p1.y - p0.y) / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (s.tool === 'line') {
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (s.points.length < 2) {
    ctx.fillStyle = sw
    ctx.beginPath()
    ctx.arc(s.points[0].x, s.points[0].y, s.size / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.strokeStyle = sw
  ctx.lineWidth = s.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(s.points[0].x, s.points[0].y)
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x, s.points[i].y)
  }
  ctx.stroke()
  ctx.restore()
}

function drawSegment(points, color, size, tool) {
  if (points.length < 2) return
  ctx.save()
  ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y)
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
  ctx.restore()
}

function drawShapePreview(p0, p1) {
  if (!p0 || !p1) return
  ctx.save()
  ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y)
  ctx.strokeStyle = color
  ctx.lineWidth = size
  if (tool === 'rect') {
    ctx.strokeRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y))
  } else if (tool === 'circle') {
    ctx.beginPath()
    ctx.ellipse((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, Math.abs(p1.x - p0.x) / 2, Math.abs(p1.y - p0.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (tool === 'line') {
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
  }
  ctx.restore()
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

function updateCursorPreview() {
  cursorEl.className = tool
  cursorEl.style.width = cursorEl.style.height = size + 'px'
  cursorEl.style.background = tool === 'eraser' ? 'transparent' : color
  cursorEl.style.borderColor = tool === 'eraser' ? '#999' : (color === '#ffffff' ? '#ccc' : color)
}

let rafId = null
canvas.addEventListener('mousemove', (e) => {
  if (drawing) return
  cancelAnimationFrame(rafId)
  const cx = e.clientX, cy = e.clientY
  rafId = requestAnimationFrame(() => {
    cursorEl.style.display = 'block'
    updateCursorPreview()
    cursorEl.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px)`
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
        if (localPendingClear) {
          strokes = []
          pendingStrokes = {}
          localPendingClear = false
          ws.send(JSON.stringify({ type: 'clear' }))
        } else {
          strokes = msg.strokes || []
          pendingStrokes = {}
        }
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
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.restore()
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
      case 'stroke-removed':
        strokes = strokes.filter(s => s.id !== msg.strokeId)
        delete pendingStrokes[msg.strokeId]
        redraw()
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
  const t = e.touches?.length ? e.touches[0] : e.changedTouches?.[0]
  const clientX = t ? t.clientX : e.clientX
  const clientY = t ? t.clientY : e.clientY
  return screenToWorld(clientX - rect.left, clientY - rect.top)
}

function flushSend() {
  if (unsentPoints.length === 0) return
  const data = { id: strokeId, points: unsentPoints, color, size, tool, pending: true }
  ws.send(JSON.stringify({ type: 'draw', data }))
  unsentPoints = []
}

function startDraw(e) {
  e.preventDefault()
  cancelAnimationFrame(rafId)
  drawing = true
  cursorEl.style.display = 'none'
  const pos = getPos(e)
  if (tool === 'rect' || tool === 'circle' || tool === 'line') {
    cursorEl.style.display = 'none'
    shapeStart = pos
    currentPoints = [pos]
    return
  }
  strokeId = nextStrokeId()
  currentPoints = [pos]
  unsentPoints = [pos]
  lastSendTime = performance.now()
}

function moveDraw(e) {
  if (!drawing) return
  e.preventDefault()
  const pos = getPos(e)
  if (tool === 'rect' || tool === 'circle' || tool === 'line') {
    currentPoints = [shapeStart, pos]
    redraw()
    drawShapePreview(shapeStart, pos)
    return
  }
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
  if (!drawing) return
  e.preventDefault()
  drawing = false

  if (tool === 'rect' || tool === 'circle' || tool === 'line') {
    if (currentPoints.length === 2) {
      const id = nextStrokeId()
      const stroke = { id, points: currentPoints, color, size, tool, pending: false }
      strokes.push(stroke)
      ws.send(JSON.stringify({ type: 'draw', data: stroke }))
      redraw()
    }
    shapeStart = null
    currentPoints = []
    cursorEl.style.display = 'block'
    return
  }

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
  updateCursorPreview()
})

document.getElementById('tool-eraser').addEventListener('click', () => {
  tool = 'eraser'
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
  document.getElementById('tool-eraser').classList.add('active')
  canvas.style.cursor = 'cell'
  updateCursorPreview()
})

document.querySelectorAll('[data-tool="rect"], [data-tool="circle"], [data-tool="line"]').forEach(btn => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    canvas.style.cursor = 'crosshair'
    updateCursorPreview()
  })
})

document.getElementById('color-picker').addEventListener('input', (e) => {
  color = e.target.value
  updateCursorPreview()
})

sizeSlider.addEventListener('input', (e) => {
  size = parseInt(e.target.value)
  sizeInput.value = size
  updateCursorPreview()
})

sizeInput.addEventListener('input', (e) => {
  const raw = e.target.value
  if (raw === '') return
  const v = parseInt(raw)
  if (isNaN(v) || v < 1) return
  size = v
  if (v <= parseInt(sizeSlider.max)) sizeSlider.value = v
  updateCursorPreview()
})

sizeInput.addEventListener('blur', (e) => {
  let v = parseInt(e.target.value)
  if (isNaN(v) || v < 1) {
    v = 1
    size = v
    e.target.value = v
    sizeSlider.value = v
    updateCursorPreview()
  }
})

document.getElementById('clear-btn').addEventListener('click', () => {
  clearModal.style.display = 'flex'
})

document.getElementById('clear-cancel').addEventListener('click', () => {
  clearModal.style.display = 'none'
})

document.getElementById('undo-btn').addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'undo' }))
  }
})

document.getElementById('clear-confirm').addEventListener('click', () => {
  clearModal.style.display = 'none'
  strokes = []
  pendingStrokes = {}
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.restore()
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }))
  } else {
    localPendingClear = true
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
