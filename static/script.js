const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')
const statusEl = document.getElementById('status')

let tool = 'brush'
let color = '#000000'
let size = 3
let drawing = false
let currentPoints = []
let strokes = []

function resize() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  redraw()
}

window.addEventListener('resize', resize)
resize()

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const s of strokes) {
    drawStroke(s)
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

// --- Cursor preview ---

const cursorEl = document.createElement('div')
cursorEl.id = 'cursor-preview'
document.body.appendChild(cursorEl)

function updateCursorPreview(visible, x, y) {
  if (!visible) {
    cursorEl.style.display = 'none'
    return
  }
  const r = size / 2
  cursorEl.style.display = 'block'
  cursorEl.style.width = size + 'px'
  cursorEl.style.height = size + 'px'
  cursorEl.style.borderRadius = '50%'
  cursorEl.style.background = tool === 'eraser' ? 'transparent' : color
  cursorEl.style.border = tool === 'eraser' ? '2px dashed #999' : `2px solid ${color === '#ffffff' ? '#ccc' : color}`
  cursorEl.style.position = 'fixed'
  cursorEl.style.pointerEvents = 'none'
  cursorEl.style.zIndex = '999'
  cursorEl.style.left = (x - r) + 'px'
  cursorEl.style.top = (y - r) + 'px'
  cursorEl.style.transform = 'translate(-0.5px, -0.5px)'
}

canvas.addEventListener('mousemove', (e) => {
  updateCursorPreview(true, e.clientX, e.clientY)
})

canvas.addEventListener('mouseleave', () => {
  updateCursorPreview(false)
})

// --- WebSocket ---

let ws = null

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = location.host
  if (!host) {
    statusEl.textContent = 'Open via HTTP server (go run .)'
    statusEl.className = 'disconnected'
    return
  }

  try {
    ws = new WebSocket(`${protocol}//${host}/ws`)
  } catch (e) {
    statusEl.textContent = 'Connection failed'
    statusEl.className = 'disconnected'
    setTimeout(connect, 2000)
    return
  }

  ws.onopen = () => {
    statusEl.textContent = 'Connected'
    statusEl.className = 'connected'
  }

  ws.onclose = () => {
    statusEl.textContent = 'Disconnected'
    statusEl.className = 'disconnected'
    setTimeout(connect, 2000)
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)

    switch (msg.type) {
      case 'init':
        strokes = msg.strokes || []
        redraw()
        break

      case 'draw':
        strokes.push(msg.data)
        drawStroke(msg.data)
        break

      case 'clear':
        strokes = []
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        break
    }
  }
}

connect()

// --- Drawing ---

function getPos(e) {
  const rect = canvas.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function startDraw(e) {
  e.preventDefault()
  drawing = true
  const pos = getPos(e)
  currentPoints = [pos]
}

function moveDraw(e) {
  e.preventDefault()
  if (!drawing) return
  const pos = getPos(e)
  currentPoints.push(pos)
  if (currentPoints.length < 2) return

  const prev = currentPoints[currentPoints.length - 2]
  const s = { points: [prev, pos], color, size, tool }
  drawStroke(s)
}

function endDraw(e) {
  e.preventDefault()
  if (!drawing) return
  drawing = false

  if (currentPoints.length === 0) return

  const stroke = { points: currentPoints, color, size, tool }
  strokes.push(stroke)

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'draw', data: stroke }))
  }

  currentPoints = []
}

canvas.addEventListener('mousedown', startDraw)
canvas.addEventListener('mousemove', moveDraw)
canvas.addEventListener('mouseup', endDraw)
canvas.addEventListener('mouseleave', endDraw)

canvas.addEventListener('touchstart', startDraw, { passive: false })
canvas.addEventListener('touchmove', moveDraw, { passive: false })
canvas.addEventListener('touchend', endDraw, { passive: false })

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
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'clear' }))
  }
})
