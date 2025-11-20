import React, { useRef, useEffect, useState } from 'react'
import bgMusic from './assets/stay_safe.mp3'

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

    // background music: try to play on start, fall back to first user gesture if autoplay blocked
    const bgm = new Audio(bgMusic)
    bgm.loop = true
    let bgmPlayed = false
    function onFirstPlayGesture(){
      bgm.play().then(()=>{ bgmPlayed = true }).catch(()=>{})
      window.removeEventListener('keydown', onFirstPlayGesture)
      window.removeEventListener('pointerdown', onFirstPlayGesture)
    }
    function tryPlayBgm(){
      const p = bgm.play()
      if(p && typeof p.then === 'function'){
        p.then(()=>{ bgmPlayed = true }).catch(()=>{
          // wait for user gesture
          window.addEventListener('keydown', onFirstPlayGesture)
          window.addEventListener('pointerdown', onFirstPlayGesture)
        })
      }
    }

    let raf = null
    let last = performance.now()
    let spawnTimer = 0
    let elapsed = 0
    let score = 0
    let bonus = 0
    let gameOver = false
    // stamina / acceleration
    let stamina = 1 // 0..1
    const maxStamina = 1
    const staminaDrain = 0.7 // per second while boosting
    const staminaRecover = 0.28 // per second while not boosting
    const boostMultiplier = 3
    // player growth limits
    const maxPlayerSize = 64

    // richer, more 'pico' palette (neon/cool set)
    const colors = ['#FFCCAA', '#AB5236', '#07111a','#7E2553','#008751','#5F574F','#C2C3C7','#FFF1E8','#FF004D','#FFA300','#FFEC27','#00E436','#29ADFF','#83769C','#FF77A8']

    const player = {
      x: WIDTH/2,
      y: HEIGHT/2,
      size: 22, // square: width/height
      speed: 160, // px per sec
      currentSpeed: 160,
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
      particles = []
      popups = []
      spawnTimer = 0
      elapsed = 0
      score = 0
      bonus = 0
      gameOver = false
      colorTimer = 0
      // try to resume background music on restart
      tryPlayBgm()
    }

    let obstacles = []
    let particles = []
    let popups = []
    let aliens = []

    function getSpawnInterval(){
      // spawn faster as time increases
      const baseMin = Math.max(0.25, 0.9 - elapsed * 0.01)
      const baseMax = Math.max(0.45, 1.2 - elapsed * 0.01)
      return rand(baseMin, baseMax)
    }

    function spawn(){
      // pick a random point on the rectangle boundary (uniform on edges)
      const perim = 2*(WIDTH + HEIGHT)
      const t = rand(0, perim)
      let x, y
      if(t < WIDTH){
        // top edge
        x = t; y = -16
      } else if(t < WIDTH + HEIGHT){
        // right edge
        x = WIDTH + 16; y = t - WIDTH
      } else if(t < WIDTH + HEIGHT + WIDTH){
        // bottom edge
        x = t - (WIDTH + HEIGHT); y = HEIGHT + 16
      } else {
        // left edge
        x = -16; y = t - (2*WIDTH + HEIGHT)
      }
      // obstacle size and speed (kept reasonable)
      const size = Math.floor(rand(16, 48))
      const speed = rand(50, 180)
      // target is a random interior point (not too close to edges) so direction varies
      const tx = rand(WIDTH*0.15, WIDTH*0.85)
      const ty = rand(HEIGHT*0.15, HEIGHT*0.85)
      let vx = tx - x
      let vy = ty - y
      const mag = Math.hypot(vx,vy) || 1
      vx = (vx/mag) * speed
      vy = (vy/mag) * speed
      // pick a color for the obstacle from the palette (avoid very-dark base color)
      const col = colors[Math.floor(rand(0, colors.length))]
      obstacles.push({x,y,size,vx,vy, color: col})
    }

    function spawnAlien(px, py, psize, pcolor){
      // decorative dancing alien: disco-style, larger and neon-colored
      const size = psize || Math.floor(rand(28, 48))
      const x = (typeof px === 'number') ? px : rand(size + 8, WIDTH - size - 8)
      const y = (typeof py === 'number') ? py : rand(HEIGHT*0.25, HEIGHT*0.6)
      const life = rand(3.5, 6.0)
      const neon = ['#FF004D','#FFEC27','#29ADFF','#00E436','#FF77A8','#FFA300']
      const color = pcolor || neon[Math.floor(rand(0, neon.length))]
      // sparkle hue offset and rotation speed
      const spin = rand(-3.5, 3.5)
      aliens.push({x,y,size,life,phase: rand(0, Math.PI*2), color, spin})
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
        // determine if boosting (Shift) and there is stamina
        const boosting = (keys['shift']) && stamina > 0
        const targetSpeed = player.speed * (boosting ? boostMultiplier : 1)
        // smooth speed change toward target
        const accelFactor = 6
        player.currentSpeed += (targetSpeed - player.currentSpeed) * Math.min(1, accelFactor * dt)

        player.x += (dx * inv) * player.currentSpeed * dt
        player.y += (dy * inv) * player.currentSpeed * dt

        // drain stamina while boosting
        if(boosting){
          stamina -= staminaDrain * dt
          if(stamina < 0) stamina = 0
        }
      } else {
        // when not moving, slowly return speed to normal
        player.currentSpeed += (player.speed - player.currentSpeed) * Math.min(1, 6 * dt)
      }

      // recover stamina when not holding shift
      if(!(keys['shift'])){
        stamina += staminaRecover * dt
        if(stamina > maxStamina) stamina = maxStamina
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

      // update particles
      for(const p of particles){
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
      particles = particles.filter(p => p.life > 0)

      // update popups
      for(const pp of popups){
        pp.life -= dt
        pp.y -= 18 * dt
      }
      popups = popups.filter(pp => pp.life > 0)

      // spawn logic
      spawnTimer -= dt
      if(spawnTimer <= 0){
        spawn()
        spawnTimer = getSpawnInterval()
      }

      // Note: ambient alien spawn removed — aliens now appear when player collects same-color obstacles

      // update aliens animation and lifetime
      for(const a of aliens){
        a.life -= dt
        a.phase += dt * 6
        // slight bobbing
        a.y += Math.sin(a.phase) * 6 * dt
      }
      aliens = aliens.filter(a => a.life > 0)

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
      // iterate backwards so we can remove obstacles when awarding bonus
      for(let i = obstacles.length - 1; i >= 0; i--){
        const ob = obstacles[i]
        const r = ob.size/2
        const rx = player.x - half
        const ry = player.y - half
        if(circleRectCollision(ob.x, ob.y, r, rx, ry, player.size, player.size)){
          // if obstacle color matches player color, award bonus and remove obstacle + spawn effect
            if(ob.color && ob.color === player.color){
            bonus += 5
            // spawn particles
            for(let k=0;k<10;k++){
              const ang = Math.random() * Math.PI * 2
              const sp = Math.random() * 120 + 40
              particles.push({
                x: ob.x,
                y: ob.y,
                vx: Math.cos(ang) * sp,
                vy: Math.sin(ang) * sp,
                life: 0.5 + Math.random() * 0.5,
                color: ob.color
              })
            }
            // grow player a bit based on obstacle size (but cap)
            const growth = Math.max(2, Math.floor(ob.size / 8))
            player.size = Math.min(maxPlayerSize, player.size + growth)
            // popup text
            popups.push({x: ob.x, y: ob.y, life: 0.9, text: '+5', color: ob.color})
            // spawn a disco alien at the collection point for a celebratory dance
            spawnAlien(ob.x, ob.y, Math.min(48, Math.floor(ob.size * 1.2)), ob.color)
            obstacles.splice(i, 1)
            continue
          }
          // otherwise it's a hit -> game over
          gameOver = true
          try{ bgm.pause() }catch(e){}
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
      ctx.fillStyle = '#1D2B53' //07111a
      ctx.fillRect(0,0,WIDTH,HEIGHT)

      // draw obstacles (circles) with pulsing border for safe (same-color) ones
      // draw decorative dancing aliens (background)
      for(const a of aliens){
        ctx.save()
        // disco spotlight (radial gradient) beneath the alien
        const grd = ctx.createRadialGradient(a.x, a.y + a.size*0.6, 4, a.x, a.y + a.size*0.6, a.size*2.2)
        grd.addColorStop(0, 'rgba(255,255,255,0.22)')
        grd.addColorStop(0.25, 'rgba(255,255,255,0.08)')
        grd.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 0.9 * Math.min(1, a.life / 4 + 0.2)
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.ellipse(a.x, a.y + a.size*0.6, a.size*1.8, a.size*0.7, 0, 0, Math.PI*2)
        ctx.fill()

        // disco body: rotate slightly with spin and pulse
        const pulse = 1 + Math.sin(a.phase * 3 + elapsed * 6) * 0.12
        ctx.translate(a.x, a.y)
        ctx.rotate(a.phase * 0.6 + (a.spin || 0) * elapsed * 0.12)

        // flashing neon fill that cycles through a few hues
        const flash = Math.floor((Math.abs(Math.sin(a.phase * 2 + elapsed * 4)) * 3))
        const neonPalette = ['#FF004D','#FFEC27','#29ADFF','#00E436','#FF77A8']
        const fillCol = neonPalette[flash % neonPalette.length]
        ctx.fillStyle = fillCol
        ctx.beginPath()
        ctx.ellipse(0, 0, a.size * 1.05 * pulse, a.size * 0.55 * pulse, 0, 0, Math.PI*2)
        ctx.fill()

        // clear dome (lighter top)
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.ellipse(0, -a.size * 0.22, a.size * 0.5 * pulse, a.size * 0.28 * pulse, 0, 0, Math.PI*2)
        ctx.fill()

        // disco rim lights (bigger and brighter)
        const lights = Math.max(5, Math.floor(a.size / 3))
        for(let i=0;i<lights;i++){
          const ang = (i / lights) * Math.PI * 2 + a.phase * 1.8
          const lx = Math.cos(ang) * (a.size * 0.95 * pulse)
          const ly = Math.sin(ang) * (a.size * 0.42 * pulse)
          const lpulse = 0.6 + Math.abs(Math.sin(a.phase * 3 + i)) * 0.8
          ctx.beginPath()
          ctx.fillStyle = neonPalette[(i + Math.floor(elapsed)) % neonPalette.length]
          ctx.globalAlpha = Math.min(1, 0.9 * lpulse * (a.life / 4 + 0.3))
          ctx.arc(lx, ly, 2.6 * (a.size/32) * lpulse, 0, Math.PI*2)
          ctx.fill()
        }

        // little sparkles around the alien for extra disco flare
        ctx.globalAlpha = Math.min(1, 0.9 * (a.life / 4 + 0.2))
        for(let s=0;s<4;s++){
          const ang = Math.random() * Math.PI * 2
          const r = a.size * (0.9 + Math.random() * 0.8)
          ctx.fillStyle = neonPalette[Math.floor(Math.random() * neonPalette.length)]
          ctx.beginPath()
          ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, Math.random() * 2.6, 0, Math.PI*2)
          ctx.fill()
        }

        ctx.globalAlpha = 1
        ctx.restore()
      }
      for(const ob of obstacles){
        const isSafe = ob.color && ob.color === player.color
        // base circle
        ctx.fillStyle = ob.color || '#9bd2ff'
        ctx.beginPath()
        ctx.arc(ob.x, ob.y, ob.size/2, 0, Math.PI*2)
        ctx.fill()
        // stroke / pulsing border if safe
        if(isSafe){
          const pulse = 1 + Math.sin(elapsed * 18 + ob.x * 0.1) * 0.6
          // make outer border wider and slightly larger so it's more obvious
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'
          ctx.lineWidth = 3.5 * pulse
          ctx.beginPath()
          ctx.arc(ob.x, ob.y, ob.size/2 + 3 + pulse*2.0, 0, Math.PI*2)
          ctx.stroke()
          // inner colored shimmer
          ctx.strokeStyle = ob.color
          ctx.globalAlpha = 0.95
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.arc(ob.x, ob.y, ob.size/2 + 1.6, 0, Math.PI*2)
          ctx.stroke()
          ctx.globalAlpha = 1
        } else {
          ctx.strokeStyle = 'rgba(0,0,0,0.28)'
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }

      // draw particles
      for(const p of particles){
        const t = Math.max(0, p.life)
        const a = Math.min(1, t / 0.6)
        ctx.globalAlpha = a
        ctx.fillStyle = p.color || '#fff'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI*2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // draw popups
      for(const pp of popups){
        ctx.globalAlpha = Math.min(1, pp.life / 0.9)
        ctx.fillStyle = pp.color || '#fff'
        ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(pp.text, pp.x, pp.y)
        ctx.globalAlpha = 1
      }

      // draw player (square) with pulsing/bling border
      const s = player.size
      // pulse factor based on elapsed time to give a bling effect
        const pulse = 1 + Math.sin(elapsed * 14 + player.x * 0.12) * 0.6
        ctx.save()
        // outer glow ellipse
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = 4 * pulse
        ctx.beginPath()
        ctx.ellipse(player.x, player.y, s * 1.4 + pulse * 2.6, s * 0.7 + pulse * 1.2, 0, 0, Math.PI * 2)
        ctx.stroke()

        // inner colored rim shimmer
        ctx.strokeStyle = player.color
        ctx.lineWidth = 1.6
        ctx.globalAlpha = 0.95
        ctx.beginPath()
        ctx.ellipse(player.x, player.y, s * 1.05, s * 0.55, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1

        // saucer body: use player's color for better visibility, with subtle highlight overlay
        ctx.fillStyle = player.color
        ctx.beginPath()
        ctx.ellipse(player.x, player.y, s, s * 0.45, 0, 0, Math.PI * 2)
        ctx.fill()
        // add a soft highlight gradient on top for a metallic feel
        const hg = ctx.createLinearGradient(player.x - s, player.y - s*0.2, player.x + s, player.y + s*0.2)
        hg.addColorStop(0, 'rgba(255,255,255,0.28)')
        hg.addColorStop(0.5, 'rgba(255,255,255,0.06)')
        hg.addColorStop(1, 'rgba(0,0,0,0.08)')
        ctx.globalAlpha = 0.36
        ctx.fillStyle = hg
        ctx.beginPath()
        ctx.ellipse(player.x, player.y - s*0.04, s, s * 0.45, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1

        // dome on top
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.beginPath()
        ctx.ellipse(player.x, player.y - s * 0.18, s * 0.42, s * 0.24, 0, 0, Math.PI * 2)
        ctx.fill()

        // lights along rim
        const lights = Math.max(4, Math.floor(s / 4))
        for(let i=0;i<lights;i++){
          const ang = (i / lights) * Math.PI * 2 + elapsed * 1.6
          const lx = player.x + Math.cos(ang) * (s * 0.9)
          const ly = player.y + Math.sin(ang) * (s * 0.38)
          const lpulse = 0.9 + Math.sin(elapsed * 8 + i) * 0.3
          ctx.beginPath()
          ctx.fillStyle = (i % 2 === 0) ? '#ffec27' : '#29adff'
          ctx.globalAlpha = 0.9 * lpulse
          ctx.arc(lx, ly, 2.2 * (s/22) * lpulse, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }

        // subtle shadow under the saucer
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.beginPath()
        ctx.ellipse(player.x, player.y + s * 0.62, s * 0.9, s * 0.25, 0, 0, Math.PI * 2)
        ctx.fill()

        ctx.restore()

      // HUD - pico8 style
      ctx.fillStyle = '#000000'
      ctx.globalAlpha = 0.6
      ctx.fillRect(8,8,140,26)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#8cffb2'
      ctx.font = '14px monospace'
      ctx.textAlign = 'left'
      const total = Math.floor(elapsed) + bonus
      ctx.fillText('SCORE: ' + total, 14, 26)

      // draw small color indicator for player current color
      ctx.fillStyle = player.color
      ctx.fillRect(110, 10, 18, 18)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeRect(110, 10, 18, 18)

      // draw stamina bar (right of HUD)
      const barX = 140
      const barY = 11
      const barW = 320
      const barH = 14
      // background
      ctx.fillStyle = '#000'
      ctx.globalAlpha = 0.55
      ctx.fillRect(barX, barY, barW, barH)
      ctx.globalAlpha = 1
      // fill based on stamina
      ctx.fillStyle = stamina > 0.5 ? '#00e436' : (stamina > 0.15 ? '#ffec27' : '#ff4d4d')
      ctx.fillRect(barX + 2, barY + 2, Math.max(2, (barW - 4) * (stamina / maxStamina)), barH - 4)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.strokeRect(barX, barY, barW, barH)

      // small controls hint
      ctx.fillStyle = '#bfe7ff'
      ctx.font = '11px monospace'
      ctx.fillText('MOVE: ARROWS / WASD   Z: HOLD COLOR   X: RESTART   SHIFT: BOOST', 12, HEIGHT - 10)

      if(gameOver){
        // Pico-8-like modal: dark panel with bright border and colored text
        ctx.fillStyle = '#031017'
        ctx.fillRect(WIDTH/2 - 140, HEIGHT/2 - 40, 280, 80)
        ctx.strokeStyle = '#00e436'
        ctx.lineWidth = 3
        ctx.strokeRect(WIDTH/2 - 140, HEIGHT/2 - 40, 280, 80)

        ctx.fillStyle = '#ff77a8'
        ctx.font = '26px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', WIDTH/2, HEIGHT/2 - 6)

        ctx.font = '12px monospace'
        ctx.fillStyle = '#bfe7ff'
        ctx.fillText('Press X to restart', WIDTH/2, HEIGHT/2 + 18)
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
    tryPlayBgm()
    last = performance.now()
    raf = requestAnimationFrame(loop)

    return ()=>{
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // stop bgm and cleanup listeners
      try{ bgm.pause(); bgm.currentTime = 0 }catch(e){}
      window.removeEventListener('keydown', onFirstPlayGesture)
      window.removeEventListener('pointerdown', onFirstPlayGesture)
    }

  }, [])
  //IT IS BIG MESS, BECAUSE THE LIGHTS WENT OUT
  return (
    <div className="app">
      <div className="panel pico">
        <div className="hud">
          <div className="score"> SWARM ESCAPE </div>
          <div className="hint"> Color aligns,
            Safety shines.
            Growth takes hold,
            A story untold. </div> 
        </div>
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      </div>
    </div>
  )
}
