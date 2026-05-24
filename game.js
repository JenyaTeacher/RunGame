/* =====================================================================
   OFFICE RUN — game.js
   Адаптація: телефон (повний екран) + ПК (колонка 420px по центру)
   ===================================================================== */
"use strict";

// ══════════════════════════════════════════════════════════════════════
//  ЗАВАНТАЖЕННЯ СПРАЙТІВ — абсолютні шляхи (фікс для мобільних)
// ══════════════════════════════════════════════════════════════════════
const BASE_URL = (() => {
  const s = window.location.href;
  return s.substring(0, s.lastIndexOf("/") + 1);
})();

const IMGS = { player: null, divan: null, culler: null };

function loadSprites(cb) {
  const sources = {
    player: BASE_URL + "sprites/player.png",
    divan:  BASE_URL + "sprites/divan.png",
    culler: BASE_URL + "sprites/culler.png",
  };
  let total = Object.keys(sources).length, loaded = 0;
  const done = () => { if (++loaded >= total) cb(); };
  for (const [key, src] of Object.entries(sources)) {
    const img = new Image();
    img.onload  = () => { IMGS[key] = img; done(); };
    img.onerror = () => { console.warn("Не вдалося:", src); done(); };
    img.src = src;
  }
}

/* Малює спрайт з видаленням чорного фону через compositing.
   "screen" blend mode: чорний (0,0,0) стає повністю прозорим,
   світлі пікселі — повністю видимими. Без getImageData, без CORS. */
function drawSprite(img, x, y, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

/* jeka і ula обробляються через CSS mix-blend-mode: screen в style.css */

// ══════════════════════════════════════════════════════════════════════
//  DOM
// ══════════════════════════════════════════════════════════════════════
const startScreen    = document.getElementById("startScreen");
const gameScreen     = document.getElementById("gameScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const canvas         = document.getElementById("gameCanvas");
const ctx            = canvas.getContext("2d");
const scoreVal       = document.getElementById("scoreVal");
const livesVal       = document.getElementById("livesVal");
const finalScoreEl   = document.getElementById("finalScore");
const bestScoreEl    = document.getElementById("bestScore");

// ══════════════════════════════════════════════════════════════════════
//  ІНЖЕКТ ПІДКАЗОК ДЛЯ ПК
// ══════════════════════════════════════════════════════════════════════
(function injectDesktopHint() {
  const hint = document.createElement("div");
  hint.id = "desktopHint";
  hint.innerHTML = `
    <div class="dh-col left">
      <div class="dh-key"><kbd>←</kbd>ЛІВО</div>
      <div class="dh-key pink"><kbd>→</kbd>ПРАВО</div>
    </div>
    <div class="dh-col right">
      <div class="dh-key"><kbd>SPACE</kbd>СТРИБОК</div>
    </div>`;
  document.body.appendChild(hint);
})();

// ══════════════════════════════════════════════════════════════════════
//  КОНСТАНТИ
// ══════════════════════════════════════════════════════════════════════
const LANES           = 3;
const BASE_SPEED      = 5;
const SPEED_INC       = 0.0008;
const INVINCIBLE_TIME = 120;

// Реальні розміри спрайтів для збереження пропорцій
const SPRITE_SIZES = {
  culler: { w: 397,  h: 1091 },  // ratio ≈ 0.364  (вузький вертикальний)
  divan:  { w: 1064, h: 759  },  // ratio ≈ 1.402  (широкий горизонтальний)
};

// Неонова палітра
const N = {
  bg:     "#07070e",
  cyan:   "#00f5ff",
  pink:   "#ff2d78",
  purple: "#a855f7",
  gold:   "#ffd700",
  white:  "#e8e8ff",
};
const LANE_COLS = [N.cyan, N.pink, N.purple];

// Розміри — заповнюються в resize()
let W, H, laneW, laneX;

// Фізика — адаптується до висоти екрану
let JUMP_VEL, GRAVITY;

// ══════════════════════════════════════════════════════════════════════
//  СТАН ГРИ
// ══════════════════════════════════════════════════════════════════════
let state = "idle";
let score, lives, speed, frame, invincible, best = 0;

const player = {
  lane:1, targetX:0, x:0, y:0,
  vy:0, onGround:true, w:0, h:0, jumpCount:0,
};

let obstacles=[], coins=[], particles=[], floorTiles=[], ceilLamps=[];

// ══════════════════════════════════════════════════════════════════════
//  RESIZE — адаптація до будь-якого екрану
// ══════════════════════════════════════════════════════════════════════
function resize() {
  // canvas займає весь wrapper
  W = canvas.width  = canvas.offsetWidth;
  H = canvas.height = canvas.offsetHeight;

  laneW = W / LANES;
  laneX = [laneW * .5, laneW * 1.5, laneW * 2.5];

  // Персонаж — розмір відносно ширини доріжки
  player.w = laneW * .38;
  player.h = player.w * 1.7;
  player.y = H * .72;

  if (!player.targetX) {
    player.x = laneX[player.lane];
    player.targetX = player.x;
  }

  // Фізика — менша висота стрибка, повільніша гравітація = більше часу в повітрі
  JUMP_VEL = -(H * 0.034);   // було 0.048 — нижчий стрибок
  GRAVITY  = H * 0.00085;    // було 0.0016 — вдвічі повільніше падіння
}
window.addEventListener("resize", () => { resize(); });

// ══════════════════════════════════════════════════════════════════════
//  РОЗМІРИ ПЕРЕШКОД зі збереженням пропорцій
// ══════════════════════════════════════════════════════════════════════
function obstacleSize(type) {
  if (type === "culler") {
    const ratio = SPRITE_SIZES.culler.w / SPRITE_SIZES.culler.h; // ~0.364
    const h = H * .20;
    const w = h * ratio;
    return { w, h };
  }
  if (type === "divan") {
    const ratio = SPRITE_SIZES.divan.w / SPRITE_SIZES.divan.h;   // ~1.402
    const w = laneW * 1.1;
    const h = w / ratio;
    return { w, h };
  }
}

// ══════════════════════════════════════════════════════════════════════
//  ІНІЦІАЛІЗАЦІЯ
// ══════════════════════════════════════════════════════════════════════
function initGame() {
  score=0; lives=3; speed=BASE_SPEED; frame=0; invincible=0;
  player.lane=1;
  player.x = player.targetX = laneX[1];
  player.vy=0; player.onGround=true; player.jumpCount=0;
  obstacles=[]; coins=[]; particles=[];

  // Плитки підлоги
  floorTiles=[];
  const th = H * .08;
  for (let i=0; i < Math.ceil(H/th)+2; i++) floorTiles.push({ y: i*th });

  // Стельові лампи
  ceilLamps=[];
  const lsp = H * .22;
  for (let i=0; i<6; i++) ceilLamps.push({ y:-i*lsp, flicker:Math.random()*100 });
}

// ══════════════════════════════════════════════════════════════════════
//  ЕКРАНИ
// ══════════════════════════════════════════════════════════════════════
function showScreen(id) {
  [startScreen, gameScreen, gameOverScreen].forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
document.getElementById("startBtn").addEventListener("click", () => {
  showScreen("gameScreen"); initGame(); state="running"; requestAnimationFrame(loop);
});
document.getElementById("restartBtn").addEventListener("click", () => {
  showScreen("gameScreen"); initGame(); state="running"; requestAnimationFrame(loop);
});

// ══════════════════════════════════════════════════════════════════════
//  КЕРУВАННЯ — клавіатура (ПК) + свайпи (мобільний)
// ══════════════════════════════════════════════════════════════════════
document.addEventListener("keydown", e => {
  if (state !== "running") return;
  if (e.code==="ArrowLeft"  || e.key==="ArrowLeft")  moveLane(-1);
  if (e.code==="ArrowRight" || e.key==="ArrowRight") moveLane(1);
  if (e.code==="Space" || e.key===" ") { e.preventDefault(); jump(); }
});

// Підтримка A/D і стрілок для ПК
document.addEventListener("keydown", e => {
  if (state !== "running") return;
  if (e.code==="KeyA") moveLane(-1);
  if (e.code==="KeyD") moveLane(1);
  if (e.code==="KeyW" || e.code==="ArrowUp") { e.preventDefault(); jump(); }
});

let txS=0, tyS=0;
canvas.addEventListener("touchstart", e => {
  txS = e.changedTouches[0].clientX;
  tyS = e.changedTouches[0].clientY;
}, { passive:true });
canvas.addEventListener("touchend", e => {
  if (state !== "running") return;
  const dx = e.changedTouches[0].clientX - txS;
  const dy = e.changedTouches[0].clientY - tyS;
  if (Math.abs(dy) > Math.abs(dx) && dy < -40) { jump(); return; }
  if (Math.abs(dx) > 30) moveLane(dx < 0 ? -1 : 1);
}, { passive:true });

// ══════════════════════════════════════════════════════════════════════
//  ДІЇ ГРАВЦЯ
// ══════════════════════════════════════════════════════════════════════
function moveLane(dir) {
  const n = player.lane + dir;
  if (n < 0 || n >= LANES) return;
  player.lane = n;
  player.targetX = laneX[n];
  spawnParticles(player.x, player.y, LANE_COLS[n], 5);
}
function jump() {
  if (player.jumpCount >= 1) return;
  player.vy = JUMP_VEL;
  player.onGround = false;
  player.jumpCount++;
  spawnParticles(player.x, player.y + player.h*.5, N.cyan, 8);
}

// ══════════════════════════════════════════════════════════════════════
//  UPDATE
// ══════════════════════════════════════════════════════════════════════
function updatePlayer() {
  player.x += (player.targetX - player.x) * .18;
  player.vy += GRAVITY;
  player.y  += player.vy;
  const gY = H * .72;
  if (player.y >= gY) {
    player.y = gY; player.vy = 0;
    player.onGround = true; player.jumpCount = 0;
  }
  if (invincible > 0) invincible--;
}

function updateObstacles() {
  const interval = Math.max(40, 90 - score * .05);
  if (frame % Math.floor(interval) === 0) spawnObstacle();

  for (let i = obstacles.length-1; i >= 0; i--) {
    const o = obstacles[i];
    o.y += speed;

    // Колізія — лише на землі
    if (!o.hit && invincible === 0 && player.onGround) {
      const pL = player.x - player.w*.35, pR = player.x + player.w*.35;
      const pT = player.y + player.h*.1,  pB = player.y + player.h*.5;
      for (const ln of o.lanes) {
        const hw = o.spriteW * .42;
        const oL = laneX[ln] - hw, oR = laneX[ln] + hw;
        if (pR>oL && pL<oR && pB>o.y && pT<o.y+o.h) { o.hit=true; hitPlayer(); }
      }
    }
    if (o.y > H + 200) obstacles.splice(i, 1);
  }
}

function updateCoins() {
  if (frame % 55 === 17) spawnCoin();
  for (let i = coins.length-1; i >= 0; i--) {
    const c = coins[i];
    c.y += speed;
    if (!c.collected) {
      const d = Math.hypot(player.x - laneX[c.lane], player.y - c.y);
      if (d < player.w * .7) {
        c.collected=true; score+=10;
        spawnParticles(laneX[c.lane], c.y, N.cyan, 10);
        updateHUD();
      }
    }
    if (c.y > H+40) coins.splice(i, 1);
  }
}

function updateFloor() {
  const th = H * .08;
  for (const t of floorTiles) t.y += speed;
  floorTiles = floorTiles.filter(t => t.y < H + th);
  while (floorTiles.length < Math.ceil(H/th)+2) {
    const minY = Math.min(...floorTiles.map(t => t.y));
    floorTiles.push({ y: minY - th });
  }
}

function updateLamps() {
  for (const l of ceilLamps) l.y += speed;
  ceilLamps = ceilLamps.filter(l => l.y < H + 20);
  const lsp = H * .22;
  while (ceilLamps.length < 6) {
    const minY = Math.min(...ceilLamps.map(l => l.y));
    ceilLamps.push({ y: minY - lsp, flicker: Math.random()*100 });
  }
}

function updateParticles() {
  for (let i = particles.length-1; i >= 0; i--) {
    const p = particles[i];
    p.x+=p.vx; p.y+=p.vy; p.vy+=.2; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SPAWN
// ══════════════════════════════════════════════════════════════════════
function spawnObstacle() {
  const type = Math.random() < .5 ? "culler" : "divan";
  const sz   = obstacleSize(type);
  let lanes;
  if (type === "culler") {
    lanes = [Math.floor(Math.random() * LANES)];
  } else {
    const s = Math.random() < .5 ? 0 : 1;
    lanes = [s, s+1];
  }
  obstacles.push({
    type, lanes,
    y:       -sz.h - 10,
    h:       sz.h,
    spriteW: sz.w,
    hit:     false,
  });
}

function spawnCoin() {
  const lane = Math.floor(Math.random() * LANES);
  const safe = H * .25;
  for (const o of obstacles)
    if (o.lanes.includes(lane) && o.y > -safe && o.y < H*.5) return;
  coins.push({ lane, y: -30, collected: false });
}

function spawnParticles(x, y, color, count) {
  for (let i=0; i<count; i++) {
    const a = Math.random()*Math.PI*2, s = 2+Math.random()*5;
    particles.push({ x, y,
      vx: Math.cos(a)*s, vy: Math.sin(a)*s-2,
      color, life: 35+Math.random()*20, maxLife:55, r:3+Math.random()*4 });
  }
}

// ══════════════════════════════════════════════════════════════════════
//  HIT / GAME OVER
// ══════════════════════════════════════════════════════════════════════
function hitPlayer() {
  lives--; invincible = INVINCIBLE_TIME;
  spawnParticles(player.x, player.y, N.pink, 20);
  updateHUD();
  if (lives <= 0) { state="over"; setTimeout(showGameOver, 600); }
}
function updateHUD() {
  scoreVal.textContent = score;
  livesVal.textContent = "❤️".repeat(Math.max(lives, 0));
}
function showGameOver() {
  if (score > best) best = score;
  finalScoreEl.textContent = score;
  bestScoreEl.textContent  = best;
  showScreen("gameOverScreen");
}

// ══════════════════════════════════════════════════════════════════════
//  DRAW — ОФІСНИЙ КОРИДОР
// ══════════════════════════════════════════════════════════════════════
function drawBackground() {
  ctx.fillStyle = N.bg;
  ctx.fillRect(0, 0, W, H);

  const ceilH   = H * .08;
  const floorTop= H * .68;

  // Стеля
  ctx.fillStyle = "#0c0c1e";
  ctx.fillRect(0, 0, W, ceilH);

  // Лінія стелі
  ctx.save();
  ctx.shadowColor = N.cyan; ctx.shadowBlur = 18;
  ctx.strokeStyle = "rgba(0,245,255,.7)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,ceilH); ctx.lineTo(W,ceilH); ctx.stroke();
  ctx.restore();

  // Підлога
  const fg = ctx.createLinearGradient(0, floorTop, 0, H);
  fg.addColorStop(0, "#10102a"); fg.addColorStop(.4,"#0e0e22"); fg.addColorStop(1,"#080815");
  ctx.fillStyle = fg;
  ctx.fillRect(0, floorTop, W, H-floorTop);

  // Плитки підлоги — горизонтальні лінії
  ctx.save();
  ctx.strokeStyle = "rgba(0,245,255,.12)"; ctx.lineWidth = 1;
  for (const t of floorTiles) {
    if (t.y < floorTop) continue;
    ctx.beginPath(); ctx.moveTo(0,t.y); ctx.lineTo(W,t.y); ctx.stroke();
  }
  // Вертикальні лінії доріжок на підлозі
  for (let i=0; i<=LANES; i++) {
    const x = laneW*i;
    ctx.beginPath(); ctx.moveTo(x,floorTop); ctx.lineTo(x,H); ctx.stroke();
  }
  ctx.restore();

  // Лінія підлоги
  ctx.save();
  ctx.shadowColor = N.pink; ctx.shadowBlur = 16;
  ctx.strokeStyle = "rgba(255,45,120,.65)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,floorTop); ctx.lineTo(W,floorTop); ctx.stroke();
  ctx.restore();

  // Бічні неонові смуги
  [[W*.015, N.cyan], [W*.985, N.pink]].forEach(([x, col]) => {
    ctx.save();
    ctx.shadowColor=col; ctx.shadowBlur=20;
    ctx.strokeStyle=col; ctx.lineWidth=3; ctx.globalAlpha=.4;
    ctx.beginPath(); ctx.moveTo(x,ceilH); ctx.lineTo(x,floorTop); ctx.stroke();
    ctx.restore();
  });

  // Стельові лампи
  for (const l of ceilLamps) {
    const flick = Math.sin(frame*.07 + l.flicker) < .97;
    const lx = W * .5;
    ctx.save(); ctx.globalAlpha = flick ? .85 : .3;
    // Корпус
    ctx.fillStyle="#1a1a30"; ctx.strokeStyle="rgba(0,245,255,.4)"; ctx.lineWidth=1.5;
    roundRect(ctx, lx-22, l.y, 44, 12, 4); ctx.fill(); ctx.stroke();
    // Промінь
    const rg = ctx.createLinearGradient(lx, l.y+12, lx, l.y+H*.25);
    rg.addColorStop(0,"rgba(0,245,255,.18)"); rg.addColorStop(1,"rgba(0,245,255,0)");
    ctx.fillStyle=rg;
    ctx.beginPath();
    ctx.moveTo(lx-22,l.y+12); ctx.lineTo(lx+22,l.y+12);
    ctx.lineTo(lx+55,l.y+H*.25); ctx.lineTo(lx-55,l.y+H*.25);
    ctx.closePath(); ctx.fill();
    // Лампочка
    ctx.beginPath(); ctx.arc(lx, l.y+6, 5, 0, Math.PI*2);
    ctx.fillStyle = flick ? "#e0ffff" : "#334";
    ctx.shadowColor=N.cyan; ctx.shadowBlur=flick?14:0;
    ctx.fill(); ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DRAW — ГРАВЕЦЬ
// ══════════════════════════════════════════════════════════════════════
function drawPlayer() {
  const x=player.x, y=player.y, pw=player.w, ph=player.h;
  const blink = invincible>0 && Math.floor(invincible/6)%2===0;
  if (blink) return;

  const gY = H * .72;
  const shadowSc = player.onGround ? 1 : Math.max(.2, 1-(gY-y)/(H*.35));

  // Тінь на підлозі
  ctx.save();
  ctx.globalAlpha = player.onGround ? .18 : .38;
  ctx.beginPath();
  ctx.ellipse(x, gY+ph*.52, pw*.38*shadowSc, 7*shadowSc, 0, 0, Math.PI*2);
  ctx.fillStyle = LANE_COLS[player.lane];
  ctx.shadowColor = LANE_COLS[player.lane]; ctx.shadowBlur=12;
  ctx.fill(); ctx.restore();

  // Пунктир до землі під час стрибка
  if (!player.onGround) {
    ctx.save(); ctx.globalAlpha=.3;
    ctx.strokeStyle=LANE_COLS[player.lane]; ctx.lineWidth=2; ctx.setLineDash([5,7]);
    ctx.beginPath(); ctx.moveTo(x,y+ph*.5); ctx.lineTo(x,gY+ph*.5); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }

  if (IMGS.player) {
    const iw = pw*1.15, ih = ph*1.35;
    ctx.save();
    ctx.shadowColor=LANE_COLS[player.lane]; ctx.shadowBlur=22;
    ctx.restore();
    drawSprite(IMGS.player, x-iw/2, y-ph*.65-ih*.05, iw, ih);
  } else {
    ctx.save();
    ctx.fillStyle=LANE_COLS[player.lane];
    ctx.shadowColor=LANE_COLS[player.lane]; ctx.shadowBlur=18;
    roundRect(ctx, x-pw*.4, y-ph*.6, pw*.8, ph*.8, 10);
    ctx.fill(); ctx.restore();
  }

  // Хітбокс — видимий для зручності гравця
  ctx.save();
  ctx.globalAlpha=.35; ctx.strokeStyle=N.white; ctx.lineWidth=1.5; ctx.setLineDash([4,5]);
  roundRect(ctx, x-pw*.35, y+ph*.1, pw*.7, ph*.4, 4);
  ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════
//  DRAW — ПЕРЕШКОДИ
// ══════════════════════════════════════════════════════════════════════
function drawObstacles() {
  for (const o of obstacles) {
    const dist   = o.y - (player.y - player.h*.5);
    const warned = dist>0 && dist<H*.38;
    const danger  = dist>0 && dist<H*.18;
    const onLane = o.lanes.includes(player.lane);

    // Центр по X
    const cx = o.type==="culler"
      ? laneX[o.lanes[0]]
      : (laneX[o.lanes[0]] + laneX[o.lanes[1]]) / 2;

    const sw=o.spriteW, sh=o.h;

    // Попереджувальний ореол
    if (warned && onLane) {
      const pulse = .5+.5*Math.sin(frame*.25);
      ctx.save();
      ctx.globalAlpha = .2+pulse*.2;
      ctx.fillStyle = danger ? "#ff5500" : "#ffdd00";
      ctx.shadowColor = danger ? "#ff5500" : "#ffdd00"; ctx.shadowBlur=30;
      roundRect(ctx, cx-sw/2-10, o.y-8, sw+20, sh+16, 12);
      ctx.fill(); ctx.restore();
    }

    const img = o.type==="culler" ? IMGS.culler : IMGS.divan;

    if (img) {
      ctx.save();
      ctx.shadowColor = danger&&onLane ? "#ff6600" : N.pink;
      ctx.shadowBlur  = danger&&onLane ? 30 : 16;
      ctx.restore();
      drawSprite(img, cx-sw/2, o.y, sw, sh);
    } else {
      // Fallback
      ctx.save();
      ctx.fillStyle   = o.type==="divan" ? "#332200" : "#001a33";
      ctx.strokeStyle = o.type==="divan" ? N.gold : N.cyan;
      ctx.lineWidth=3; ctx.shadowColor=N.pink; ctx.shadowBlur=16;
      roundRect(ctx, cx-sw/2, o.y, sw, sh, 8); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // JUMP підказка
    if (onLane && warned && !danger && player.onGround) {
      const pulse = .7+.3*Math.sin(frame*.3);
      ctx.save(); ctx.globalAlpha=pulse;
      ctx.font=`900 ${Math.round(laneW*.2)}px Arial Black,Arial`;
      ctx.textAlign="center"; ctx.textBaseline="bottom";
      ctx.fillStyle="#ffdd00"; ctx.strokeStyle="#000"; ctx.lineWidth=4;
      ctx.shadowColor="#ffdd00"; ctx.shadowBlur=14;
      ctx.strokeText("▲ JUMP!", cx, o.y-10);
      ctx.fillText ("▲ JUMP!", cx, o.y-10);
      ctx.restore();
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DRAW — АЛМАЗИ
// ══════════════════════════════════════════════════════════════════════
function drawCoins() {
  for (const c of coins) {
    if (c.collected) continue;
    const cx=laneX[c.lane], cy=c.y;
    const r   = laneW * .13;
    const bob = Math.sin(frame*.09 + c.lane*1.3) * 3;
    const spin= frame * .04;

    ctx.save();
    ctx.translate(cx, cy+bob);
    ctx.rotate(spin);
    ctx.shadowColor=N.cyan; ctx.shadowBlur=22;

    const pts = [[0,-r*1.3],[r*.85,0],[0,r*1.0],[-r*.85,0]];
    const dg = ctx.createLinearGradient(-r*.8,-r*1.3,r*.8,r);
    dg.addColorStop(0,"#a8ffff"); dg.addColorStop(.3,N.cyan);
    dg.addColorStop(.65,"#0090aa"); dg.addColorStop(1,"#004f6e");
    ctx.fillStyle=dg;
    ctx.beginPath();
    ctx.moveTo(pts[0][0],pts[0][1]);
    pts.slice(1).forEach(([px,py])=>ctx.lineTo(px,py));
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle="rgba(0,245,255,.7)"; ctx.lineWidth=1.5; ctx.stroke();
    // Блиск
    ctx.fillStyle="rgba(255,255,255,.45)";
    ctx.beginPath();
    ctx.moveTo(0,-r*1.3); ctx.lineTo(r*.35,-r*.3);
    ctx.lineTo(0,-r*.1); ctx.lineTo(-r*.35,-r*.3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  DRAW — ЧАСТИНКИ
// ══════════════════════════════════════════════════════════════════════
function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life/p.maxLife;
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(p.life/p.maxLife),0,Math.PI*2);
    ctx.fill(); ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════════════════
//  ГОЛОВНИЙ ЦИКЛ
// ══════════════════════════════════════════════════════════════════════
function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  drawCoins();
  drawObstacles();
  drawPlayer();
  drawParticles();
}

function loop() {
  if (state !== "running") return;
  frame++; speed += SPEED_INC;
  if (frame % 90 === 0) { score++; updateHUD(); }
  updatePlayer();
  updateObstacles();
  updateCoins();
  updateParticles();
  updateFloor();
  updateLamps();
  draw();
  requestAnimationFrame(loop);
}

// ══════════════════════════════════════════════════════════════════════
//  УТИЛІТА
// ══════════════════════════════════════════════════════════════════════
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ══════════════════════════════════════════════════════════════════════
//  СТАРТ
// ══════════════════════════════════════════════════════════════════════
resize();
loadSprites(() => { showScreen("startScreen"); });
