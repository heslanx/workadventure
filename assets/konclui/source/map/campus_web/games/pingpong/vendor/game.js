//=============================================================================
//
// Koncluí: trimmed copy of javascript-pong/game.js (Jake Gordon, MIT).
// Kept: the ES5 helpers, Object.construct, Game.start, Game.random, Game.KEY and the Runner shape.
// Changed (marked "Koncluí"): the Runner draws on KG.loop (it sleeps when nothing is playing), the canvas is crisp at
// any size, the keys never scroll the page. Removed: image/audio loaders, FPS stats, blocking alert/confirm.
//
//=============================================================================

if (!Function.prototype.bind) {
  Function.prototype.bind = function(obj) {
    var slice = [].slice,
        args  = slice.call(arguments, 1),
        self  = this,
        nop   = function () {},
        bound = function () {
          return self.apply(this instanceof nop ? this : (obj || {}), args.concat(slice.call(arguments)));   
        };
    nop.prototype   = self.prototype;
    bound.prototype = new nop();
    return bound;
  };
}

if (!Object.create) {
  Object.create = function(base) {
    function F() {};
    F.prototype = base;
    return new F();
  }
}

if (!Object.construct) {
  Object.construct = function(base) {
    var instance = Object.create(base);
    if (instance.initialize)
      instance.initialize.apply(instance, [].slice.call(arguments, 1));
    return instance;
  }
}

if (!Object.extend) {
  Object.extend = function(destination, source) {
    for (var property in source) {
      if (source.hasOwnProperty(property))
        destination[property] = source[property];
    }
    return destination;
  };
}

//=============================================================================
// GAME
//=============================================================================

Game = {

  start: function(id, game, cfg) {
    return Object.construct(Game.Runner, id, game, cfg).game; // return the game instance, not the runner (caller can always get at the runner via game.runner)
  },

  addEvent:    function(obj, type, fn) { obj.addEventListener(type, fn, false);    },
  removeEvent: function(obj, type, fn) { obj.removeEventListener(type, fn, false); },

  random: function(min, max) {
    return (min + (Math.random() * (max - min)));
  },

  KEY: {
    ESC:      27,
    RETURN:   13,
    SPACE:    32,
    LEFT:     37,
    UP:       38,
    RIGHT:    39,
    DOWN:     40,
    A:        65,
    P:        80,
    S:        83,
    W:        87
  },

  //-----------------------------------------------------------------------------

  Runner: {

    initialize: function(id, game, cfg) {
      this.cfg          = Object.extend(game.Defaults || {}, cfg || {}); // use game defaults (if any) and extend with custom cfg (if any)
      this.canvas       = document.getElementById(id);
      this.width        = this.cfg.width;  // logical court size: the game always draws in these units
      this.height       = this.cfg.height;
      this.ctx          = this.canvas.getContext('2d');
      this.resize();
      this.addEvents();

      this.game = Object.construct(game, this, this.cfg); // finally construct the game object itself
      this.draw(); // Koncluí: no loop yet, so paint the first frame by hand
    },

    // Koncluí: pixels per CSS pixel (1 on the light profile)
    ratio: function() {
      return KG.profile === 'leve' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    },

    // Koncluí: the canvas is sized in CSS by the page; the backing store follows it. Called again by the page glue on resize.
    resize: function() {
      var w = Math.max(1, Math.round(this.canvas.clientWidth  * this.ratio())),
          h = Math.max(1, Math.round(this.canvas.clientHeight * this.ratio()));
      if (this.canvas.width != w || this.canvas.height != h) {
        this.canvas.width  = w;
        this.canvas.height = h;
        if (this.game && !this.handle)
          this.draw(); // no loop running: repaint by hand
      }
    },

    // Koncluí: pointer position (client coordinates) in court units
    courtPoint: function(clientX, clientY) {
      var box = this.canvas.getBoundingClientRect();
      return { x: (clientX - box.left) * (this.width / box.width), y: (clientY - box.top) * (this.height / box.height) };
    },

    start: function() { // Koncluí: runs on KG.loop; a no-op if already running
      if (!this.handle)
        this.handle = KG.loop(this.loop.bind(this));
    },

    stop: function() {
      if (this.handle) {
        this.handle.stop();
        this.handle = null;
      }
    },

    loop: function(dt) { // dt in seconds, from KG.loop
      this.game.update(dt);
      this.draw();
    },

    draw: function() {
      var ctx = this.ctx;
      ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      this.game.draw(ctx);
    },

    addEvents: function() {
      Game.addEvent(document, 'keydown', this.onkeydown.bind(this));
      Game.addEvent(document, 'keyup',   this.onkeyup.bind(this));
    },

    onkeydown: function(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey)
        return;
      if ([Game.KEY.SPACE, Game.KEY.LEFT, Game.KEY.UP, Game.KEY.RIGHT, Game.KEY.DOWN].indexOf(ev.keyCode) >= 0)
        ev.preventDefault(); // Koncluí: arrows and space never scroll the page
      if (this.game.onkeydown) this.game.onkeydown(ev.keyCode);
    },
    onkeyup:   function(ev) { if (this.game.onkeyup)   this.game.onkeyup(ev.keyCode);   }

    //-------------------------------------------------------------------------

  } // Game.Runner
} // Game
