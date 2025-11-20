import React, { useRef, useEffect, useState } from 'react'

const WIDTH = 480
const HEIGHT = 320

function rand(min, max){
  return Math.random() * (max - min) + min
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)) }

// circle vs axis-aligned rect collision
function circleRectCollision(cx, cy, r, rx, ry, rw, rh){
  const closestX = Math.max(rx, Math.min(cx, rx + rw))
  const closestY = Math.max(ry, Math.min(cy, ry + rh))
  const dx = cx - closestX
  const dy = cy - closestY
  return (dx*dx + dy*dy) <= (r*r)
}

export default function App(){
  const canvasRef = useRef(null)
  const [colorIndex, setColorIndex] = useState(0)

  useEffect(()=>{
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    let raf = null
    let last = performance.now()
    let spawnTimer = 0
    let elapsed = 0
    let score = 0
    let gameOver = false

    // richer, more 'pico' palette (neon/cool set)
    const colors = ['#1D2B53','#7E2553','#008751','#AB5236','#5F574F','#C2C3C7','#FFF1E8','#FF004D','#FFA300','#FFEC27','#00E436','#29ADFF','#83769C','#FF77A8','#FFCCAA']

    const player = {
      x: WIDTH/2,
      y: HEIGHT/2,
      size: 22, // square: width/height
      speed: 160, // px per sec
      color: colors[colorIndex]
    }

    let keys = {}
    let colorTimer = 0
    const colorInterval = 0.08 // seconds between color steps while holding

    function cycleColor(){
      setColorIndex(ci => {
        const ni = (ci + 1) % colors.length
        player.color = colors[ni]
        return ni
      })
    }

    function reset(){
      player.x = WIDTH/2
      player.y = HEIGHT/2
      player.size = 22
      player.color = colors[colorIndex]
      obstacles = []
      spawnTimer = 0
      elapsed = 0
      score = 0
      gameOver = false
      colorTimer = 0
    }

    let obstacles = []

    function getSpawnInterval(){
      // spawn faster as time increases
      const baseMin = Math.max(0.25, 0.9 - elapsed * 0.01)
      const baseMax = Math.max(0.45, 1.2 - elapsed * 0.01)
      return rand(baseMin, baseMax)
    }

    function spawn(){
      const edge = Math.floor(rand(0,4))
      let x,y,vx,vy
      const size = Math.floor(rand(8, 48))
      const speed = rand(40, 240)
      if(edge===0){ // top
        x = rand(0, WIDTH); y = -size; vx = rand(-1,1); vy = 1
      } else if(edge===1){ // right
        x = WIDTH + size; y = rand(0, HEIGHT); vx = -1; vy = rand(-1,1)
      } else if(edge===2){ // bottom
        x = rand(0, WIDTH); y = HEIGHT + size; vx = rand(-1,1); vy = -1
      } else { // left
        x = -size; y = rand(0, HEIGHT); vx = 1; vy = rand(-1,1)
      }
      const mag = Math.hypot(vx,vy) || 1
      vx = (vx/mag) * speed
      vy = (vy/mag) * speed
      obstacles.push({x,y,size,vx,vy})
    }

    function update(dt){
      if(gameOver) return

      // input movement (keys stored lowercased)
      let dx = 0, dy = 0
      if(keys['arrowleft']||keys['a']) dx -= 1
      if(keys['arrowright']||keys['d']) dx += 1
      if(keys['arrowup']||keys['w']) dy -= 1
      if(keys['arrowdown']||keys['s']) dy += 1

      if(dx !== 0 || dy !== 0){
        const inv = 1/Math.hypot(dx||0.0001, dy||0.0001)
        player.x += (dx * inv) * player.speed * dt
        player.y += (dy * inv) * player.speed * dt
      }

      // clamp to bounds (square)
      const half = player.size/2
      player.x = clamp(player.x, half, WIDTH - half)
      player.y = clamp(player.y, half, HEIGHT - half)

      // difficulty factor (increases gradually)
      const speedFactor = 1 + elapsed * 0.02

      // obstacles move
      for(const ob of obstacles){
        ob.x += ob.vx * dt * speedFactor
        ob.y += ob.vy * dt * speedFactor
      }
      obstacles = obstacles.filter(o => o.x > -150 && o.x < WIDTH+150 && o.y > -150 && o.y < HEIGHT+150)

      // spawn logic
      spawnTimer -= dt
      if(spawnTimer <= 0){
        spawn()
        spawnTimer = getSpawnInterval()
      }

      // color cycling while holding z
      if(keys['z']){
        colorTimer += dt
        if(colorTimer >= colorInterval){
          colorTimer = 0
          cycleColor()
        }
      } else {
        colorTimer = 0
      }

      // collision detection: circle obstacle vs player square
      for(const ob of obstacles){
        const r = ob.size/2
        const rx = player.x - half
        const ry = player.y - half
        if(circleRectCollision(ob.x, ob.y, r, rx, ry, player.size, player.size)){
          gameOver = true
          break
        }
      }

      elapsed += dt
      score = Math.floor(elapsed)
    }

    function draw(){
      // background
      ctx.clearRect(0,0,WIDTH,HEIGHT)

      // subtle vignette
      ctx.fillStyle = '#07111a'
      ctx.fillRect(0,0,WIDTH,HEIGHT)

      // draw obstacles (circles with light outline)
      for(const ob of obstacles){
        ctx.fillStyle = '#9bd2ff'
        ctx.beginPath()
        ctx.arc(ob.x, ob.y, ob.size/2, 0, Math.PI*2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // draw player (square)
      ctx.fillStyle = player.color
      const s = player.size
      ctx.fillRect(player.x - s/2, player.y - s/2, s, s)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 2
      ctx.strokeRect(player.x - s/2, player.y - s/2, s, s)

      // HUD - pico8 style
      ctx.fillStyle = '#000000'
      ctx.globalAlpha = 0.6
      ctx.fillRect(8,8,140,26)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#8cffb2'
      ctx.font = '14px monospace'
      ctx.textAlign = 'left'
      ctx.fillText('SCORE: ' + score, 14, 26)

      // small controls hint
      ctx.fillStyle = '#bfe7ff'
      ctx.font = '11px monospace'
      ctx.fillText('MOVE: ARROWS / WASD   Z: HOLD COLOR   X: RESTART', 12, HEIGHT - 10)

      if(gameOver){
        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.fillRect(0, HEIGHT/2 - 36, WIDTH, 72)
        ctx.fillStyle = '#ffb3b3'
        ctx.font = '26px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', WIDTH/2, HEIGHT/2 - 6)
        ctx.font = '14px monospace'
        ctx.fillStyle = '#ffd3a6'
        ctx.fillText('Press X to restart', WIDTH/2, HEIGHT/2 + 20)
      }
    }

    function loop(now){
      const dt = Math.min(0.05, (now - last)/1000)
      last = now
      update(dt)
      draw()
      raf = requestAnimationFrame(loop)
    }

    function onKeyDown(e){
      const k = (e.key || '').toLowerCase()
      keys[k] = true
      if((k === 'x') && gameOver){
        reset()
      }
    }
    function onKeyUp(e){
      const k = (e.key || '').toLowerCase()
      keys[k] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // init
    reset()
    last = performance.now()
    raf = requestAnimationFrame(loop)

    return ()=>{
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }

  }, [])

  return (
    <div className="app">
      <div className="panel pico">
        <div className="hud">
          <div className="score">PICO-8 DEMO</div>
          <div className="hint">Move: Arrows / WASD · Hold Z: color · X: Restart</div>
        </div>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      </div>
    </div>
  )
}
