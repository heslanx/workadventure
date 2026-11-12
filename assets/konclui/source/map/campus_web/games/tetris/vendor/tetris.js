// Javascript Tetris, by Jake Gordon (https://github.com/jakesgordon/javascript-tetris), MIT license (see LICENSE).
// Koncluí changes (also listed in ../VENDOR.md), each marked "Koncluí":
//   - wrapped in a function, exposes window.Tetris (the page glue in ../index.html drives the UI);
//   - the free-running requestAnimationFrame loop is KG.loop, started by play() and stopped on pause/game over,
//     so a game that is not being played costs no CPU (BACKLOG.md section 3);
//   - FPS counter (stats.js) and the packaged texture are gone; palette, block bevel and court grid are ours;
//   - canvas sized by the stage (and by devicePixelRatio, 1 on the light profile) instead of media queries;
//   - the "next piece" preview has its own block size; the score is shown as is (no slot-machine counting);
//   - pause (P / Esc) replaces "Esc loses"; touch actions (Tetris.act) for the on-screen pad and swipes.
(function () {
  "use strict";

//-------------------------------------------------------------------------
// base helper methods
//-------------------------------------------------------------------------

function get(id)        { return document.getElementById(id);  }
function text(id, value){ get(id).textContent = value;         } // Koncluí: textContent instead of innerHTML

function random(min, max)      { return (min + (Math.random() * (max - min)));            }

//-------------------------------------------------------------------------
// game constants
//-------------------------------------------------------------------------

var KEY     = { ESC: 27, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, P: 80 },
    DIR     = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3, MIN: 0, MAX: 3 },
    canvas  = get('canvas'),
    ctx     = canvas.getContext('2d'),
    ucanvas = get('upcoming'),
    uctx    = ucanvas.getContext('2d'),
    speed   = { start: 0.6, decrement: 0.005, min: 0.1 }, // how long before piece drops by 1 row (seconds)
    nx      = 10, // width of tetris court (in blocks)
    ny      = 20, // height of tetris court (in blocks)
    nu      = 5,  // width/height of upcoming preview (in blocks)
    hooks   = { onState: function () {}, onEnd: function () {} }; // Koncluí: set by the page glue

//-------------------------------------------------------------------------
// game variables (initialized during reset)
//-------------------------------------------------------------------------

var dx, dy,        // pixel size of a single tetris block
    udx,           // Koncluí: pixel size of a block in the preview
    blocks,        // 2 dimensional array (nx*ny) representing tetris court - either empty block or occupied by a 'piece'
    actions,       // queue of user actions (inputs)
    playing = false, // true|false - game is in progress
    paused  = false, // Koncluí: true while the game is held
    loop    = null,  // Koncluí: the KG.loop handle while the game runs
    dt,            // time since starting this game
    current,       // the current piece
    next,          // the next piece
    score,         // the current score
    rows,          // number of completed rows in the current game
    step;          // how long before current piece drops by 1 row

//-------------------------------------------------------------------------
// tetris pieces
//
// blocks: each element represents a rotation of the piece (0, 90, 180, 270)
//         each element is a 16 bit integer where the 16 bits represent
//         a 4x4 set of blocks, e.g. j.blocks[0] = 0x44C0
//
//             0100 = 0x4 << 3 = 0x4000
//             0100 = 0x4 << 2 = 0x0400
//             1100 = 0xC << 1 = 0x00C0
//             0000 = 0x0 << 0 = 0x0000
//                               ------
//                               0x44C0
//
//-------------------------------------------------------------------------

// Koncluí: colors from the platform palette (mint, blue, amber, sun, violet, green, coral) instead of CSS names
var i = { size: 4, blocks: [0x0F00, 0x2222, 0x00F0, 0x4444], color: '#53FFC8' };
var j = { size: 3, blocks: [0x44C0, 0x8E00, 0x6440, 0x0E20], color: '#4C7DF0' };
var l = { size: 3, blocks: [0x4460, 0x0E80, 0xC440, 0x2E00], color: '#F0883E' };
var o = { size: 2, blocks: [0xCC00, 0xCC00, 0xCC00, 0xCC00], color: '#F2D16B' };
var s = { size: 3, blocks: [0x06C0, 0x8C40, 0x6C00, 0x4620], color: '#2FBF71' };
var t = { size: 3, blocks: [0x0E40, 0x4C40, 0x4E00, 0x4640], color: '#9B7BF0' };
var z = { size: 3, blocks: [0x0C60, 0x4C80, 0xC600, 0x2640], color: '#E8594E' };

//------------------------------------------------
// do the bit manipulation and iterate through each
// occupied block (x,y) for a given piece
//------------------------------------------------
function eachblock(type, x, y, dir, fn) {
  var bit, result, row = 0, col = 0, blocks = type.blocks[dir];
  for(bit = 0x8000 ; bit > 0 ; bit = bit >> 1) {
    if (blocks & bit) {
      fn(x + col, y + row);
    }
    if (++col === 4) {
      col = 0;
      ++row;
    }
  }
}

//-----------------------------------------------------
// check if a piece can fit into a position in the grid
//-----------------------------------------------------
function occupied(type, x, y, dir) {
  var result = false
  eachblock(type, x, y, dir, function(x, y) {
    if ((x < 0) || (x >= nx) || (y < 0) || (y >= ny) || getBlock(x,y))
      result = true;
  });
  return result;
}

function unoccupied(type, x, y, dir) {
  return !occupied(type, x, y, dir);
}

//-----------------------------------------
// start with 4 instances of each piece and
// pick randomly until the 'bag is empty'
//-----------------------------------------
var pieces = [];
function randomPiece() {
  if (pieces.length == 0)
    pieces = [i,i,i,i,j,j,j,j,l,l,l,l,o,o,o,o,s,s,s,s,t,t,t,t,z,z,z,z];
  var type = pieces.splice(random(0, pieces.length-1), 1)[0];
  return { type: type, dir: DIR.UP, x: Math.round(random(0, nx - type.size)), y: 0 };
}


//-------------------------------------------------------------------------
// GAME LOOP
//-------------------------------------------------------------------------

// Koncluí: the loop only exists while a game is being played (not paused, not over); KG.loop also sleeps in a hidden tab
// and runs at 30 fps on the light profile.
function startLoop() {
  if (!loop) loop = KG.loop(function(idt) { update(idt); draw(); });
}

function stopLoop() {
  if (loop) { loop.stop(); loop = null; }
}

function run() {
  document.addEventListener('keydown', keydown, false);
  resize(); // setup all our sizing information
  reset();  // reset the per-game variables
  draw();   // one frame: the empty court, until a game starts
}

// Koncluí: sized by the stage (the page glue calls this when the stage changes size), one block = a whole number of CSS px
function resize() {
  var stage = get('stage'),
      ratio = KG.profile === 'leve' ? 1 : Math.min(window.devicePixelRatio || 1, 2),
      block = Math.max(8, Math.floor(Math.min(stage.clientWidth / nx, stage.clientHeight / ny)));
  canvas.style.width  = (block * nx) + 'px';
  canvas.style.height = (block * ny) + 'px';
  canvas.width   = Math.round(block * nx * ratio);
  canvas.height  = Math.round(block * ny * ratio);
  ucanvas.width  = Math.round(ucanvas.clientWidth  * ratio);
  ucanvas.height = Math.round(ucanvas.clientHeight * ratio);
  dx  = canvas.width  / nx; // pixel size of a single tetris block
  dy  = canvas.height / ny; // (ditto)
  udx = ucanvas.width / nu;
  invalidate();
  invalidateNext();
  if (!loop && next) draw(); // no loop running: repaint by hand
}

function keydown(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  var handled = false;
  switch(ev.keyCode) {
    case KEY.LEFT:   act(DIR.LEFT);  handled = true; break;
    case KEY.RIGHT:  act(DIR.RIGHT); handled = true; break;
    case KEY.UP:     act(DIR.UP);    handled = true; break;
    case KEY.DOWN:   act(DIR.DOWN);  handled = true; break;
    case KEY.ESC:
    case KEY.P:      togglePause();  handled = true; break;
    case KEY.SPACE:
      if (!playing)    play();
      else if (paused) resume();
      handled = true;
      break;
  }
  if (handled)
    ev.preventDefault(); // prevent arrow keys from scrolling the page (supported in IE9+ and all other browsers)
}

// Koncluí: one user action (a direction), from the keyboard, the on-screen pad or a swipe
function act(dir) {
  if (playing && !paused)
    actions.push(dir);
}

//-------------------------------------------------------------------------
// GAME LOGIC
//-------------------------------------------------------------------------

function play()  { reset(); playing = true; paused = false; startLoop(); hooks.onState('playing'); }
function lose()  { playing = false; paused = false; stopLoop(); invalidate(); draw(); hooks.onState('over'); hooks.onEnd(score); }
function pause()  { if (playing && !paused) { paused = true;  stopLoop();  hooks.onState('paused');  } }
function resume() { if (playing && paused)  { paused = false; startLoop(); hooks.onState('playing'); } }
function togglePause() { if (paused) resume(); else pause(); }

function setScore(n)            { score = n; invalidateScore();  }
function addScore(n)            { setScore(score + n); }
function clearScore()           { setScore(0); }
function clearRows()            { setRows(0); }
function setRows(n)             { rows = n; step = Math.max(speed.min, speed.start - (speed.decrement*rows)); invalidateRows(); }
function addRows(n)             { setRows(rows + n); }
function getBlock(x,y)          { return (blocks && blocks[x] ? blocks[x][y] : null); }
function setBlock(x,y,type)     { blocks[x] = blocks[x] || []; blocks[x][y] = type; invalidate(); }
function clearBlocks()          { blocks = []; invalidate(); }
function clearActions()         { actions = []; }
function setCurrentPiece(piece) { current = piece || randomPiece(); invalidate();     }
function setNextPiece(piece)    { next    = piece || randomPiece(); invalidateNext(); }

function reset() {
  dt = 0;
  clearActions();
  clearBlocks();
  clearRows();
  clearScore();
  setCurrentPiece(next);
  setNextPiece();
}

function update(idt) {
  if (playing) {
    handle(actions.shift());
    dt = dt + idt;
    if (dt > step) {
      dt = dt - step;
      drop();
    }
  }
}

function handle(action) {
  switch(action) {
    case DIR.LEFT:  move(DIR.LEFT);  break;
    case DIR.RIGHT: move(DIR.RIGHT); break;
    case DIR.UP:    rotate();        break;
    case DIR.DOWN:  drop();          break;
  }
}

function move(dir) {
  var x = current.x, y = current.y;
  switch(dir) {
    case DIR.RIGHT: x = x + 1; break;
    case DIR.LEFT:  x = x - 1; break;
    case DIR.DOWN:  y = y + 1; break;
  }
  if (unoccupied(current.type, x, y, current.dir)) {
    current.x = x;
    current.y = y;
    invalidate();
    return true;
  }
  else {
    return false;
  }
}

function rotate() {
  var newdir = (current.dir == DIR.MAX ? DIR.MIN : current.dir + 1);
  if (unoccupied(current.type, current.x, current.y, newdir)) {
    current.dir = newdir;
    invalidate();
  }
}

function drop() {
  if (!move(DIR.DOWN)) {
    addScore(10);
    dropPiece();
    removeLines();
    setCurrentPiece(next);
    setNextPiece(randomPiece());
    clearActions();
    if (occupied(current.type, current.x, current.y, current.dir)) {
      lose();
    }
  }
}

function dropPiece() {
  eachblock(current.type, current.x, current.y, current.dir, function(x, y) {
    setBlock(x, y, current.type);
  });
}

function removeLines() {
  var x, y, complete, n = 0;
  for(y = ny ; y > 0 ; --y) {
    complete = true;
    for(x = 0 ; x < nx ; ++x) {
      if (!getBlock(x, y))
        complete = false;
    }
    if (complete) {
      removeLine(y);
      y = y + 1; // recheck same line
      n++;
    }
  }
  if (n > 0) {
    addRows(n);
    addScore(100*Math.pow(2,n-1)); // 1: 100, 2: 200, 3: 400, 4: 800
  }
}

function removeLine(n) {
  var x, y;
  for(y = n ; y >= 0 ; --y) {
    for(x = 0 ; x < nx ; ++x)
      setBlock(x, y, (y == 0) ? null : getBlock(x, y-1));
  }
}

//-------------------------------------------------------------------------
// RENDERING
//-------------------------------------------------------------------------

var invalid = {};

function invalidate()         { invalid.court  = true; }
function invalidateNext()     { invalid.next   = true; }
function invalidateScore()    { invalid.score  = true; }
function invalidateRows()     { invalid.rows   = true; }

function draw() {
  drawCourt();
  drawNext();
  drawScore();
  drawRows();
}

function drawCourt() {
  if (invalid.court) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    if (playing)
      drawPiece(ctx, current.type, current.x, current.y, current.dir, dx, dy);
    var x, y, block;
    for(y = 0 ; y < ny ; y++) {
      for (x = 0 ; x < nx ; x++) {
        if (block = getBlock(x,y))
          drawBlock(ctx, x, y, block.color, dx, dy);
      }
    }
    invalid.court = false;
  }
}

// Koncluí: faint cell lines instead of the original boundary stroke (the canvas has its own border in CSS)
function drawGrid() {
  var n;
  ctx.beginPath();
  for(n = 1 ; n < nx ; n++) { ctx.moveTo(n*dx + 0.5, 0); ctx.lineTo(n*dx + 0.5, canvas.height); }
  for(n = 1 ; n < ny ; n++) { ctx.moveTo(0, n*dy + 0.5); ctx.lineTo(canvas.width, n*dy + 0.5); }
  ctx.strokeStyle = 'rgba(240, 245, 251, 0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawNext() {
  if (invalid.next) {
    var minx = 4, maxx = 0, miny = 4, maxy = 0;
    eachblock(next.type, 0, 0, next.dir, function(x, y) { // Koncluí: center the piece on its real bounding box
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    });
    uctx.clearRect(0, 0, ucanvas.width, ucanvas.height);
    drawPiece(uctx, next.type, (nu - (maxx - minx + 1)) / 2 - minx, (nu - (maxy - miny + 1)) / 2 - miny, next.dir, udx, udx);
    invalid.next = false;
  }
}

function drawScore() {
  if (invalid.score) {
    text('score', Math.floor(score).toLocaleString('pt-BR'));
    invalid.score = false;
  }
}

function drawRows() {
  if (invalid.rows) {
    text('rows', rows);
    invalid.rows = false;
  }
}

function drawPiece(ctx, type, x, y, dir, w, h) {
  eachblock(type, x, y, dir, function(x, y) {
    drawBlock(ctx, x, y, type.color, w, h);
  });
}

// Koncluí: a flat block with a light top edge and a dark bottom edge, so it reads on the dark court
function drawBlock(ctx, x, y, color, w, h) {
  var pad = Math.max(1, Math.round(w * 0.05)), edge = Math.max(2, Math.round(w * 0.14)),
      px = x*w + pad, py = y*h + pad, bw = w - 2*pad, bh = h - 2*pad;
  ctx.fillStyle = color;
  ctx.fillRect(px, py, bw, bh);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.fillRect(px, py, bw, edge);
  ctx.fillStyle = 'rgba(3, 5, 26, 0.28)';
  ctx.fillRect(px, py + bh - edge, bw, edge);
}

//-------------------------------------------------------------------------
// FINALLY, lets run the game
//-------------------------------------------------------------------------

run();

window.Tetris = {
  hooks: hooks, play: play, pause: pause, resume: resume, act: act, resize: resize, DIR: DIR,
  // read-only views for the page glue and the tests
  score: function() { return score; }, rows: function() { return rows; },
  state: function() { return playing ? (paused ? 'paused' : 'playing') : 'idle'; },
  running: function() { return !!loop; },
  piece: function() { return { x: current.x, y: current.y, dir: current.dir }; },
  court: function() { return { w: canvas.width, h: canvas.height, block: dx }; },
  // test hook: end the current game now with a given score
  forceLose: function(n) { if (!playing) play(); setScore(n); lose(); }
};

})();
