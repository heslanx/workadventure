// Breakout of Jake Gordon's javascript-breakout (https://github.com/jakesgordon/javascript-breakout), MIT license (see
// LICENSE). Koncluí changes, each marked "Koncluí" (and listed in ../VENDOR.md):
//   - palette from the platform; canvas fonts in px and sized by the court chunk (crisp at any pixel ratio);
//   - the frame loop runs only while a game is being played (menu, pause and game over repaint by hand);
//   - pause (P / Esc); mouse, pen and touch move the paddle (pointer events); every game starts at level 1;
//   - no sound, no level picker, no localStorage; the best score shown is the campus record (setRecord), and the page
//     glue is told about the end of a game (onGameOver), a pause (onpause), the level (onlevel) and the score (onscore);
//   - Esc no longer asks "Abandon game?" with a blocking confirm().

//=============================================================================
// Breakout
//=============================================================================

Breakout = {

  Defaults: {

    fps: 60,
    stats: false,

    score: {
      lives: {
        initial: 3,
        max: 5
      }
    },

    court: {
      xchunks: 30,
      ychunks: 25
    },

    ball: {
      radius:  0.3,
      speed:   15,
      labels: {
        3: { text: 'prontos...', fill: '#E8594E', stroke: '#03051A' },
        2: { text: 'atenção...', fill: '#F2C14B', stroke: '#03051A' },
        1: { text: 'vai!',       fill: '#53FFC8', stroke: '#03051A' }
      }
    },

    paddle: {
      width:  6,
      height: 1,
      speed:  20
    },

    color: {
      background: '#09182B',
      foreground: '#53FFC8',
      border:     '#09182B',
      wall:       '#182C41',
      ball:       '#F0F5FB',
      paddle:     '#53FFC8',
      score:      '#F0F5FB',
      highscore:  '#98A3B3'
    },

    state: {
      initial: 'menu',
      events: [
        { name: 'play',    from: 'menu', to: 'game' },
        { name: 'abandon', from: 'game', to: 'menu' },
        { name: 'lose',    from: 'game', to: 'menu' }
    ]},

    keys: [
      { keys: [Game.KEY.LEFT,  Game.KEY.A],      mode: 'down',  action: function() { this.paddle.moveLeft();          } },
      { keys: [Game.KEY.RIGHT, Game.KEY.D],      mode: 'down',  action: function() { this.paddle.moveRight();         } },
      { keys: [Game.KEY.LEFT,  Game.KEY.A],                     action: function() { this.paddle.stopMovingLeft();    } },
      { keys: [Game.KEY.RIGHT, Game.KEY.D],                     action: function() { this.paddle.stopMovingRight();   } },
      { keys: [Game.KEY.SPACE, Game.KEY.RETURN], state: 'menu', action: function() { this.play();                     } },
      { keys: [Game.KEY.SPACE, Game.KEY.RETURN], state: 'game', action: function() { this.paused ? this.pause() : this.ball.launchNow(); } },
      { keys: [Game.KEY.ESC,   Game.KEY.P],      state: 'game', action: function() { this.pause();                    } }
    ]

  },

  //-----------------------------------------------------------------------------

  initialize: function(runner, cfg) {
    this.cfg     = cfg;
    this.runner  = runner;
    this.width   = runner.width;
    this.height  = runner.height;
    this.color   = cfg.color;
    this.paused  = false;
    this.court   = Object.construct(Breakout.Court,  this, cfg.court);
    this.paddle  = Object.construct(Breakout.Paddle, this, cfg.paddle);
    this.ball    = Object.construct(Breakout.Ball,   this, cfg.ball);
    this.score   = Object.construct(Breakout.Score,  this, cfg.score);
  },

  onstartup: function() { // the event that fires the initial state transition occurs when Game.Runner constructs our StateMachine
    this.addEvents(); // Koncluí: the frame loop starts with a game (ongame), not here
  },

  addEvents: function() {
    Game.addEvent(this.runner.canvas, 'pointermove', this.onpointermove.bind(this));
    Game.addEvent(this.runner.canvas, 'pointerdown', this.onpointerdown.bind(this));
  },

  // Koncluí: the end of a game and the pause are told to whoever listens (the page glue)
  onGameOver: null,
  onpause:    null,
  onlevel:    null,
  onscore:    null,

  // Koncluí: pause / resume (the frame loop sleeps while paused)
  pause: function() {
    if (!this.is('game'))
      return;
    this.paused = !this.paused;
    if (this.paused)
      this.runner.stop();
    else
      this.runner.start();
    if (this.onpause)
      this.onpause(this.paused);
  },

  // Koncluí: the campus record, shown instead of the old localStorage high score
  setRecord: function(points) {
    this.score.highscore = points;
    this.score.rerender = true;
    if (!this.runner.handle)
      this.repaint();
  },

  // Koncluí: the brand font may arrive after the first frame; measure and paint the score bar again
  refont: function() {
    this.runner.initCanvas();
    this.repaint();
  },

  repaint: function() { // outside the frame loop (menu, pause, resize)
    if (this.ready)
      this.runner.draw();
  },

  update: function(dt) {
    this.court.update(dt);
    this.paddle.update(dt);
    this.ball.update(dt);
    this.score.update(dt);
  },

  draw: function(ctx) {
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.color.background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.court.draw(ctx);
    this.paddle.draw(ctx);
    this.ball.draw(ctx);
    this.score.draw(ctx);
    ctx.restore();
  },

  onresize: function(width, height) {
    this.width  = width;
    this.height = height;
    this.court.resize();
    this.paddle.reset();
    this.ball.reset(this.is && this.is('game') ? {launch: true} : undefined); // Koncluí: a game in progress relaunches
  },

  onmenu: function() {
    this.resetLevel();
    this.paddle.reset();
    this.ball.reset();
    this.refreshDOM();
    this.repaint();
  },

  ongame: function() {
    this.paused = false;
    this.refreshDOM();
    this.score.reset();
    this.ball.reset({launch: true});
    this.runner.start(); // Koncluí: the loop lives while a game is played
  },

  onlose: function() {
    if (this.onGameOver)
      this.onGameOver(this.score.score);
  },

  onleavegame: function() {
    this.runner.stop();
    this.paused = false;
    this.score.vscore = this.score.score; // the loop is gone: no more counting up, show the final score
    this.score.resetLives();
  },

  restart: function() { // Koncluí: "play again", also in the middle of a game
    if (this.is('game'))
      this.abandon();
    this.play();
  },

  loseBall: function() {
    if (this.score.loseLife())
      this.lose();
    else {
      this.ball.reset({launch: true});
    }
  },

  winLevel: function() {
    this.score.gainLife();
    this.nextLevel();
    this.ball.reset({launch: true});
  },

  hitBrick: function(brick) {
    this.court.remove(brick);
    this.score.increase(brick.score);
    this.ball.speed += 10 * (1 - (this.ball.speed / this.ball.maxspeed)); // decay curve - speed increases less the faster the ball is (otherwise game becomes impossible)
    if (this.court.empty())
      this.winLevel();
  },

  resetLevel: function() { this.setLevel(0); }, // Koncluí: every game starts at level 1
  setLevel: function(level) {
    level = level < Breakout.Levels.length ? level : 0;
    this.court.reset(level);
    this.level = level;
    this.refreshDOM();
  },

  nextLevel: function() { this.setLevel(this.level + 1); },

  initCanvas: function(ctx) { // called by Game.Runner whenever the canvas is reset (on init and on resize)
    ctx.fillStyle    = this.color.foreground;
    ctx.strokeStyle  = this.color.foreground;
    ctx.lineWidth    = 1;
    this.score.measure(ctx);  // score needs to measure itself
    this.ready = true;
  },

  refreshDOM: function() {
    if (this.onlevel)
      this.onlevel(this.level + 1);
  },

  // Koncluí: mouse, pen and touch move the paddle; a press launches the ball without waiting for the countdown
  onpointermove: function(ev) {
    if (this.is('game') && !this.paused)
      this.paddle.place(this.runner.canvasX(ev.clientX) - this.paddle.w/2);
  },

  onpointerdown: function(ev) {
    if (this.is('game') && !this.paused)
      this.ball.launchNow();
  },

  //=============================================================================

  Score: {

    initialize: function(game, cfg) {
      this.game = game;
      this.cfg  = cfg;
      this.load();
      this.reset();
    },

    reset:    function()  { this.set(0); this.resetLives(); },
    set:      function(n) { this.score = this.vscore = n; this.rerender = true; this.changed(); },
    increase: function(n) { this.score = this.score + n;  this.rerender = true; this.changed(); },
    changed:  function()  { if (this.game.onscore) this.game.onscore(this.score); }, // Koncluí: tells the page glue
    format:   function(n) { return ("0000000" + n).slice(-7); },
    load:     function()  { this.highscore = 0; }, // Koncluí: the campus record, set by the page through Breakout.setRecord

    resetLives: function()  { this.setLives(this.cfg.lives.initial);                       }, 
    setLives:   function(n) { this.lives = n; this.rerender = true;                        },
    gainLife:   function()  { this.setLives(Math.min(this.cfg.lives.max, this.lives + 1)); },
    loseLife:   function()  { this.setLives(this.lives-1); return (this.lives == 0);       },
 
    update: function(dt) {
      if (this.vscore < this.score) {
        this.vscore = Math.min(this.score, this.vscore + 10);
        this.rerender = true;
      }
    },

    measure: function(ctx) {
      this.left   = this.game.court.left;
      this.top    = this.game.court.top - this.game.court.wall.size*2;
      this.width  = this.game.court.width;
      this.height = this.game.court.wall.size*2;
      this.scorefont = "800 " + Math.round(this.game.court.wall.size * 1.05) + "px Urbanist, Arial, sans-serif"; // Koncluí: px, brand font
      this.highfont  = "700 " + Math.round(this.game.court.wall.size * 0.8)  + "px Urbanist, Arial, sans-serif";
      ctx.save();
      ctx.font = this.scorefont;
      this.scorewidth = ctx.measureText(this.format(0)).width;
      ctx.font = this.highfont;
      this.highwidth  = ctx.measureText("RECORDE " + this.format(0)).width;
      ctx.restore();
      this.rerender = true;
    },

    draw: function(ctx) {
      if (this.rerender) {
        this.canvas = Game.renderToCanvas(this.width, this.height, this.render.bind(this), this.canvas);
        this.rerender = false;
      }
      ctx.drawImage(this.canvas, this.left, this.top);
    },

    render: function(ctx) {
      var text, width, paddle;
      var ishigh = this.game.is('game') && (this.score > this.highscore);

      ctx.textBaseline = "middle";
      ctx.fillStyle    = this.game.color.score;
      ctx.font         = this.scorefont;
      text             = this.format(this.vscore);
      ctx.fillText(text, 0, this.height/2);

      ctx.fillStyle = ishigh ? this.game.color.score : this.game.color.highscore;
      text          = "RECORDE " + this.format(ishigh ? this.score : this.highscore);
      ctx.font      = this.highfont;
      width         = ctx.measureText(text).width;
      ctx.fillText(text, this.width - width, this.height/2);

      paddle = {
        game: this.game,
        w:    this.game.court.chunk * 1.5,
        h:    this.game.court.chunk * 2/3
      }
      ctx.translate(this.scorewidth + 20, (this.height-paddle.h) / 2);
      for(var n = 0 ; n < this.lives ; n++) {
        this.game.paddle.render.call(paddle, ctx);
        ctx.translate(paddle.w + 5, 0);
      }

    }

  },

  //=============================================================================

  Court: {

    initialize: function(game, cfg) {
      this.game = game;
      this.cfg  = cfg;
    },
    
    reset: function(level) {
      var layout = Breakout.Levels[level];
      var line, brick, score, c, n, x, y, nx, ny = Math.min(layout.bricks.length, this.cfg.ychunks);
      this.bricks = [];
      for(y = 0 ; y < ny ; y++) {
        score = (this.cfg.ychunks - y) * 5;
        line  = layout.bricks[y] + " "; // extra space simplifies loop
        brick = null;
        nx = Math.min(line.length, this.cfg.xchunks + 1);
        for(x = 0 ; x < nx ; x++) {
          c = line[x];
          if (brick && (brick.c == c)) {
            brick.pos.x2 = x;
          }
          else if (brick && (brick.c != c)) {
             this.bricks.push(brick);
            brick = null;
          }

          if (!brick && (c != ' '))
            brick = { isbrick: true, hit: false, c: c, pos: { x1: x, x2: x, y: y }, score: score, color: layout.colors[c.toLowerCase()] };
        }
      }
      this.numbricks = this.bricks.length;
      this.numhits   = 0;
      this.resize();
    },

    resize: function() {

      this.chunk  = Math.floor(Math.min(this.game.width / (this.cfg.xchunks + 2), this.game.height / (this.cfg.ychunks + 4))); // Koncluí: room for court plus a 1 chunk wall either side and the 2 chunk score bar on top (the page sizes the canvas 32:29)
      this.width  = this.cfg.xchunks * this.chunk;
      this.height = this.cfg.ychunks * this.chunk;
      this.left   = Math.floor((this.game.width  - this.width)  / 2);
      this.top    = Math.floor((this.game.height - this.height) / 2);
      this.right  = this.left + this.width;
      this.bottom = this.top  + this.height;

      this.wall = {}
      this.wall.size  = this.chunk;
      this.wall.top   = Game.Math.bound({x: this.left - this.wall.size, y: this.top - this.wall.size*2, w: this.width + this.wall.size*2, h: this.wall.size*2               });
      this.wall.left  = Game.Math.bound({x: this.left - this.wall.size, y: this.top - this.wall.size*2, w: this.wall.size,                h: this.wall.size*2 + this.height });
      this.wall.right = Game.Math.bound({x: this.right,                 y: this.top - this.wall.size*2, w: this.wall.size,                h: this.wall.size*2 + this.height });

      for(n = 0 ; n < this.numbricks ; n++) {
        brick = this.bricks[n];
        brick.x = this.left + (brick.pos.x1 * this.chunk);
        brick.y = this.top  + (brick.pos.y  * this.chunk);
        brick.w = (brick.pos.x2 - brick.pos.x1 + 1) * this.chunk;
        brick.h = this.chunk;
        Game.Math.bound(brick);
      }

      this.rerender = true;
    },

    update: function(dt) {
    },

    draw: function(ctx) {
      if (this.rerender) {
        this.canvas = Game.renderToCanvas(this.game.width, this.game.height, this.render.bind(this), this.canvas);
        this.rerender = false;
      }
      ctx.drawImage(this.canvas, 0, 0);
    },

    render: function(ctx) {
      var n, brick;

      ctx.strokeStyle = this.game.color.border;
      ctx.lineWidth = Math.max(1, Math.round(this.chunk / 10)); // Koncluí: scales with the court
      for(n = 0 ; n < this.numbricks ; n++) {
        brick = this.bricks[n];
        if (!brick.hit) {
          ctx.fillStyle = brick.color;
          ctx.fillRect(brick.x, brick.y, brick.w, brick.h); 
          ctx.strokeRect(brick.x, brick.y, brick.w, brick.h);
        }
      }

      ctx.fillStyle = this.game.color.wall;
      ctx.lineWidth = Math.max(2, Math.round(this.chunk / 6));
      ctx.beginPath();
      ctx.moveTo(this.wall.top.left,     this.wall.top.top);
      ctx.lineTo(this.wall.top.right,    this.wall.top.top);
      ctx.lineTo(this.wall.top.right,    this.wall.right.bottom);
      ctx.lineTo(this.wall.right.left,   this.wall.right.bottom);
      ctx.lineTo(this.wall.right.left,   this.wall.top.bottom);
      ctx.lineTo(this.wall.left.right,   this.wall.top.bottom);
      ctx.lineTo(this.wall.left.right,   this.wall.left.bottom);
      ctx.lineTo(this.wall.left.left,    this.wall.left.bottom);
      ctx.lineTo(this.wall.top.left,     this.wall.top.top);
      ctx.fill();
      ctx.stroke();
      ctx.closePath();
    },

    remove: function(brick) {
      brick.hit = true;
      this.numhits++;
      this.rerender = true;
    },

    empty: function() {
      return (this.numhits == this.numbricks);
    }

  },

  //=============================================================================

  Ball: {

    initialize: function(game, cfg) {
      this.game = game;
      this.cfg  = cfg;
    },

    reset: function(options) {
      this.radius   = this.cfg.radius * this.game.court.chunk;
      this.speed    = this.cfg.speed  * this.game.court.chunk;
      this.maxspeed = this.speed * 1.5;
      this.color    = this.game.color.ball;
      this.moveToPaddle();
      this.setdir(0, 0);
      this.clearLaunch();
      this.hitTargets = [
        this.game.paddle,
        this.game.court.wall.top,
        this.game.court.wall.left,
        this.game.court.wall.right,
      ].concat(this.game.court.bricks);
      if (options && options.launch)
        this.launch();
    },

    moveToPaddle: function() {
      this.setpos(this.game.paddle.left + (this.game.paddle.w/2), this.game.court.bottom - this.game.paddle.h - this.radius);
    },

    setpos: function(x, y) {
      this.x = x;
      this.y = y;
      Game.Math.bound(this);
    },

    setdir: function(dx, dy) {
      var dir = Game.Math.normalize({ x: dx, y: dy });
      this.dx = dir.x;
      this.dy = dir.y;
      this.moving = dir.m != 0;
    },

    launch: function() {
      if (!this.moving || this.countdown) {
        this.countdown = (typeof this.countdown == 'undefined') || (this.countdown == null) ? 3 : this.countdown - 1;
        if (this.countdown > 0) {
          this.label = this.launchLabel(this.countdown);
          this.delayTimer = setTimeout(this.launch.bind(this), 1000);
          if (this.countdown == 1)
            this.setdir(1, -1); // launch on 'go'
        }
        else {
          this.clearLaunch();
        }
      }
    },

    launchNow: function() { // <space> key can override countdown launch
      if (!this.moving) {
        this.clearLaunch();
        this.setdir(1, -1);
      }
    },

    launchLabel: function(count) {
      var label       = this.cfg.labels[count];
      var ctx         = this.game.runner.front2d; // dodgy getting the context this way, should probably have a Game.Runner.ctx() method ?
      ctx.save();
      label.font      = "800 " + Math.round(this.game.court.chunk * 2) + "px Urbanist, Arial, sans-serif"; // Koncluí
      ctx.font        = label.font;
      ctx.fillStyle   = label.fill;
      ctx.strokeStyle = label.stroke;
      ctx.lineWidth   = 0.5;
      var width       = ctx.measureText(label.text).width;
      ctx.restore();
      label.x         = this.game.court.left +   (this.game.court.width - width)/2;
      label.y         = this.game.paddle.top - this.game.court.chunk * 4;
      return label;
    },

    clearLaunch: function() {
      if (this.delayTimer) {
        clearTimeout(this.delayTimer);
        this.delayTimer = this.label = this.countdown = null;
      }
    },

    update: function(dt) {

      if (!this.moving)
        return this.moveToPaddle();

      var p2 = Game.Math.move(this.x, this.y, this.dx * this.speed, this.dy * this.speed, dt);

      var mCurrent, mClosest = Infinity, point, item, closest = null;
      for (var n = 0 ; n < this.hitTargets.length ; n++) {
        item = this.hitTargets[n];
        if (!item.hit) {
          point = Game.Math.ballIntercept(this, item, p2.nx, p2.ny);
          if (point) {
            mCurrent = Game.Math.magnitude(point.x - this.x, point.y - this.y);
            if (mCurrent < mClosest) {
              mClosest = mCurrent;
              closest = {item: item, point: point};
            }
          }
        }
      }

      if (closest) {

        if (closest.item.isbrick) {
          this.game.hitBrick(closest.item);
          if (!this.moving) // if hitBrick caused game to end we dont want to continue updating our state
            return;
        }

        if ((closest.item == this.game.paddle) && (closest.point.d == 'top')) {
          p2.dx = this.speed * (closest.point.x - (this.game.paddle.left + this.game.paddle.w/2)) / (this.game.paddle.w/2);
        }

        this.setpos(closest.point.x, closest.point.y);

        switch(closest.point.d) {
          case 'left':
          case 'right':
            this.setdir(-p2.dx, p2.dy);
            break;

          case 'top':
          case 'bottom':
            this.setdir(p2.dx, -p2.dy);
            break;
        }

        var udt = dt * (mClosest / Game.Math.magnitude(p2.nx, p2.ny)); // how far along did we get before intercept ?
        return this.update(dt - udt);                                  // so we can update for time remaining
      }

      if ((p2.x < 0) || (p2.y < 0) || (p2.x > this.game.width) || (p2.y > this.game.height)) {
        this.game.loseBall();
      }
      else {
        this.setpos(p2.x,  p2.y);
        this.setdir(p2.dx, p2.dy);
      }

    },

    draw: function(ctx) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Game.THREESIXTY, true);
      ctx.fill();
      ctx.stroke();
      ctx.closePath();

      if (this.label) {
        ctx.font = this.label.font;
        ctx.fillStyle = this.label.fill;
        ctx.strokeStyle = this.label.stroke;
        ctx.lineWidth = 0.5;
        ctx.fillText(this.label.text,   this.label.x, this.label.y);
        ctx.strokeText(this.label.text, this.label.x, this.label.y);
      }
    }

  },

  //=============================================================================

  Paddle: {
    initialize: function(game, cfg) {
      this.game = game;
      this.cfg  = cfg;
    },

    reset: function() {
      this.speed  = this.cfg.speed  * this.game.court.chunk;
      this.w      = this.cfg.width  * this.game.court.chunk;
      this.h      = this.cfg.height * this.game.court.chunk;
      this.minX   = this.game.court.left;
      this.maxX   = this.game.court.right - this.w;
      this.setpos(Game.random(this.minX, this.maxX), this.game.court.bottom - this.h);
      this.setdir(0);
      this.rerender = true;
    },

    setpos: function(x, y) {
      this.x      = x;
      this.y      = y;
      Game.Math.bound(this);
    },

    setdir: function(dx) {
      this.dleft  = (dx < 0 ? -dx : 0);
      this.dright = (dx > 0 ?  dx : 0);
    },

    place: function(x) {
      this.setpos(Math.min(this.maxX, Math.max(this.minX, x)), this.y);
    },

    update: function(dt) {
      var amount = this.dright - this.dleft;
      if (amount != 0)
        this.place(this.x + (amount * dt * this.speed));
    },

    draw: function(ctx) {
      if (this.rerender) {
        this.canvas = Game.renderToCanvas(this.w, this.h, this.render.bind(this));
        this.rerender = false;
      }
      ctx.drawImage(this.canvas, this.x, this.y);
    },

    render: function(ctx) {

      var gradient = ctx.createLinearGradient(0, this.h, 0, 0);
      gradient.addColorStop(0.36, '#19B5A5'); // Koncluí: mint ramp instead of orange
      gradient.addColorStop(0.68, '#3BD1A0');
      gradient.addColorStop(0.84, '#7DFFD6');

      var r = this.h/2;

      ctx.fillStyle = gradient;
      ctx.strokeStyle = this.game.color.border;
      ctx.beginPath();
      ctx.moveTo(r,  0);
      ctx.lineTo(this.w - r, 0);
      ctx.arcTo(this.w, 0, this.w, r, r);
      ctx.lineTo(this.w, this.h - r);
      ctx.arcTo(this.w, this.h, this.w - r, this.h, r);
      ctx.lineTo(r, this.h);
      ctx.arcTo(0, this.h, 0, this.h - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.fill();
      ctx.stroke();
      ctx.closePath();

    },

    moveLeft:        function() { this.dleft  = 1; },
    moveRight:       function() { this.dright = 1; },  
    stopMovingLeft:  function() { this.dleft  = 0; },
    stopMovingRight: function() { this.dright = 0; }

  }

  //=============================================================================

}; // Breakout

