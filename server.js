const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Estado del juego
const MAP_SIZE = { width: 1400, height: 1400 };

const gameState = {
  nexus: {
    x: MAP_SIZE.width / 2,
    y: MAP_SIZE.height / 2,
    radius: 48,
    hp: 1000,
    maxHp: 1000
  },
  players: {},
  enemies: [],
  projectiles: [],
  turrets: [],
  gold: 100,
  wave: 1,
  waveState: 'countdown', // countdown, active, victory, gameover
  waveTimer: 5,
  enemiesRemainingInWave: 0
};

const HERO_CLASSES = {
  guerrero: {
    name: 'Guerrero',
    color: '#e74c3c',
    radius: 20,
    speed: 4.5,
    maxHp: 320,
    cooldowns: { q: 2.5, w: 6 }
  },
  mago: {
    name: 'Mago',
    color: '#9b59b6',
    radius: 18,
    speed: 4.0,
    maxHp: 160,
    cooldowns: { q: 1.5, w: 8 }
  },
  tirador: {
    name: 'Tirador',
    color: '#2ecc71',
    radius: 17,
    speed: 4.8,
    maxHp: 180,
    cooldowns: { q: 0.8, w: 5 }
  },
  ingeniero: {
    name: 'Ingeniero',
    color: '#f39c12',
    radius: 19,
    speed: 4.2,
    maxHp: 220,
    cooldowns: { q: 3.0, w: 10 }
  }
};

let nextId = 1;

function spawnWave(waveNum) {
  gameState.waveState = 'active';
  const totalEnemies = 8 + waveNum * 5;
  gameState.enemiesRemainingInWave = totalEnemies;

  let spawned = 0;
  const spawnInterval = setInterval(() => {
    if (spawned >= totalEnemies || gameState.waveState !== 'active') {
      clearInterval(spawnInterval);
      return;
    }

    // Spawn en bordes del mapa
    const side = Math.floor(Math.random() * 4);
    let x = 0, y = 0;
    if (side === 0) { x = Math.random() * MAP_SIZE.width; y = 20; }
    else if (side === 1) { x = MAP_SIZE.width - 20; y = Math.random() * MAP_SIZE.height; }
    else if (side === 2) { x = Math.random() * MAP_SIZE.width; y = MAP_SIZE.height - 20; }
    else { x = 20; y = Math.random() * MAP_SIZE.height; }

    const isGiant = waveNum >= 2 && Math.random() < 0.2;
    const isFast = !isGiant && Math.random() < 0.35;

    gameState.enemies.push({
      id: nextId++,
      x,
      y,
      type: isGiant ? 'gigante' : (isFast ? 'duende' : 'orco'),
      radius: isGiant ? 26 : (isFast ? 14 : 18),
      hp: isGiant ? 250 + waveNum * 50 : (isFast ? 35 + waveNum * 10 : 70 + waveNum * 20),
      maxHp: isGiant ? 250 + waveNum * 50 : (isFast ? 35 + waveNum * 10 : 70 + waveNum * 20),
      speed: isGiant ? 1.4 : (isFast ? 3.2 : 2.1),
      damage: isGiant ? 25 : (isFast ? 8 : 14),
      gold: isGiant ? 25 : (isFast ? 6 : 10),
      attackCooldown: 0
    });

    spawned++;
  }, 700);
}

// Conexión WebSockets
wss.on('connection', (ws) => {
  const playerId = 'p_' + nextId++;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'join') {
        const heroClass = HERO_CLASSES[data.heroClass] ? data.heroClass : 'guerrero';
        const cfg = HERO_CLASSES[heroClass];
        gameState.players[playerId] = {
          id: playerId,
          name: (data.name || 'Héroe').substring(0, 15),
          heroClass,
          x: gameState.nexus.x + (Math.random() * 80 - 40),
          y: gameState.nexus.y + (Math.random() * 80 - 40),
          vx: 0,
          vy: 0,
          hp: cfg.maxHp,
          maxHp: cfg.maxHp,
          cdQ: 0,
          cdW: 0
        };
        ws.send(JSON.stringify({ type: 'init', playerId, mapSize: MAP_SIZE, classes: HERO_CLASSES }));
      }

      if (data.type === 'move' && gameState.players[playerId]) {
        const p = gameState.players[playerId];
        const cfg = HERO_CLASSES[p.heroClass];
        const len = Math.hypot(data.dx, data.dy);
        if (len > 0) {
          p.vx = (data.dx / len) * cfg.speed * Math.min(1, len);
          p.vy = (data.dy / len) * cfg.speed * Math.min(1, len);
        } else {
          p.vx = 0;
          p.vy = 0;
        }
      }

      if (data.type === 'action' && gameState.players[playerId]) {
        const p = gameState.players[playerId];
        const cfg = HERO_CLASSES[p.heroClass];
        const { action, targetX, targetY } = data;

        const angle = Math.atan2(targetY - p.y, targetX - p.x);

        if (action === 'q' && p.cdQ <= 0) {
          p.cdQ = cfg.cooldowns.q;
          if (p.heroClass === 'guerrero') {
            // Torbellino cuerpo a cuerpo
            gameState.enemies.forEach(e => {
              if (Math.hypot(e.x - p.x, e.y - p.y) < 85) {
                e.hp -= 45;
              }
            });
          } else if (p.heroClass === 'mago') {
            // Bola de fuego
            gameState.projectiles.push({
              id: nextId++,
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * 7,
              vy: Math.sin(angle) * 7,
              damage: 60,
              radius: 12,
              color: '#e67e22',
              range: 350,
              traveled: 0,
              aoe: 55
            });
          } else if (p.heroClass === 'tirador') {
            // Flecha rápida
            gameState.projectiles.push({
              id: nextId++,
              x: p.x,
              y: p.y,
              vx: Math.cos(angle) * 11,
              vy: Math.sin(angle) * 11,
              damage: 35,
              radius: 6,
              color: '#2ecc71',
              range: 480,
              traveled: 0
            });
          } else if (p.heroClass === 'ingeniero') {
            // Pulso curativo para aliados y nexo
            Object.values(gameState.players).forEach(other => {
              if (Math.hypot(other.x - p.x, other.y - p.y) < 140) {
                other.hp = Math.min(other.maxHp, other.hp + 40);
              }
            });
            if (Math.hypot(gameState.nexus.x - p.x, gameState.nexus.y - p.y) < 160) {
              gameState.nexus.hp = Math.min(gameState.nexus.maxHp, gameState.nexus.hp + 50);
            }
          }
        }

        if (action === 'w' && p.cdW <= 0) {
          p.cdW = cfg.cooldowns.w;
          if (p.heroClass === 'ingeniero') {
            // Colocar torreta estilo Clash of Clans si hay oro
            if (gameState.gold >= 30) {
              gameState.gold -= 30;
              gameState.turrets.push({
                id: nextId++,
                x: p.x,
                y: p.y,
                radius: 22,
                hp: 150,
                range: 180,
                cooldown: 0
              });
            }
          } else if (p.heroClass === 'mago') {
            // Rayo de hielo congelante a enemigos
            gameState.enemies.forEach(e => {
              if (Math.hypot(e.x - p.x, e.y - p.y) < 160) {
                e.hp -= 30;
                e.speed = Math.max(0.5, e.speed * 0.4);
              }
            });
          } else if (p.heroClass === 'guerrero') {
            // Embestida que empuja y aturde
            p.x += Math.cos(angle) * 120;
            p.y += Math.sin(angle) * 120;
            gameState.enemies.forEach(e => {
              if (Math.hypot(e.x - p.x, e.y - p.y) < 60) {
                e.hp -= 40;
              }
            });
          } else if (p.heroClass === 'tirador') {
            // Lluvia de flechas en abanico
            for (let i = -2; i <= 2; i++) {
              const a = angle + i * 0.18;
              gameState.projectiles.push({
                id: nextId++,
                x: p.x,
                y: p.y,
                vx: Math.cos(a) * 9,
                vy: Math.sin(a) * 9,
                damage: 28,
                radius: 5,
                color: '#27ae60',
                range: 400,
                traveled: 0
              });
            }
          }
        }
      }

      if (data.type === 'build_turret' && gameState.gold >= 40) {
        // Opción rápida para construir torreta con el botón del Nexo
        const p = gameState.players[playerId];
        if (p) {
          gameState.gold -= 40;
          gameState.turrets.push({
            id: nextId++,
            x: p.x,
            y: p.y,
            radius: 22,
            hp: 200,
            range: 200,
            cooldown: 0
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    delete gameState.players[playerId];
  });
});

// Loop principal de simulación a 30 FPS
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;

setInterval(() => {
  // Manejo de oleadas
  if (gameState.waveState === 'countdown') {
    gameState.waveTimer -= DT;
    if (gameState.waveTimer <= 0) {
      spawnWave(gameState.wave);
    }
  } else if (gameState.waveState === 'active') {
    if (gameState.enemies.length === 0 && gameState.enemiesRemainingInWave <= 0) {
      gameState.wave++;
      gameState.gold += 35 + gameState.wave * 15;
      gameState.waveState = 'countdown';
      gameState.waveTimer = 6;
    }
  }

  // Actualizar jugadores
  Object.values(gameState.players).forEach(p => {
    p.x = Math.max(30, Math.min(MAP_SIZE.width - 30, p.x + p.vx));
    p.y = Math.max(30, Math.min(MAP_SIZE.height - 30, p.y + p.vy));
    if (p.cdQ > 0) p.cdQ = Math.max(0, p.cdQ - DT);
    if (p.cdW > 0) p.cdW = Math.max(0, p.cdW - DT);
  });

  // Torretas disparando
  gameState.turrets.forEach(t => {
    t.cooldown = Math.max(0, t.cooldown - DT);
    if (t.cooldown <= 0) {
      // Buscar enemigo más cercano
      let target = null;
      let minDist = t.range;
      gameState.enemies.forEach(e => {
        const d = Math.hypot(e.x - t.x, e.y - t.y);
        if (d < minDist) {
          minDist = d;
          target = e;
        }
      });

      if (target) {
        t.cooldown = 0.9;
        const angle = Math.atan2(target.y - t.y, target.x - t.x);
        gameState.projectiles.push({
          id: nextId++,
          x: t.x,
          y: t.y,
          vx: Math.cos(angle) * 8,
          vy: Math.sin(angle) * 8,
          damage: 22,
          radius: 5,
          color: '#f1c40f',
          range: t.range,
          traveled: 0
        });
      }
    }
  });

  // Proyectiles
  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const proj = gameState.projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;
    proj.traveled += Math.hypot(proj.vx, proj.vy);

    let hit = false;
    for (let j = gameState.enemies.length - 1; j >= 0; j--) {
      const e = gameState.enemies[j];
      if (Math.hypot(e.x - proj.x, e.y - proj.y) < e.radius + proj.radius) {
        hit = true;
        if (proj.aoe) {
          gameState.enemies.forEach(other => {
            if (Math.hypot(other.x - proj.x, other.y - proj.y) < proj.aoe) {
              other.hp -= proj.damage;
            }
          });
        } else {
          e.hp -= proj.damage;
        }
        break;
      }
    }

    if (hit || proj.traveled >= proj.range) {
      gameState.projectiles.splice(i, 1);
    }
  }

  // Enemigos se mueven hacia el nexo o jugador más cercano
  for (let i = gameState.enemies.length - 1; i >= 0; i--) {
    const e = gameState.enemies[i];
    if (e.hp <= 0) {
      gameState.gold += e.gold;
      gameState.enemies.splice(i, 1);
      continue;
    }

    // Objetivo principal: Nexo
    let targetX = gameState.nexus.x;
    let targetY = gameState.nexus.y;
    let targetRadius = gameState.nexus.radius;
    let isTargetNexus = true;

    // Si hay un jugador muy cerca, lo persigue
    Object.values(gameState.players).forEach(p => {
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < 110) {
        targetX = p.x;
        targetY = p.y;
        targetRadius = 18;
        isTargetNexus = false;
      }
    });

    const angle = Math.atan2(targetY - e.y, targetX - e.x);
    const dist = Math.hypot(targetX - e.x, targetY - e.y);

    if (dist > targetRadius + e.radius) {
      e.x += Math.cos(angle) * e.speed;
      e.y += Math.sin(angle) * e.speed;
    } else {
      // Atacar objetivo
      e.attackCooldown -= DT;
      if (e.attackCooldown <= 0) {
        e.attackCooldown = 1.0;
        if (isTargetNexus) {
          gameState.nexus.hp = Math.max(0, gameState.nexus.hp - e.damage);
          if (gameState.nexus.hp <= 0) {
            gameState.waveState = 'gameover';
          }
        }
      }
    }
  }

  // Enviar estado a todos los clientes
  const payload = JSON.stringify({ type: 'state', state: gameState });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hero Defense Coop corriendo en http://localhost:${PORT}`);
});
