//=============================================================================
// PONG
//
// Koncluí: javascript-pong/pong.js (Jake Gordon, MIT) turned into "you against the Koru".
// Kept as is: Paddle (including the whole AI: predict, reaction, error), Ball physics, Helper, rubber-band difficulty.
// Changed (marked "Koncluí"): one human (left) against the Koru (right) up to 7 points, platform palette, pointer and
// touch control, serve pause, pause, hooks for the page glue; menu, images, sounds, stats, footprints and
// predictions removed.
//=============================================================================

Pong = {

  Defaults: {
    width:        640,   // logical canvas width (the page scales the canvas, the game always draws in these units)
    height:       480,   // logical canvas height (ditto)
    wallWidth:    12,
    paddleWidth:  12,
    paddleHeight: 60,
    paddleSpeed:  1.6,   // Koncluí: crosses the court vertically in 1.6 seconds (was 2)
    ballSpeed:    3,     // Koncluí: crosses the court horizontally in 3 seconds at starting speed (was 4) ...
    ballAccel:    10,    // ... but accelerates as time passes (was 8)
    ballRadius:   5,
    winScore:     7,     // Koncluí: first to 7 (was 9)
    serveWait:    0.8    // Koncluí: seconds the ball waits before each serve
  },

  Colors: {                // Koncluí: platform palette; the Koru wears her own orange
    walls:     '#3E4858',
    midline:   '#2D3746',
    ball:      '#F0F5FB',
    you:       '#53FFC8',
    koru:      '#F79730',
    label:     '#B4BDCC'
  },

  Levels: [
    {aiReaction: 0.2, aiError:  40}, // 0:  ai is losing by 8
    {aiReaction: 0.3, aiError:  50}, // 1:  ai is losing by 7
    {aiReaction: 0.4, aiError:  60}, // 2:  ai is losing by 6
    {aiReaction: 0.5, aiError:  70}, // 3:  ai is losing by 5
    {aiReaction: 0.6, aiError:  80}, // 4:  ai is losing by 4
    {aiReaction: 0.7, aiError:  90}, // 5:  ai is losing by 3
    {aiReaction: 0.8, aiError: 100}, // 6:  ai is losing by 2
    {aiReaction: 0.9, aiError: 110}, // 7:  ai is losing by 1
    {aiReaction: 1.0, aiError: 120}, // 8:  tie
    {aiReaction: 1.1, aiError: 130}, // 9:  ai is winning by 1
    {aiReaction: 1.2, aiError: 140}, // 10: ai is winning by 2
    {aiReaction: 1.3, aiError: 150}, // 11: ai is winning by 3
    {aiReaction: 1.4, aiError: 160}, // 12: ai is winning by 4
    {aiReaction: 1.5, aiError: 170}, // 13: ai is winning by 5
    {aiReaction: 1.6, aiError: 180}, // 14: ai is winning by 6
    {aiReaction: 1.7, aiError: 190}, // 15: ai is winning by 7
    {aiReaction: 1.8, aiError: 200}  // 16: ai is winning by 8
  ],

  //-----------------------------------------------------------------------------

  initialize: function(runner, cfg) {
    this.cfg         = cfg;
    this.runner      = runner;
    this.width       = runner.width;
    this.height      = runner.height;
    this.playing     = false;
    this.paused      = false;
    this.winner      = null;
    this.wait        = 0;
    this.scores      = [0, 0];
    this.yourName    = 'Você';
    this.koru        = new Image(); // Koncluí: the Koru's badge next to her score
    this.koru.onload = function() { if (!this.runner.handle) this.runner.draw(); }.bind(this);
    this.koru.src    = KG.asset('koru.png');
    this.court       = Object.construct(Pong.Court,  this);
    this.leftPaddle  = Object.construct(Pong.Paddle, this);
    this.rightPaddle = Object.construct(Pong.Paddle, this, true);
    this.ball        = Object.construct(Pong.Ball,   this);
    this.ball.reset();
  },

  // Koncluí: always you (left, human) against the Koru (right, ai)
  start: function() {
    this.scores  = [0, 0];
    this.playing = true;
    this.paused  = false;
    this.winner  = null;
    this.leftPaddle.reset();
    this.rightPaddle.reset();
    this.leftPaddle.setAuto(false);
    this.rightPaddle.setAuto(true, this.level(1));
    this.rightPaddle.setLevel(this.level(1));
    this.ball.reset();
    this.wait = this.cfg.serveWait;
    this.runner.start();
    if (this.onplay)  this.onplay();
    if (this.onscore) this.onscore(this.scores[0], this.scores[1]);
  },

  // Koncluí: the game ended, by points or because the page asked for it (winner: 0 = you, 1 = the Koru)
  finish: function(winner) {
    this.playing = false;
    this.paused  = false;
    this.winner  = winner;
    this.leftPaddle.setAuto(false);
    this.rightPaddle.setAuto(false);
    this.runner.draw(); // last frame, then the loop sleeps
    this.runner.stop();
    if (this.ongameover) this.ongameover(this.scores[0], this.scores[1]);
  },

  // Koncluí: pause / resume (the frame loop sleeps while paused)
  pause: function() {
    if (!this.playing) return;
    this.paused = !this.paused;
    this.leftPaddle.stopMovingUp();
    this.leftPaddle.stopMovingDown();
    if (this.paused) { this.runner.draw(); this.runner.stop(); }
    else this.runner.start();
    if (this.onpause) this.onpause(this.paused);
  },

  level: function(playerNo) {
    var n = 8 + (this.scores[playerNo] - this.scores[playerNo ? 0 : 1]);
    return Math.max(0, Math.min(Pong.Levels.length - 1, n)); // Koncluí: clamped, the table has 17 levels
  },

  goal: function(playerNo) {
    this.scores[playerNo] += 1;
    if (this.onscore) this.onscore(this.scores[0], this.scores[1]);
    if (this.scores[playerNo] >= this.cfg.winScore) {
      this.finish(playerNo);
    }
    else {
      this.ball.reset(playerNo);
      this.wait = this.cfg.serveWait;
      this.leftPaddle.setLevel(this.level(0));
      this.rightPaddle.setLevel(this.level(1));
    }
  },

  update: function(dt) {
    this.leftPaddle.update(dt, this.ball);
    this.rightPaddle.update(dt, this.ball);
    if (this.wait > 0) { // Koncluí: the ball waits a moment before every serve
      this.wait -= dt;
      return;
    }
    if (this.playing) {
      this.ball.update(dt, this.leftPaddle, this.rightPaddle);

      if (this.ball.left > this.width)
        this.goal(0);
      else if (this.ball.right < 0)
        this.goal(1);
    }
  },

  draw: function(ctx) {
    this.court.draw(ctx, this.scores[0], this.scores[1]);
    this.drawLabels(ctx);
    this.leftPaddle.draw(ctx);
    this.rightPaddle.draw(ctx);
    if (this.playing)
      this.ball.draw(ctx);
  },

  // Koncluí: who is who: your name under your score, the Koru's badge and name under hers
  drawLabels: function(ctx) {
    var y = 6 * this.cfg.wallWidth + 26, w = this.width;
    ctx.font = '700 14px Urbanist, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    var name = this.yourName;
    while (name.length > 3 && ctx.measureText(name).width > w / 2 - 70) name = name.slice(0, -2) + '…';
    ctx.fillStyle = Pong.Colors.you;
    ctx.fillText(name, w / 4, y);
    var badge = this.koru.complete && this.koru.naturalWidth ? 32 : 0, gap = badge ? 6 : 0, label = ctx.measureText('Koru').width;
    var left = 3 * w / 4 - (badge + gap + label) / 2; // badge + name, centered on her half
    if (badge)
      ctx.drawImage(this.koru, left, y - 22, badge, 30);
    ctx.fillStyle = Pong.Colors.koru;
    ctx.textAlign = 'left';
    ctx.fillText('Koru', left + badge + gap, y);
  },

  // Koncluí: keyboard (W/S or arrows), pointer (aim) and the page's buttons all end up here
  onkeydown: function(keyCode) {
    switch(keyCode) {
      case Game.KEY.SPACE:
      case Game.KEY.RETURN: if (!this.playing) this.start(); else if (this.paused) this.pause(); break;
      case Game.KEY.ESC:
      case Game.KEY.P:      this.pause(); break;
      case Game.KEY.W:
      case Game.KEY.UP:     this.leftPaddle.targetY = null; this.leftPaddle.moveUp();    break;
      case Game.KEY.S:
      case Game.KEY.DOWN:   this.leftPaddle.targetY = null; this.leftPaddle.moveDown();  break;
    }
  },

  onkeyup: function(keyCode) {
    switch(keyCode) {
      case Game.KEY.W:
      case Game.KEY.UP:   this.leftPaddle.stopMovingUp();    break;
      case Game.KEY.S:
      case Game.KEY.DOWN: this.leftPaddle.stopMovingDown();  break;
    }
  },

  //=============================================================================
  // COURT
  //=============================================================================

  Court: {

    initialize: function(pong) {
      var w  = pong.width;
      var h  = pong.height;
      var ww = pong.cfg.wallWidth;

      this.ww    = ww;
      this.walls = [];
      this.walls.push({x: 0, y: 0,      width: w, height: ww, color: Pong.Colors.walls});
      this.walls.push({x: 0, y: h - ww, width: w, height: ww, color: Pong.Colors.walls});
      var nMax = (h / (ww*2));
      for(var n = 0 ; n < nMax ; n++) { // draw dashed halfway line
        this.walls.push({x: (w / 2) - (ww / 2), 
                         y: (ww / 2) + (ww * 2 * n), 
                         width: ww, height: ww, color: Pong.Colors.midline});
      }

      var sw = 3*ww;
      var sh = 4*ww;
      this.score1 = {x: 0.5 + (w/2) - 1.5*ww - sw, y: 2*ww, w: sw, h: sh};
      this.score2 = {x: 0.5 + (w/2) + 1.5*ww,      y: 2*ww, w: sw, h: sh};
    },

    draw: function(ctx, scorePlayer1, scorePlayer2) {
      for(var n = 0 ; n < this.walls.length ; n++) {
        ctx.fillStyle = this.walls[n].color; // Koncluí: rails and dashes in their own colors
        ctx.fillRect(this.walls[n].x, this.walls[n].y, this.walls[n].width, this.walls[n].height);
      }
      this.drawDigit(ctx, scorePlayer1, this.score1.x, this.score1.y, this.score1.w, this.score1.h, Pong.Colors.you);
      this.drawDigit(ctx, scorePlayer2, this.score2.x, this.score2.y, this.score2.w, this.score2.h, Pong.Colors.koru);
    },

    drawDigit: function(ctx, n, x, y, w, h, color) {
      ctx.fillStyle = color;
      var dw = this.ww*4/5, dh = dw;
      var blocks = Pong.Court.DIGITS[n];
      if (blocks[0])
        ctx.fillRect(x, y, w, dh);
      if (blocks[1])
        ctx.fillRect(x, y, dw, h/2);
      if (blocks[2])
        ctx.fillRect(x+w-dw, y, dw, h/2);
      if (blocks[3])
        ctx.fillRect(x, y + h/2 - dh/2, w, dh);
      if (blocks[4])
        ctx.fillRect(x, y + h/2, dw, h/2);
      if (blocks[5])
        ctx.fillRect(x+w-dw, y + h/2, dw, h/2);
      if (blocks[6])
        ctx.fillRect(x, y+h-dh, w, dh);
    },

    DIGITS: [
      [1, 1, 1, 0, 1, 1, 1], // 0
      [0, 0, 1, 0, 0, 1, 0], // 1
      [1, 0, 1, 1, 1, 0, 1], // 2
      [1, 0, 1, 1, 0, 1, 1], // 3
      [0, 1, 1, 1, 0, 1, 0], // 4
      [1, 1, 0, 1, 0, 1, 1], // 5
      [1, 1, 0, 1, 1, 1, 1], // 6
      [1, 0, 1, 0, 0, 1, 0], // 7
      [1, 1, 1, 1, 1, 1, 1], // 8
      [1, 1, 1, 1, 0, 1, 0]  // 9
    ]

  },

  //=============================================================================
  // PADDLE
  //=============================================================================

  Paddle: {

    initialize: function(pong, rhs) {
      this.pong   = pong;
      this.width  = pong.cfg.paddleWidth;
      this.height = pong.cfg.paddleHeight;
      this.minY   = pong.cfg.wallWidth;
      this.maxY   = pong.height - pong.cfg.wallWidth - this.height;
      this.speed  = (this.maxY - this.minY) / pong.cfg.paddleSpeed;
      this.rhs    = !!rhs;
      this.reset();
    },

    // Koncluí: back to the middle of its side (start of a game)
    reset: function() {
      this.setpos(this.rhs ? this.pong.width - this.width : 0, this.minY + (this.maxY - this.minY)/2);
      this.setdir(0);
      this.targetY    = null;
      this.prediction = null;
    },

    // Koncluí: pointer control: the paddle's center chases y (court units) at twice its keyboard speed
    aim: function(y) {
      this.targetY = Math.max(this.minY, Math.min(this.maxY, y - this.height/2));
    },

    setpos: function(x, y) {
      this.x      = x;
      this.y      = y;
      this.left   = this.x;
      this.right  = this.left + this.width;
      this.top    = this.y;
      this.bottom = this.y + this.height;
    },

    setdir: function(dy) {
      this.up   = (dy < 0 ? -dy : 0);
      this.down = (dy > 0 ?  dy : 0);
    },

    setAuto: function(on, level) {
      if (on && !this.auto) {
        this.auto = true;
        this.setLevel(level);
      }
      else if (!on && this.auto) {
        this.auto = false;
        this.setdir(0);
      }
    },

    setLevel: function(level) {
      if (this.auto)
        this.level = Pong.Levels[level];
    },

    update: function(dt, ball) {
      if (this.auto)
        this.ai(dt, ball);

      var amount = this.down - this.up, speed = this.speed;
      if (!this.auto && this.targetY !== null) { // Koncluí: chasing the pointer; up/down still tell the ball which way the paddle moves (spin)
        var gap = this.targetY - this.y;
        speed  = this.speed * 2;
        amount = Math.abs(gap) < 1 ? 0 : (gap < 0 ? -1 : 1);
        if (Math.abs(gap) < speed * dt) { speed = Math.abs(gap) / dt; }
        this.up = (amount < 0 ? 1 : 0);
        this.down = (amount > 0 ? 1 : 0);
      }
      if (amount != 0) {
        var y = this.y + (amount * dt * speed);
        if (y < this.minY)
          y = this.minY;
        else if (y > this.maxY)
          y = this.maxY;
        this.setpos(this.x, y);
      }
    },

    ai: function(dt, ball) {
      if (((ball.x < this.left) && (ball.dx < 0)) ||
          ((ball.x > this.right) && (ball.dx > 0))) {
        this.stopMovingUp();
        this.stopMovingDown();
        return;
      }

      this.predict(ball, dt);

      if (this.prediction) {
        if (this.prediction.y < (this.top + this.height/2 - 5)) {
          this.stopMovingDown();
          this.moveUp();
        }
        else if (this.prediction.y > (this.bottom - this.height/2 + 5)) {
          this.stopMovingUp();
          this.moveDown();
        }
        else {
          this.stopMovingUp();
          this.stopMovingDown();
        }
      }
    },

    predict: function(ball, dt) {
      // only re-predict if the ball changed direction, or its been some amount of time since last prediction
      if (this.prediction &&
          ((this.prediction.dx * ball.dx) > 0) &&
          ((this.prediction.dy * ball.dy) > 0) &&
          (this.prediction.since < this.level.aiReaction)) {
        this.prediction.since += dt;
        return;
      }

      var pt  = Pong.Helper.ballIntercept(ball, {left: this.left, right: this.right, top: -10000, bottom: 10000}, ball.dx * 10, ball.dy * 10);
      if (pt) {
        var t = this.minY + ball.radius;
        var b = this.maxY + this.height - ball.radius;

        while ((pt.y < t) || (pt.y > b)) {
          if (pt.y < t) {
            pt.y = t + (t - pt.y);
          }
          else if (pt.y > b) {
            pt.y = t + (b - t) - (pt.y - b);
          }
        }
        this.prediction = pt;
      }
      else {
        this.prediction = null;
      }

      if (this.prediction) {
        this.prediction.since = 0;
        this.prediction.dx = ball.dx;
        this.prediction.dy = ball.dy;
        this.prediction.radius = ball.radius;
        this.prediction.exactX = this.prediction.x;
        this.prediction.exactY = this.prediction.y;
        var closeness = (ball.dx < 0 ? ball.x - this.right : this.left - ball.x) / this.pong.width;
        var error = this.level.aiError * closeness;
        this.prediction.y = this.prediction.y + Game.random(-error, error);
      }
    },

    draw: function(ctx) {
      ctx.fillStyle = this.rhs ? Pong.Colors.koru : Pong.Colors.you; // Koncluí: yours is mint, the Koru's is orange
      ctx.fillRect(this.x, this.y, this.width, this.height);
    },

    moveUp:         function() { this.up   = 1; },
    moveDown:       function() { this.down = 1; },
    stopMovingUp:   function() { this.up   = 0; },
    stopMovingDown: function() { this.down = 0; }

  },

  //=============================================================================
  // BALL
  //=============================================================================

  Ball: {

    initialize: function(pong) {
      this.pong    = pong;
      this.radius  = pong.cfg.ballRadius;
      this.minX    = this.radius;
      this.maxX    = pong.width - this.radius;
      this.minY    = pong.cfg.wallWidth + this.radius;
      this.maxY    = pong.height - pong.cfg.wallWidth - this.radius;
      this.speed   = (this.maxX - this.minX) / pong.cfg.ballSpeed;
      this.accel   = pong.cfg.ballAccel;
    },

    reset: function(playerNo) {
      this.setpos(playerNo == 1 ?   this.maxX : this.minX,  Game.random(this.minY, this.maxY));
      this.setdir(playerNo == 1 ? -this.speed : this.speed, this.speed);
    },

    setpos: function(x, y) {
      this.x      = x;
      this.y      = y;
      this.left   = this.x - this.radius;
      this.top    = this.y - this.radius;
      this.right  = this.x + this.radius;
      this.bottom = this.y + this.radius;
    },

    setdir: function(dx, dy) {
      this.dxChanged = ((this.dx < 0) != (dx < 0)); // did horizontal direction change
      this.dyChanged = ((this.dy < 0) != (dy < 0)); // did vertical direction change
      this.dx = dx;
      this.dy = dy;
    },

    update: function(dt, leftPaddle, rightPaddle) {

      var pos = Pong.Helper.accelerate(this.x, this.y, this.dx, this.dy, this.accel, dt);

      if ((pos.dy > 0) && (pos.y > this.maxY)) {
        pos.y = this.maxY;
        pos.dy = -pos.dy;
      }
      else if ((pos.dy < 0) && (pos.y < this.minY)) {
        pos.y = this.minY;
        pos.dy = -pos.dy;
      }

      var paddle = (pos.dx < 0) ? leftPaddle : rightPaddle;
      var pt     = Pong.Helper.ballIntercept(this, paddle, pos.nx, pos.ny);

      if (pt) {
        switch(pt.d) {
          case 'left':
          case 'right':
            pos.x = pt.x;
            pos.dx = -pos.dx;
            break;
          case 'top':
          case 'bottom':
            pos.y = pt.y;
            pos.dy = -pos.dy;
            break;
        }

        // add/remove spin based on paddle direction
        if (paddle.up)
          pos.dy = pos.dy * (pos.dy < 0 ? 0.5 : 1.5);
        else if (paddle.down)
          pos.dy = pos.dy * (pos.dy > 0 ? 0.5 : 1.5);
      }

      this.setpos(pos.x,  pos.y);
      this.setdir(pos.dx, pos.dy);
    },

    draw: function(ctx) {
      var w = this.radius * 2;
      ctx.fillStyle = Pong.Colors.ball;
      ctx.fillRect(this.x - this.radius, this.y - this.radius, w, w);
    }

  },

  //=============================================================================
  // HELPER
  //=============================================================================

  Helper: {

    accelerate: function(x, y, dx, dy, accel, dt) {
      var x2  = x + (dt * dx) + (accel * dt * dt * 0.5);
      var y2  = y + (dt * dy) + (accel * dt * dt * 0.5);
      var dx2 = dx + (accel * dt) * (dx > 0 ? 1 : -1);
      var dy2 = dy + (accel * dt) * (dy > 0 ? 1 : -1);
      return { nx: (x2-x), ny: (y2-y), x: x2, y: y2, dx: dx2, dy: dy2 };
    },

    intercept: function(x1, y1, x2, y2, x3, y3, x4, y4, d) {
      var denom = ((y4-y3) * (x2-x1)) - ((x4-x3) * (y2-y1));
      if (denom != 0) {
        var ua = (((x4-x3) * (y1-y3)) - ((y4-y3) * (x1-x3))) / denom;
        if ((ua >= 0) && (ua <= 1)) {
          var ub = (((x2-x1) * (y1-y3)) - ((y2-y1) * (x1-x3))) / denom;
          if ((ub >= 0) && (ub <= 1)) {
            var x = x1 + (ua * (x2-x1));
            var y = y1 + (ua * (y2-y1));
            return { x: x, y: y, d: d};
          }
        }
      }
      return null;
    },

    ballIntercept: function(ball, rect, nx, ny) {
      var pt;
      if (nx < 0) {
        pt = Pong.Helper.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                   rect.right  + ball.radius, 
                                   rect.top    - ball.radius, 
                                   rect.right  + ball.radius, 
                                   rect.bottom + ball.radius, 
                                   "right");
      }
      else if (nx > 0) {
        pt = Pong.Helper.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                   rect.left   - ball.radius, 
                                   rect.top    - ball.radius, 
                                   rect.left   - ball.radius, 
                                   rect.bottom + ball.radius,
                                   "left");
      }
      if (!pt) {
        if (ny < 0) {
          pt = Pong.Helper.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                     rect.left   - ball.radius, 
                                     rect.bottom + ball.radius, 
                                     rect.right  + ball.radius, 
                                     rect.bottom + ball.radius,
                                     "bottom");
        }
        else if (ny > 0) {
          pt = Pong.Helper.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                     rect.left   - ball.radius, 
                                     rect.top    - ball.radius, 
                                     rect.right  + ball.radius, 
                                     rect.top    - ball.radius,
                                     "top");
        }
      }
      return pt;
    }

  }

  //=============================================================================

}; // Pong
