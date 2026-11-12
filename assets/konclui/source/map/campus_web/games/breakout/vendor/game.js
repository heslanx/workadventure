// Game helpers and the 2D game runner of Jake Gordon's javascript-breakout (https://github.com/jakesgordon/javascript-breakout),
// MIT license (see LICENSE). Koncluí changes, each marked "Koncluí" (and listed in ../VENDOR.md):
//   - Game.Runner runs on KG.loop (starts when a game starts, stops on pause/menu/game over, sleeps in a hidden tab, 30 fps
//     on the light profile) instead of a setInterval that never stops; no resize listener (the page glue calls resize());
//   - the canvas backing store follows its CSS size times the pixel ratio; canvasX() maps pointer coordinates back;
//   - sound (SoundManager 2), image/script loaders, localStorage helpers, FPS stats and alert/confirm are removed.

//=============================================================================
//
// We need some ECMAScript 5 methods but we need to implement them ourselves
// for older browsers
//
//  Function.bind
//  Object.create
//  Object.extend:        (defacto standard like jquery $.extend or prototype's Object.extend)
//
//  Object.construct:     our own wrapper around Object.create that ALSO calls
//                        an initialize constructor method if one exists
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
// Minimal DOM Library ($)
//=============================================================================

Element = function() {

  var instance = {

    _extended: true,

    showIf: function(on)      { if (on) this.show(); else this.hide(); },
    show:   function()        { this.style.display = '';      },
    hide:   function()        { this.style.display = 'none';  },
    update: function(content) { this.innerHTML     = content; },

    hasClassName:    function(name)     { return (new RegExp("(^|\s*)" + name + "(\s*|$)")).test(this.className) },
    addClassName:    function(name)     { this.toggleClassName(name, true);  },
    removeClassName: function(name)     { this.toggleClassName(name, false); },
    toggleClassName: function(name, on) {
      var classes = this.className.split(' ');
      var n = classes.indexOf(name);
      on = (typeof on == 'undefined') ? (n < 0) : on;
      if (on && (n < 0))
        classes.push(name);
      else if (!on && (n >= 0))
        classes.splice(n, 1);
      this.className = classes.join(' ');
    }
  };

  var get = function(ele) {
    if (typeof ele == 'string')
      ele = document.getElementById(ele);
    if (!ele._extended)
      Object.extend(ele, instance);
    return ele;
  };

  return get;

}();

$ = Element;

//=============================================================================
// State Machine
//=============================================================================

StateMachine = {

  //---------------------------------------------------------------------------

  create: function(cfg) {

    var target  = cfg.target  || {};
    var events  = cfg.events;

    var n, event, name, can = {};
    for(n = 0 ; n < events.length ; n++) {
      event = events[n];
      name  = event.name;
      can[name] = (can[name] || []).concat(event.from);
      target[name] = this.buildEvent(name, event.from, event.to, target);
    }

    target.current = 'none';
    target.is      = function(state) { return this.current == state; };
    target.can     = function(event) { return can[event].indexOf(this.current) >= 0; };
    target.cannot  = function(event) { return !this.can(event); };

    if (cfg.initial) { // see "initial" qunit tests for examples
      var initial = (typeof cfg.initial == 'string') ? { state: cfg.initial } : cfg.initial; // allow single string to represent initial state, or complex object to configure { state: 'first', event: 'init', defer: true|false }
      name = initial.event || 'startup';
      can[name] = ['none'];
      event = this.buildEvent(name, 'none', initial.state, target);
      if (initial.defer)
        target[name] = event; // allow caller to trigger initial transition event
      else
        event.call(target);
    }

    return target;
  },

  //---------------------------------------------------------------------------

  buildEvent: function(name, from, to, target) {

    return function() {

      if (this.cannot(name))
        throw "event " + name + " innapropriate in current state " + this.current;

      var beforeEvent = this['onbefore' + name];
      if (beforeEvent && (false === beforeEvent.apply(this, arguments)))
        return;

      if (this.current != to) {

        var exitState = this['onleave'  + this.current];
        if (exitState)
          exitState.apply(this, arguments);

        this.current = to;

        var enterState = this['onenter' + to] || this['on' + to];
        if (enterState)
          enterState.apply(this, arguments);
      }

      var afterEvent = this['onafter'  + name] || this['on' + name];
      if (afterEvent)
        afterEvent.apply(this, arguments);
    }

  }

  //---------------------------------------------------------------------------

};

//=============================================================================
// GAME
//=============================================================================

Game = {

  compatible: function() {
    return Object.create &&
           Object.extend &&
           Function.bind &&
           document.addEventListener && // HTML5 standard, all modern browsers that support canvas should also support add/removeEventListener
           Game.ua.hasCanvas
  },

  start: function(id, game, cfg) {
    if (Game.compatible())
      return Game.current = Object.construct(Game.Runner, id, game, cfg).game; // return the game instance, not the runner (caller can always get at the runner via game.runner)
  },

  ua: function() { // should avoid user agent sniffing... but sometimes you just gotta do what you gotta do
    var ua  = navigator.userAgent.toLowerCase();
    var key =        ((ua.indexOf("opera")   > -1) ? "opera"   : null);
        key = key || ((ua.indexOf("firefox") > -1) ? "firefox" : null);
        key = key || ((ua.indexOf("chrome")  > -1) ? "chrome"  : null);
        key = key || ((ua.indexOf("safari")  > -1) ? "safari"  : null);
        key = key || ((ua.indexOf("msie")    > -1) ? "ie"      : null);

    try {
      var re      = (key == "ie") ? "msie (\\d)" : key + "\\/(\\d\\.\\d)"
      var matches = ua.match(new RegExp(re, "i"));
      var version = matches ? parseFloat(matches[1]) : null;
    } catch (e) {}

    return {
      full:      ua, 
      name:      key + (version ? " " + version.toString() : ""),
      version:   version,
      isFirefox: (key == "firefox"),
      isChrome:  (key == "chrome"),
      isSafari:  (key == "safari"),
      isOpera:   (key == "opera"),
      isIE:      (key == "ie"),
      hasCanvas: (document.createElement('canvas').getContext),
      hasAudio:  (typeof(Audio) != 'undefined'),
      hasTouch:  ('ontouchstart' in window)
    }
  }(),

  addEvent:    function(obj, type, fn) { $(obj).addEventListener(type, fn, false);    },
  removeEvent: function(obj, type, fn) { $(obj).removeEventListener(type, fn, false); },

  windowWidth:  function() { return window.innerWidth  || /* ie */ document.documentElement.offsetWidth;  },
  windowHeight: function() { return window.innerHeight || /* ie */ document.documentElement.offsetHeight; },

  ready: function(fn) {
    if (Game.compatible())
      Game.addEvent(document, 'DOMContentLoaded', fn);
  },

  renderToCanvas: function(width, height, render, canvas) {
    canvas = canvas || document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    render(canvas.getContext('2d'));
    return canvas;
  },

  random: function(min, max) {
    return (min + (Math.random() * (max - min)));
  },

  randomChoice: function(choices) {
    return choices[Math.round(Game.random(0, choices.length-1))];
  },

  randomBool: function() {
    return Game.randomChoice([true, false]);
  },

  timestamp: function() { 
    return new Date().getTime();
  },

  THREESIXTY: Math.PI * 2,

  KEY: {
    BACKSPACE: 8,
    TAB:       9,
    RETURN:   13,
    ESC:      27,
    SPACE:    32,
    LEFT:     37,
    UP:       38,
    RIGHT:    39,
    DOWN:     40,
    DELETE:   46,
    HOME:     36,
    END:      35,
    PAGEUP:   33,
    PAGEDOWN: 34,
    INSERT:   45,
    ZERO:     48,
    ONE:      49,
    TWO:      50,
    A:        65,
    D:        68,
    L:        76,
    P:        80,
    Q:        81,
    TILDA:    192
  },

  //-----------------------------------------------------------------------------

  Math: {

    bound: function(box) {
      if (box.radius) {
        box.w      = 2 * box.radius;
        box.h      = 2 * box.radius;
        box.left   = box.x - box.radius;
        box.right  = box.x + box.radius;
        box.top    = box.y - box.radius;
        box.bottom = box.y + box.radius;
      }
      else {
        box.left   = box.x;
        box.right  = box.x + box.w;
        box.top    = box.y;
        box.bottom = box.y + box.h;
      }
      return box;
    },

    overlap: function(box1, box2, returnOverlap) {
      if ((box1.right < box2.left)   ||
          (box1.left  > box2.right)  ||
          (box1.top   > box2.bottom) ||
          (box1.bottom < box2.top)) {
        return false;
      }
      else {
        if (returnOverlap) {
          var left   = Math.max(box1.left,  box2.left);
          var right  = Math.min(box1.right, box2.right);
          var top    = Math.max(box1.top,   box2.top);
          var bottom = Math.min(box1.bottom, box2.bottom);
          return {x: left, y: top, w: right-left, h: bottom-top, left: left, right: right, top: top, bottom: bottom };
        }
        else {
          return true;
        }
      }
    },

    normalize: function(vec, m) {
      vec.m = this.magnitude(vec.x, vec.y);
      if (vec.m == 0) {
        vec.x = vec.y = vec.m = 0;
      }
      else {
        vec.m = vec.m / (m || 1);
        vec.x = vec.x / vec.m;
        vec.y = vec.y / vec.m;
        vec.m = vec.m / vec.m;
      }
      return vec; 
    },

    magnitude: function(x, y) {
      return Math.sqrt(x*x + y*y);
    },

    move: function(x, y, dx, dy, dt) {
      var nx = dx * dt;
      var ny = dy * dt;
      return { x: x + nx, y: y + ny, dx: dx, dy: dy, nx: nx, ny: ny };
    },

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
        pt = Game.Math.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                 rect.right  + ball.radius, 
                                 rect.top    - ball.radius, 
                                 rect.right  + ball.radius, 
                                 rect.bottom + ball.radius, 
                                 "right");
      }
      else if (nx > 0) {
        pt = Game.Math.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                 rect.left   - ball.radius, 
                                 rect.top    - ball.radius, 
                                 rect.left   - ball.radius, 
                                 rect.bottom + ball.radius,
                                 "left");
      }
      if (!pt) {
        if (ny < 0) {
          pt = Game.Math.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                   rect.left   - ball.radius, 
                                   rect.bottom + ball.radius, 
                                   rect.right  + ball.radius, 
                                   rect.bottom + ball.radius,
                                   "bottom");
        }
        else if (ny > 0) {
          pt = Game.Math.intercept(ball.x, ball.y, ball.x + nx, ball.y + ny, 
                                   rect.left   - ball.radius, 
                                   rect.top    - ball.radius, 
                                   rect.right  + ball.radius, 
                                   rect.top    - ball.radius,
                                   "top");
        }
      }
      return pt;
    }

  },

  //-----------------------------------------------------------------------------

  Runner: {

    initialize: function(id, game, cfg) {
      this.cfg          = Object.extend(game.Defaults || {}, cfg || {}); // use game defaults (if any) and extend with custom cfg (if any)
      this.canvas       = $(id);
      this.front        = this.canvas;
      this.front2d      = this.front.getContext('2d');
      this.measure();
      this.addEvents();

      this.game = Object.construct(game, this, this.cfg); // finally construct the game object itself

      if (this.cfg.state)
        StateMachine.create(Object.extend({target: this.game}, this.cfg.state));

      this.initCanvas();
      this.draw(); // Koncluí: no loop yet, so paint the first frame by hand
    },

    // Koncluí: pixels per CSS pixel (1 on the light profile)
    ratio: function() {
      return KG.profile === 'leve' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    },

    // Koncluí: the canvas is sized in CSS by the page; the backing store follows it
    measure: function() {
      this.width  = this.front.width  = Math.round(this.front.clientWidth  * this.ratio());
      this.height = this.front.height = Math.round(this.front.clientHeight * this.ratio());
    },

    // Koncluí: pointer x (client coordinates) in canvas pixels
    canvasX: function(clientX) {
      var box = this.front.getBoundingClientRect();
      return (clientX - box.left) * (this.front.width / box.width);
    },

    start: function() { // game instance should call runner.start() when a game begins; it is a no-op if already running
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
      this.update(dt);
      this.draw();
    },

    initCanvas: function() {
      if (this.game && this.game.initCanvas)
        this.game.initCanvas(this.front2d);
    },

    update: function(dt) {
      this.game.update(dt);
    },

    draw: function() {
      this.game.draw(this.front2d);
    },

    addEvents: function() {
      Game.addEvent(document, 'keydown', this.onkeydown.bind(this));
      Game.addEvent(document, 'keyup',   this.onkeyup.bind(this));
    },

    // Koncluí: called by the page glue when the canvas CSS size changed
    resize: function() {
      var width  = Math.round(this.front.clientWidth  * this.ratio()),
          height = Math.round(this.front.clientHeight * this.ratio());
      if ((this.width != width) || (this.height != height)) {
        this.measure();
        if (this.game && this.game.onresize)
          this.game.onresize(this.width, this.height);
        this.initCanvas(); // when canvas is really resized, its state is reset so we need to re-initialize
        if (!this.handle)
          this.draw(); // no loop running: repaint by hand
      }
    },

    onkeydown: function(ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey)
        return;
      if ([Game.KEY.SPACE, Game.KEY.LEFT, Game.KEY.UP, Game.KEY.RIGHT, Game.KEY.DOWN].indexOf(ev.keyCode) >= 0)
        ev.preventDefault(); // Koncluí: arrows and space never scroll the page
      if (this.game.onkeydown)
        return this.game.onkeydown(ev.keyCode);
      else if (this.cfg.keys)
        return this.onkey(ev.keyCode, 'down');
    },

    onkeyup: function(ev) {
      if (this.game.onkeyup)
        return this.game.onkeyup(ev.keyCode);
      else if (this.cfg.keys)
        return this.onkey(ev.keyCode, 'up');
    },

    onkey: function(keyCode, mode) {
      var n, k, i, state = this.game.current; // avoid same key event triggering in 2 different states by remembering current state so that even if an earlier keyhandler changes state, the later keyhandler wont kick in.
      for(n = 0 ; n < this.cfg.keys.length ; n++) {
        k = this.cfg.keys[n];
        k.mode = k.mode || 'up';
        if ((k.key == keyCode) || (k.keys && (k.keys.indexOf(keyCode) >= 0))) {
          if (!k.state || (k.state == state)) {
            if (k.mode == mode) {
              k.action.call(this.game);
            }
          }
        }
      }
    }

    //-------------------------------------------------------------------------

  } // Game.Runner
} // Game
