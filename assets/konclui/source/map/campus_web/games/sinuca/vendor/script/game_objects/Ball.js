"use strict";

// Koncluí: patched (see VENDOR.md). Physics is the upstream's; sounds, setTimeout timers and the Game.policy global are gone.

function Ball(initPos,color){
	this.initPos = initPos;
    this.position = initPos.copy();
    this.origin = new Vector2(25,25);
    this.velocity = Vector2.zero;
    this.color = color;
    this.moving = false;
    this.visible = true;
    this.inHole = false;
    this.id = -1;        // Koncluí: index in GameWorld.balls, the id used by the shared state
    this.policy = null;  // Koncluí: GamePolicy of the world that owns this ball
    this.sunk = 0;       // Koncluí: steps since pocketed (drives the sink animation)
}

Object.defineProperty(Ball.prototype, "color",
    {
    	get: function(){
    		if(this.sprite == sprites.redBall){
    			return Color.red;
    		}
    		else if(this.sprite == sprites.yellowBall){
    			return Color.yellow;
    		}
			else if(this.sprite == sprites.blackBall){
    			return Color.black;
    		}
    		else{
    			return Color.white;
    		}
    	},
        set: function (value) {
            if (value === Color.red){
                this.sprite = sprites.redBall;
            }
            else if(value == Color.yellow){
            	this.sprite = sprites.yellowBall;
            }
			else if(value == Color.black){
            	this.sprite = sprites.blackBall;
            }
            else{
            	this.sprite = sprites.ball;
            }
        }
    });

Ball.prototype.shoot = function(power, angle){
    if(power <= 0)
        return;

    this.moving = true;

    this.velocity = calculateBallVelocity(power,angle);
}

var calculateBallVelocity = function(power, angle){

    return new Vector2(100*Math.cos(angle)*power,100*Math.sin(angle)*power);
}

Ball.prototype.update = function(delta){

    if(this.inHole){
        this.sunk++;
        return;
    }

    this.updatePosition(delta);

    this.velocity.multiplyWith(0.98);

	if(this.moving && Math.abs(this.velocity.x) < 1 && Math.abs(this.velocity.y) < 1){
        this.stop();
    }
}

Ball.prototype.updatePosition = function(delta){

    if(!this.moving || this.inHole)
        return;
    var newPos = this.position.add(this.velocity.multiply(delta));


	if(this.policy.isInsideHole(newPos)){
		this.position = newPos;
        this.inHole = true;
        this.moving = false;
        this.velocity = Vector2.zero;
        this.policy.handleBallInHole(this);
		return;
	}

    var collision = this.handleCollision(newPos);

    if(collision){
		this.velocity.multiplyWith(0.95);
    }else{
    	this.position = newPos;
    }
}

Ball.prototype.handleCollision = function(newPos){

	var collision = false;

	if(this.policy.isXOutsideLeftBorder(newPos, this.origin)){
        this.velocity.x = -this.velocity.x;
        this.position.x = this.policy.leftBorderX + this.origin.x;
        collision = true;
    }
    else if(this.policy.isXOutsideRightBorder(newPos, this.origin)){
        this.velocity.x = -this.velocity.x;
        this.position.x = this.policy.rightBorderX - this.origin.x;
        collision = true;
    }

    if(this.policy.isYOutsideTopBorder(newPos, this.origin)){
        this.velocity.y = -this.velocity.y;
        this.position.y = this.policy.topBorderY + this.origin.y;
        collision = true;
    }
    else if(this.policy.isYOutsideBottomBorder(newPos, this.origin)){
        this.velocity.y = -this.velocity.y;
        this.position.y = this.policy.bottomBorderY - this.origin.y;
        collision = true;
    }

    return collision;
}

Ball.prototype.stop = function(){

    this.moving = false;
    this.velocity = Vector2.zero;
}

// Koncluí: draws on a 2D context already scaled to table pixels; a pocketed ball shrinks for SINK_STEPS steps.
Ball.prototype.draw = function (ctx) {
    if(!this.visible || (this.inHole && this.sunk >= SINK_STEPS))
        return;

    var s = this.inHole ? 1 - this.sunk / SINK_STEPS : 1;
    ctx.drawImage(this.sprite, this.position.x - this.origin.x * s, this.position.y - this.origin.y * s, 50 * s, 50 * s);
};
