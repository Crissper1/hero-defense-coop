// Cliente del juego Hero Defense Coop
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let ws = null;
let myId = null;
let gameState = null;
let selectedClass = 'guerrero';

// Ajustar tamaño del canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Web Audio API simple para sonidos de combate
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type = 'sine', duration = 0.1) {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

// Selección de Héroe en el lobby
const classButtons = document.querySelectorAll('.class-btn');
classButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    classButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedClass = btn.dataset.class;
    
    // Cambiar iconos de habilidades
    if (selectedClass === 'guerrero') {
      document.getElementById('icon-q').innerText = '🌪️';
      document.getElementById('icon-w').innerText = '🛡️';
    } else if (selectedClass === 'mago') {
      document.getElementById('icon-q').innerText = '🔥';
      document.getElementById('icon-w').innerText = '❄️';
    } else if (selectedClass === 'tirador') {
      document.getElementById('icon-q').innerText = '🏹';
      document.getElementById('icon-w').innerText = '🎯';
    } else if (selectedClass === 'ingeniero') {
      document.getElementById('icon-q').innerText = '💚';
      document.getElementById('icon-w').innerText = '🏰';
    }
  });
});

// Entrar al juego
document.getElementById('btn-play').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Héroe';
  initConnection(name, selectedClass);
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('game-ui').classList.remove('hidden');
});

function initConnection(name, heroClass) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name, heroClass }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'init') {
      myId = data.playerId;
    } else if (data.type === 'state') {
      gameState = data.state;
      updateUI();
    }
  };
}

// Actualizar HUD
function updateUI() {
  if (!gameState) return;

  // Nexo HP
  const nx = gameState.nexus;
  const pct = Math.max(0, (nx.hp / nx.maxHp) * 100);
  document.getElementById('nexus-bar').style.width = `${pct}%`;
  document.getElementById('nexus-hp-text').innerText = `${Math.ceil(nx.hp)} / ${nx.maxHp}`;
  if (pct < 30) {
    document.getElementById('nexus-bar').style.background = '#e74c3c';
  }

  // Oleada
  document.getElementById('wave-num').innerText = gameState.wave;
  const statusEl = document.getElementById('wave-status');
  if (gameState.waveState === 'countdown') {
    statusEl.innerText = `Próxima en ${Math.ceil(gameState.waveTimer)}s`;
  } else if (gameState.waveState === 'active') {
    statusEl.innerText = `Enemigos: ${gameState.enemies.length}`;
  } else if (gameState.waveState === 'gameover') {
    statusEl.innerText = '¡BASE DESTRUIDA!';
  }

  // Oro
  document.getElementById('gold-amount').innerText = gameState.gold;

  // Cooldowns de mi héroe
  if (myId && gameState.players[myId]) {
    const me = gameState.players[myId];
    const qPct = me.cdQ > 0 ? (me.cdQ / 3) * 100 : 0;
    const wPct = me.cdW > 0 ? (me.cdW / 8) * 100 : 0;
    document.getElementById('cd-overlay-q').style.height = `${qPct}%`;
    document.getElementById('cd-overlay-w').style.height = `${wPct}%`;
  }
}

// Joystick virtual táctil
const joyZone = document.getElementById('joystick-zone');
const joyBase = document.getElementById('joystick-base');
const joyStick = document.getElementById('joystick-stick');
let touchTouchId = null;
let joyCenter = { x: 70, y: 70 };
let currentInput = { dx: 0, dy: 0 };

joyZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  touchTouchId = touch.identifier;
  handleJoystickMove(touch);
});

joyZone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === touchTouchId) {
      handleJoystickMove(e.changedTouches[i]);
      break;
    }
  }
});

function resetJoystick() {
  touchTouchId = null;
  joyStick.style.transform = `translate(0px, 0px)`;
  currentInput = { dx: 0, dy: 0 };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'move', dx: 0, dy: 0 }));
  }
}

joyZone.addEventListener('touchend', resetJoystick);
joyZone.addEventListener('touchcancel', resetJoystick);

function handleJoystickMove(touch) {
  const rect = joyBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const dx = touch.clientX - centerX;
  const dy = touch.clientY - centerY;
  const dist = Math.hypot(dx, dy);
  const maxRadius = rect.width / 2;

  const clampedDist = Math.min(dist, maxRadius);
  const angle = Math.atan2(dy, dx);
  const stickX = Math.cos(angle) * clampedDist;
  const stickY = Math.sin(angle) * clampedDist;

  joyStick.style.transform = `translate(${stickX}px, ${stickY}px)`;

  currentInput.dx = stickX / maxRadius;
  currentInput.dy = stickY / maxRadius;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'move', dx: currentInput.dx, dy: currentInput.dy }));
  }
}

// Botones de acción
function triggerAction(actionName) {
  if (!ws || !gameState || !gameState.players[myId]) return;
  const me = gameState.players[myId];
  playTone(actionName === 'q' ? 520 : 380, 'square', 0.12);

  // Apuntar en la dirección hacia donde mira o se mueve, o al frente
  const targetX = me.x + (currentInput.dx !== 0 ? currentInput.dx * 150 : 150);
  const targetY = me.y + (currentInput.dy !== 0 ? currentInput.dy * 150 : 0);

  ws.send(JSON.stringify({
    type: 'action',
    action: actionName,
    targetX,
    targetY
  }));
}

document.getElementById('btn-skill-q').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  triggerAction('q');
});

document.getElementById('btn-skill-w').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  triggerAction('w');
});

document.getElementById('btn-build').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (ws && ws.readyState === WebSocket.OPEN) {
    playTone(660, 'sine', 0.15);
    ws.send(JSON.stringify({ type: 'build_turret' }));
  }
});

// Soporte teclado PC (WASD + Q + E + B)
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  updateKeyboardMovement();
  if (e.key.toLowerCase() === 'q') triggerAction('q');
  if (e.key.toLowerCase() === 'w') triggerAction('w');
  if (e.key.toLowerCase() === 'b') {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'build_turret' }));
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  updateKeyboardMovement();
});

function updateKeyboardMovement() {
  let kx = 0;
  let ky = 0;
  if (keys['a'] || keys['arrowleft']) kx -= 1;
  if (keys['d'] || keys['arrowright']) kx += 1;
  if (keys['w'] || keys['arrowup']) ky -= 1;
  if (keys['s'] || keys['arrowdown']) ky += 1;

  if (touchTouchId === null) {
    currentInput.dx = kx;
    currentInput.dy = ky;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'move', dx: kx, dy: ky }));
    }
  }
}

// Render Loop
function render() {
  requestAnimationFrame(render);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!gameState) return;

  const me = myId ? gameState.players[myId] : null;
  // Cámara centrada en mi jugador (o en el Nexo si no he entrado)
  const cameraX = me ? me.x - canvas.width / 2 : gameState.nexus.x - canvas.width / 2;
  const cameraY = me ? me.y - canvas.height / 2 : gameState.nexus.y - canvas.height / 2;

  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  // Cuadrícula de terreno
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 1400; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1400);
    ctx.stroke();
  }
  for (let y = 0; y < 1400; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1400, y);
    ctx.stroke();
  }

  // Borde del mapa
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 1400, 1400);

  // Nexo / Ayuntamiento Central (Estilo Clash of Clans)
  const nx = gameState.nexus;
  ctx.fillStyle = '#2980b9';
  ctx.beginPath();
  ctx.arc(nx.x, nx.y, nx.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#f1c40f';
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏛️ AYUNTAMIENTO', nx.x, nx.y + 5);

  // Torretas
  gameState.turrets.forEach(t => {
    ctx.fillStyle = '#7f8c8d';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Rango sutil
    ctx.strokeStyle = 'rgba(243, 156, 18, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.fillText('🏰', t.x, t.y + 4);
  });

  // Proyectiles
  gameState.projectiles.forEach(p => {
    ctx.fillStyle = p.color || '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  // Enemigos (Súbditos / Orcos / Gigantes)
  gameState.enemies.forEach(e => {
    ctx.fillStyle = e.type === 'gigante' ? '#8e44ad' : (e.type === 'duende' ? '#27ae60' : '#d35400');
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Barra de vida enemiga
    const barW = e.radius * 2;
    const hpRatio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, barW, 4);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, barW * hpRatio, 4);
  });

  // Jugadores
  Object.values(gameState.players).forEach(p => {
    ctx.fillStyle = p.heroClass === 'guerrero' ? '#e74c3c' : (p.heroClass === 'mago' ? '#9b59b6' : (p.heroClass === 'tirador' ? '#2ecc71' : '#f39c12'));
    ctx.beginPath();
    ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = p.id === myId ? 3 : 2;
    ctx.strokeStyle = p.id === myId ? '#f1c40f' : '#ffffff';
    ctx.stroke();

    // Nombre y vida
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(p.name, p.x, p.y - 28);

    const hpW = 34;
    const hpRatio = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(p.x - hpW / 2, p.y - 24, hpW, 4);
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(p.x - hpW / 2, p.y - 24, hpW * hpRatio, 4);
  });

  ctx.restore();
}

render();
