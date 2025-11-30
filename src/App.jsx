import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const ARENA_SIZE = 800
const PLAYER_SIZE = 30
const INITIAL_PLAYER_POS = { x: ARENA_SIZE / 2, y: ARENA_SIZE / 2 }
const PLAYER_SPEED = 5
const DIFFICULTY_INTERVAL = 15000 // 15 seconds

// Difficulty mode configurations
const DIFFICULTY_MODES = {
  easy: {
    name: 'EASY',
    spawnInterval: 3000,
    speedMultiplier: 0.7,
    attackCountMultiplier: 0.7,
    slashWarningTime: 800,
    color: '#00ff00'
  },
  normal: {
    name: 'NORMAL',
    spawnInterval: 2000,
    speedMultiplier: 1,
    attackCountMultiplier: 1,
    slashWarningTime: 600,
    color: '#ffff00'
  },
  hard: {
    name: 'HARD',
    spawnInterval: 1500,
    speedMultiplier: 1.3,
    attackCountMultiplier: 1.3,
    slashWarningTime: 400,
    color: '#ff0000'
  },
  insane: {
    name: 'INSANE',
    spawnInterval: 1000,
    speedMultiplier: 1.6,
    attackCountMultiplier: 1.5,
    slashWarningTime: 300,
    color: '#ff00ff'
  }
}

function App() {
  const [gameState, setGameState] = useState('menu') // 'menu', 'playing', 'gameover'
  const [difficultyMode, setDifficultyMode] = useState('normal')
  const [player, setPlayer] = useState(INITIAL_PLAYER_POS)
  const [attacks, setAttacks] = useState([])
  const [particles, setParticles] = useState([])
  const [score, setScore] = useState(0)
  const [highScores, setHighScores] = useState(() => {
    const saved = localStorage.getItem('dodgeArenaHighScores')
    return saved ? JSON.parse(saved) : { easy: 0, normal: 0, hard: 0, insane: 0 }
  })
  const [difficultyLevel, setDifficultyLevel] = useState(1)
  
  const keysPressed = useRef({})
  const gameStartTime = useRef(0)
  const lastAttackTime = useRef(0)
  const lastSlashPositions = useRef([])
  const animationFrame = useRef(null)
  const canvasRef = useRef(null)

  // Audio context for sound effects
  const audioContext = useRef(null)

  const playSound = useCallback((frequency, duration, type = 'sine') => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = audioContext.current
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()
    
    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)
    
    oscillator.type = type
    oscillator.frequency.value = frequency
    
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration)
    
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration)
  }, [])

  const createParticles = useCallback((x, y, count, color) => {
    const newParticles = []
    for (let i = 0; i < count; i++) {
      newParticles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 1,
        color,
        size: Math.random() * 4 + 2
      })
    }
    setParticles(prev => [...prev, ...newParticles])
  }, [])

  // Create different attack types
  const createSlashWave = useCallback((level, mode) => {
    const types = ['horizontal', 'vertical', 'diagonal-right', 'diagonal-left']
    const modeConfig = DIFFICULTY_MODES[mode]
    
    // Try to avoid overlapping with recent slashes
    let type, position, attempts = 0
    let tooClose = true
    
    while (tooClose && attempts < 10) {
      type = types[Math.floor(Math.random() * types.length)]
      position = Math.random() * ARENA_SIZE
      
      // Check if this position is too close to recent slashes of same type
      tooClose = lastSlashPositions.current.some(last => 
        last.type === type && Math.abs(last.position - position) < 150
      )
      attempts++
    }
    
    // Store this position
    lastSlashPositions.current.push({ type, position, time: Date.now() })
    if (lastSlashPositions.current.length > 5) {
      lastSlashPositions.current.shift()
    }
    
    const speed = (3 + level * 0.5) * modeConfig.speedMultiplier
    
    let attack = {
      id: Date.now() + Math.random(),
      type: 'slash',
      slashType: type,
      speed,
      thickness: 40,
      color: `hsl(${180 + Math.random() * 60}, 100%, 50%)`,
      glow: true,
      warning: true,
      warningTime: modeConfig.slashWarningTime,
      createdAt: Date.now()
    }

    if (type === 'horizontal') {
      attack.x = 0
      attack.y = position
      attack.width = ARENA_SIZE
      attack.height = attack.thickness
      attack.vx = 0
      attack.vy = 0
      attack.activeVx = speed
      attack.activeVy = 0
    } else if (type === 'vertical') {
      attack.x = position
      attack.y = 0
      attack.width = attack.thickness
      attack.height = ARENA_SIZE
      attack.vx = 0
      attack.vy = 0
      attack.activeVx = 0
      attack.activeVy = speed
    } else if (type === 'diagonal-right') {
      attack.x = -100
      attack.y = -100
      attack.width = ARENA_SIZE * 1.5
      attack.height = attack.thickness
      attack.rotation = 45
      attack.vx = 0
      attack.vy = 0
      attack.activeVx = speed * 0.7
      attack.activeVy = speed * 0.7
    } else {
      attack.x = ARENA_SIZE + 100
      attack.y = -100
      attack.width = ARENA_SIZE * 1.5
      attack.height = attack.thickness
      attack.rotation = -45
      attack.vx = 0
      attack.vy = 0
      attack.activeVx = -speed * 0.7
      attack.activeVy = speed * 0.7
    }

    playSound(200, 0.3, 'sawtooth')
    return attack
  }, [playSound])

  const createBigProjectile = useCallback((level, mode) => {
    const modeConfig = DIFFICULTY_MODES[mode]
    const side = Math.floor(Math.random() * 4)
    const size = 40 + level * 5
    const speed = (2 + level * 0.3) * modeConfig.speedMultiplier
    
    let x, y, vx, vy
    
    if (side === 0) { // top
      x = Math.random() * ARENA_SIZE
      y = -size
      vx = (Math.random() - 0.5) * 2
      vy = speed
    } else if (side === 1) { // right
      x = ARENA_SIZE + size
      y = Math.random() * ARENA_SIZE
      vx = -speed
      vy = (Math.random() - 0.5) * 2
    } else if (side === 2) { // bottom
      x = Math.random() * ARENA_SIZE
      y = ARENA_SIZE + size
      vx = (Math.random() - 0.5) * 2
      vy = -speed
    } else { // left
      x = -size
      y = Math.random() * ARENA_SIZE
      vx = speed
      vy = (Math.random() - 0.5) * 2
    }

    playSound(150, 0.2, 'triangle')
    
    return {
      id: Date.now() + Math.random(),
      type: 'bigProjectile',
      x, y, vx, vy,
      size,
      color: `hsl(${300 + Math.random() * 60}, 100%, 50%)`,
      glow: true
    }
  }, [playSound])

  const createHomingProjectile = useCallback((level, playerPos, mode) => {
    const modeConfig = DIFFICULTY_MODES[mode]
    const side = Math.floor(Math.random() * 4)
    const size = 15
    
    let x, y
    
    if (side === 0) { // top
      x = Math.random() * ARENA_SIZE
      y = -size
    } else if (side === 1) { // right
      x = ARENA_SIZE + size
      y = Math.random() * ARENA_SIZE
    } else if (side === 2) { // bottom
      x = Math.random() * ARENA_SIZE
      y = ARENA_SIZE + size
    } else { // left
      x = -size
      y = Math.random() * ARENA_SIZE
    }

    const angle = Math.atan2(playerPos.y - y, playerPos.x - x)
    const speed = (3 + level * 0.4) * modeConfig.speedMultiplier
    
    playSound(400, 0.15, 'square')
    
    return {
      id: Date.now() + Math.random(),
      type: 'homing',
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      color: '#ffff00',
      glow: true,
      trail: []
    }
  }, [playSound])

  const createAreaTrap = useCallback((level) => {
    const size = 80
    const x = Math.random() * (ARENA_SIZE - size)
    const y = Math.random() * (ARENA_SIZE - size)
    
    return {
      id: Date.now() + Math.random(),
      type: 'trap',
      x, y,
      size,
      warningTime: 1500 - level * 50,
      createdAt: Date.now(),
      color: '#ff00ff',
      active: false
    }
  }, [])

  const spawnAttacks = useCallback((level, playerPos, mode) => {
    const modeConfig = DIFFICULTY_MODES[mode]
    const newAttacks = []
    const baseCount = 1 + Math.floor(level / 3)
    const attackCount = Math.max(1, Math.floor(baseCount * modeConfig.attackCountMultiplier))
    
    for (let i = 0; i < attackCount; i++) {
      const rand = Math.random()
      
      if (rand < 0.3) {
        newAttacks.push(createSlashWave(level, mode))
      } else if (rand < 0.5) {
        newAttacks.push(createBigProjectile(level, mode))
      } else if (rand < 0.7) {
        newAttacks.push(createHomingProjectile(level, playerPos, mode))
      } else {
        newAttacks.push(createAreaTrap(level))
      }
    }
    
    setAttacks(prev => [...prev, ...newAttacks])
  }, [createSlashWave, createBigProjectile, createHomingProjectile, createAreaTrap])

  const checkCollision = useCallback((player, attack) => {
    const px = player.x
    const py = player.y
    const ps = PLAYER_SIZE / 2

    if (attack.type === 'slash') {
      // Don't collide during warning phase
      if (attack.warning) return false
      
      const buffer = 5
      if (attack.slashType === 'horizontal' || attack.slashType === 'vertical') {
        return px + ps > attack.x - buffer && px - ps < attack.x + attack.width + buffer &&
               py + ps > attack.y - buffer && py - ps < attack.y + attack.height + buffer
      } else {
        // Simplified diagonal collision
        const centerX = attack.x + attack.width / 2
        const centerY = attack.y + attack.height / 2
        const dist = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2)
        return dist < attack.thickness
      }
    } else if (attack.type === 'bigProjectile' || attack.type === 'homing') {
      const dist = Math.sqrt((px - attack.x) ** 2 + (py - attack.y) ** 2)
      return dist < (ps + attack.size / 2)
    } else if (attack.type === 'trap' && attack.active) {
      return px + ps > attack.x && px - ps < attack.x + attack.size &&
             py + ps > attack.y && py - ps < attack.y + attack.size
    }
    
    return false
  }, [])

  const startGame = useCallback((mode) => {
    setGameState('playing')
    setDifficultyMode(mode)
    setPlayer(INITIAL_PLAYER_POS)
    setAttacks([])
    setParticles([])
    setScore(0)
    setDifficultyLevel(1)
    lastSlashPositions.current = []
    gameStartTime.current = Date.now()
    lastAttackTime.current = Date.now()
  }, [])

  const endGame = useCallback(() => {
    setGameState('gameover')
    playSound(100, 0.5, 'sawtooth')
    
    if (score > highScores[difficultyMode]) {
      const newHighScores = { ...highScores, [difficultyMode]: score }
      setHighScores(newHighScores)
      localStorage.setItem('dodgeArenaHighScores', JSON.stringify(newHighScores))
    }
    
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current)
    }
  }, [score, highScores, difficultyMode, playSound])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      keysPressed.current[e.key.toLowerCase()] = true
    }
    
    const handleKeyUp = (e) => {
      keysPressed.current[e.key.toLowerCase()] = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return

    const gameLoop = () => {
      const now = Date.now()
      const elapsed = now - gameStartTime.current
      const newScore = Math.floor(elapsed / 1000)
      setScore(newScore)

      // Update difficulty
      const newLevel = Math.floor(elapsed / DIFFICULTY_INTERVAL) + 1
      setDifficultyLevel(newLevel)

      // Move player
      setPlayer(prev => {
        let newX = prev.x
        let newY = prev.y

        if (keysPressed.current['arrowleft'] || keysPressed.current['a']) newX -= PLAYER_SPEED
        if (keysPressed.current['arrowright'] || keysPressed.current['d']) newX += PLAYER_SPEED
        if (keysPressed.current['arrowup'] || keysPressed.current['w']) newY -= PLAYER_SPEED
        if (keysPressed.current['arrowdown'] || keysPressed.current['s']) newY += PLAYER_SPEED

        newX = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_SIZE - PLAYER_SIZE / 2, newX))
        newY = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_SIZE - PLAYER_SIZE / 2, newY))

        return { x: newX, y: newY }
      })

      // Spawn attacks
      const modeConfig = DIFFICULTY_MODES[difficultyMode]
      const spawnInterval = Math.max(modeConfig.spawnInterval - newLevel * 100, 800)
      if (now - lastAttackTime.current > spawnInterval) {
        spawnAttacks(newLevel, player, difficultyMode)
        lastAttackTime.current = now
      }

      // Update attacks
      setAttacks(prev => {
        const updated = prev.map(attack => {
          if (attack.type === 'trap') {
            if (!attack.active && now - attack.createdAt > attack.warningTime) {
              playSound(600, 0.1, 'square')
              return { ...attack, active: true, activatedAt: now }
            }
            if (attack.active && now - attack.activatedAt > 500) {
              return null // Remove after explosion
            }
          } else if (attack.type === 'slash') {
            const newAttack = { ...attack }
            
            // Transition from warning to active
            if (attack.warning && now - attack.createdAt > attack.warningTime) {
              newAttack.warning = false
              newAttack.vx = attack.activeVx
              newAttack.vy = attack.activeVy
              playSound(250, 0.2, 'sawtooth')
            }
            
            newAttack.x += newAttack.vx
            newAttack.y += newAttack.vy
            
            return newAttack
          } else {
            const newAttack = { ...attack }
            newAttack.x += attack.vx
            newAttack.y += attack.vy
            
            if (attack.type === 'homing') {
              newAttack.trail = [...(attack.trail || []), { x: attack.x, y: attack.y }]
              if (newAttack.trail.length > 10) newAttack.trail.shift()
            }
            
            return newAttack
          }
          
          return attack
        }).filter(attack => {
          if (!attack) return false
          if (attack.type === 'trap') return true
          
          return attack.x > -200 && attack.x < ARENA_SIZE + 200 &&
                 attack.y > -200 && attack.y < ARENA_SIZE + 200
        })

        return updated
      })

      // Update particles
      setParticles(prev => {
        return prev.map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: p.life - 0.02,
          vy: p.vy + 0.2
        })).filter(p => p.life > 0)
      })

      // Check collisions
      for (const attack of attacks) {
        if (checkCollision(player, attack)) {
          createParticles(player.x, player.y, 30, '#ff00ff')
          endGame()
          return
        }
      }

      animationFrame.current = requestAnimationFrame(gameLoop)
    }

    animationFrame.current = requestAnimationFrame(gameLoop)

    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current)
      }
    }
  }, [gameState, player, attacks, difficultyMode, spawnAttacks, checkCollision, endGame, createParticles, playSound])

  // Render game
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, ARENA_SIZE, ARENA_SIZE)

    if (gameState === 'playing') {
      // Draw attacks
      attacks.forEach(attack => {
        ctx.save()
        
        if (attack.glow) {
          ctx.shadowBlur = 20
          ctx.shadowColor = attack.color
        }

        if (attack.type === 'slash') {
          // Warning phase - show as outline
          if (attack.warning) {
            ctx.strokeStyle = attack.color
            ctx.lineWidth = 4
            ctx.setLineDash([10, 10])
            ctx.globalAlpha = 0.6
            if (attack.rotation) {
              ctx.translate(attack.x, attack.y)
              ctx.rotate(attack.rotation * Math.PI / 180)
              ctx.strokeRect(-attack.width / 2, -attack.height / 2, attack.width, attack.height)
            } else {
              ctx.strokeRect(attack.x, attack.y, attack.width, attack.height)
            }
            ctx.setLineDash([])
            ctx.globalAlpha = 1
          } else {
            // Active phase - show as solid
            ctx.fillStyle = attack.color
            if (attack.rotation) {
              ctx.translate(attack.x, attack.y)
              ctx.rotate(attack.rotation * Math.PI / 180)
              ctx.fillRect(-attack.width / 2, -attack.height / 2, attack.width, attack.height)
            } else {
              ctx.fillRect(attack.x, attack.y, attack.width, attack.height)
            }
          }
        } else if (attack.type === 'bigProjectile') {
          ctx.fillStyle = attack.color
          ctx.beginPath()
          ctx.arc(attack.x, attack.y, attack.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else if (attack.type === 'homing') {
          // Draw trail
          if (attack.trail && attack.trail.length > 0) {
            ctx.strokeStyle = attack.color + '44'
            ctx.lineWidth = attack.size / 2
            ctx.beginPath()
            ctx.moveTo(attack.trail[0].x, attack.trail[0].y)
            attack.trail.forEach(pos => ctx.lineTo(pos.x, pos.y))
            ctx.stroke()
          }
          
          ctx.fillStyle = attack.color
          ctx.beginPath()
          ctx.arc(attack.x, attack.y, attack.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else if (attack.type === 'trap') {
          if (attack.active) {
            ctx.fillStyle = attack.color
            ctx.fillRect(attack.x, attack.y, attack.size, attack.size)
          } else {
            ctx.strokeStyle = attack.color + '88'
            ctx.lineWidth = 3
            ctx.strokeRect(attack.x, attack.y, attack.size, attack.size)
          }
        }
        
        ctx.restore()
      })

      // Draw particles
      particles.forEach(p => {
        ctx.save()
        ctx.globalAlpha = p.life
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })

      // Draw player
      ctx.save()
      ctx.shadowBlur = 25
      ctx.shadowColor = '#00ffff'
      ctx.fillStyle = '#00ffff'
      ctx.translate(player.x, player.y)
      ctx.beginPath()
      ctx.moveTo(0, -PLAYER_SIZE / 2)
      ctx.lineTo(PLAYER_SIZE / 2, PLAYER_SIZE / 2)
      ctx.lineTo(-PLAYER_SIZE / 2, PLAYER_SIZE / 2)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }, [gameState, player, attacks, particles])

  return (
    <div className="app">
      <div className="crt-overlay" />
      
      {gameState === 'menu' && (
        <div className="menu">
          <h1 className="title">DODGE ARENA</h1>
          <p className="subtitle">Survive the neon onslaught</p>
          <div className="difficulty-selector">
            {Object.entries(DIFFICULTY_MODES).map(([key, config]) => (
              <button 
                key={key}
                className={`difficulty-button ${difficultyMode === key ? 'selected' : ''}`}
                style={{ borderColor: config.color, color: config.color }}
                onClick={() => setDifficultyMode(key)}
              >
                {config.name}
              </button>
            ))}
          </div>
          <button className="neon-button" onClick={() => startGame(difficultyMode)}>START GAME</button>
          <div className="high-scores">
            <div className="high-score-title">HIGH SCORES</div>
            {Object.entries(DIFFICULTY_MODES).map(([key, config]) => (
              <div key={key} className="high-score-item" style={{ color: config.color }}>
                {config.name}: {highScores[key]}s
              </div>
            ))}
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="game-container">
          <div className="hud">
            <div className="score">TIME: {score}s</div>
            <div className="level">LEVEL: {difficultyLevel}</div>
          </div>
          <canvas 
            ref={canvasRef} 
            width={ARENA_SIZE} 
            height={ARENA_SIZE}
            className="arena"
          />
          <div className="controls">WASD / ARROW KEYS TO MOVE</div>
        </div>
      )}

      {gameState === 'gameover' && (
        <div className="menu">
          <h1 className="title game-over">GAME OVER</h1>
          <div className="difficulty-badge" style={{ 
            color: DIFFICULTY_MODES[difficultyMode].color,
            textShadow: `0 0 10px ${DIFFICULTY_MODES[difficultyMode].color}`
          }}>
            {DIFFICULTY_MODES[difficultyMode].name} MODE
          </div>
          <div className="final-score">SURVIVED: {score}s</div>
          <div className="high-score" style={{ color: DIFFICULTY_MODES[difficultyMode].color }}>
            BEST: {highScores[difficultyMode]}s
          </div>
          <button className="neon-button" onClick={() => startGame(difficultyMode)}>PLAY AGAIN</button>
          <button className="secondary-button" onClick={() => setGameState('menu')}>MAIN MENU</button>
        </div>
      )}
    </div>
   
  )
}


export default App
