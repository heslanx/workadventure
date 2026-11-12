"use strict";

// Koncluí: patched (see VENDOR.md). Rack, collisions and the step are the upstream's; the stick, mouse, AI, sound and
// the Game.policy global are gone, each world owns its policy, and the bridge to the shared state is new.

function GameWorld() {

    this.policy = new GamePolicy();

    this.whiteBallStartingPosition = new Vector2(413,413);

    this.redBalls = [
    new Ball(new Vector2(1056,433),Color.red),//3
    new Ball(new Vector2(1090,374),Color.red),//4
    new Ball(new Vector2(1126,393),Color.red),//8
    new Ball(new Vector2(1126,472),Color.red),//10;
    new Ball(new Vector2(1162,335),Color.red),//11
    new Ball(new Vector2(1162,374),Color.red),//12
    new Ball(new Vector2(1162,452),Color.red)//14
    ]

    this.yellowBalls = [
    new Ball(new Vector2(1022,413),Color.yellow),//1
    new Ball(new Vector2(1056,393),Color.yellow),//2
    new Ball(new Vector2(1090,452),Color.yellow),//6
    new Ball(new Vector2(1126,354),Color.yellow),//7
    new Ball(new Vector2(1126,433),Color.yellow),//9
    new Ball(new Vector2(1162,413),Color.yellow),//13
    new Ball(new Vector2(1162,491),Color.yellow)//15
    ];

    this.whiteBall = new Ball(new Vector2(413,413),Color.white);
    this.blackBall = new Ball(new Vector2(1090,413),Color.black);

    this.balls = [
    this.yellowBalls[0],
    this.yellowBalls[1],
    this.redBalls[0],
    this.redBalls[1],
    this.blackBall,
    this.yellowBalls[2],
    this.yellowBalls[3],
    this.redBalls[2],
    this.yellowBalls[4],
    this.redBalls[3],
    this.redBalls[4],
    this.redBalls[5],
    this.yellowBalls[5],
    this.redBalls[6],
    this.yellowBalls[6],
    this.whiteBall]

    for (var i = 0; i < this.balls.length; i++) {
        this.balls[i].id = i;
        this.balls[i].policy = this.policy;
    }
}

GameWorld.prototype.update = function (delta) {

    for (var i = 0 ; i < this.balls.length; i++){
        for(var j = i + 1 ; j < this.balls.length ; j++){
            this.handleCollision(this.balls[i], this.balls[j], delta);
        }
    }

    for (var i = 0 ; i < this.balls.length; i++) {
        this.balls[i].update(delta);
    }

};

GameWorld.prototype.ballsMoving = function(){

    var ballsMoving = false;

    for (var i = 0 ; i < this.balls.length; i++) {
        if(this.balls[i].moving){
            ballsMoving = true;
        }
    }

    return ballsMoving;
}

GameWorld.prototype.handleCollision = function(ball1, ball2, delta){

    if(ball1.inHole || ball2.inHole)
        return;

    if(!ball1.moving && !ball2.moving)
        return;

    // Koncluí: the same arithmetic as ball1NewPos.distanceFrom(ball2NewPos), without allocating vectors in the hot loop.
    var x1 = ball1.position.x + ball1.velocity.x * delta;
    var y1 = ball1.position.y + ball1.velocity.y * delta;
    var x2 = ball2.position.x + ball2.velocity.x * delta;
    var y2 = ball2.position.y + ball2.velocity.y * delta;

    var dist = Math.sqrt((x1-x2)*(x1-x2) + (y1-y2)*(y1-y2));

    if(dist<BALL_SIZE){
        this.policy.checkColisionValidity(ball1, ball2);

        var power = (Math.abs(ball1.velocity.x) + Math.abs(ball1.velocity.y)) +
                    (Math.abs(ball2.velocity.x) + Math.abs(ball2.velocity.y));
        power = power * 0.00482;

        var opposite = ball1.position.y - ball2.position.y;
        var adjacent = ball1.position.x - ball2.position.x;
        var rotation = Math.atan2(opposite, adjacent);

        ball1.moving = true;
        ball2.moving = true;

        var velocity2 = new Vector2(90*Math.cos(rotation + Math.PI)*power,90*Math.sin(rotation + Math.PI)*power);
        ball2.velocity = ball2.velocity.addTo(velocity2);

        ball2.velocity.multiplyWith(0.97);

        var velocity1 = new Vector2(90*Math.cos(rotation)*power,90*Math.sin(rotation)*power);
        ball1.velocity = ball1.velocity.addTo(velocity1);

        ball1.velocity.multiplyWith(0.97);
    }

}

GameWorld.prototype.draw = function (ctx) {
    for (var i = 0; i < this.balls.length; i++) {
        this.balls[i].draw(ctx);
    }
};

// Koncluí additions: the bridge between the physics and the shared state.

// positions: 16 entries, [x, y] in table pixels or null when the ball is off the table (pocketed).
GameWorld.prototype.place = function(positions){

    for (var i = 0; i < this.balls.length; i++) {
        var ball = this.balls[i];
        var p = positions[i];
        ball.moving = false;
        ball.velocity = Vector2.zero;
        ball.sunk = 0;
        if(p){
            ball.position = new Vector2(p[0], p[1]);
            ball.inHole = false;
            ball.visible = true;
        }
        else{
            ball.inHole = true;
            ball.visible = false;
        }
    }
}

GameWorld.prototype.snapshot = function(){

    return this.balls.map(function(ball){
        return ball.inHole ? null : [ball.position.x, ball.position.y];
    });
}

GameWorld.prototype.shoot = function(power, angle){

    this.policy.begin();
    this.whiteBall.shoot(power, angle);
}

GameWorld.prototype.maxSpeed = function(){

    var max = 0;

    for (var i = 0; i < this.balls.length; i++) {
        var ball = this.balls[i];
        if(ball.moving){
            max = Math.max(max, Math.abs(ball.velocity.x) + Math.abs(ball.velocity.y));
        }
    }

    return max;
}

// Can the cue ball rest here? Inside the cushions, outside the pockets, not touching another ball.
GameWorld.prototype.canPlaceWhite = function(pos){

    if(this.policy.isOutsideBorder(pos, this.whiteBall.origin) || this.policy.isInsideHole(pos))
        return false;

    for (var i = 0; i < this.balls.length; i++) {
        var ball = this.balls[i];
        if(ball !== this.whiteBall && !ball.inHole && ball.position.distanceFrom(pos) < BALL_SIZE + 1)
            return false;
    }

    return true;
}
