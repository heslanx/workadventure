"use strict";

// Koncluí: patched (see VENDOR.md). Only the table geometry (borders and pockets) is the upstream's. The upstream's
// rules (turns, scores, menus) lived here; the glue now judges the shot from the log this policy records.

function GamePolicy(){

    this.leftBorderX = BORDER_SIZE;
    this.rightBorderX = TABLE_W - BORDER_SIZE;
    this.topBorderY = BORDER_SIZE;
    this.bottomBorderY = TABLE_H - BORDER_SIZE;

    this.topCenterHolePos = new Vector2(750,32);
    this.bottomCenterHolePos = new Vector2(750,794);
    this.topLeftHolePos = new Vector2(62,62);
    this.topRightHolePos = new Vector2(1435,62);
    this.bottomLeftHolePos = new Vector2(62,762)
    this.bottomRightHolePos = new Vector2(1435,762);

    this.begin();
}

// Koncluí: starts the log of one shot: first = id of the first ball the cue ball touched (-1 = none yet),
// pots = ids pocketed, in order.
GamePolicy.prototype.begin = function(){
    this.first = -1;
    this.pots = [];
}

GamePolicy.prototype.checkColisionValidity = function(ball1,ball2){

    if(this.first !== -1)
        return;

    if(ball1.id === WHITE_ID){
        this.first = ball2.id;
    }
    else if(ball2.id === WHITE_ID){
        this.first = ball1.id;
    }
}

GamePolicy.prototype.handleBallInHole = function(ball){
    this.pots.push(ball.id);
}

GamePolicy.prototype.isXOutsideLeftBorder = function(pos, origin){
    return (pos.x - origin.x) < this.leftBorderX;
}
GamePolicy.prototype.isXOutsideRightBorder = function(pos, origin){
    return (pos.x + origin.x) > this.rightBorderX;
}
GamePolicy.prototype.isYOutsideTopBorder = function(pos, origin){
    return (pos.y - origin.y) < this.topBorderY;
}
GamePolicy.prototype.isYOutsideBottomBorder = function(pos , origin){
    return (pos.y + origin.y) > this.bottomBorderY;
}

GamePolicy.prototype.isOutsideBorder = function(pos,origin){
    return this.isXOutsideLeftBorder(pos,origin) || this.isXOutsideRightBorder(pos,origin) ||
    this.isYOutsideTopBorder(pos, origin) || this.isYOutsideBottomBorder(pos , origin);
}

GamePolicy.prototype.isInsideTopLeftHole = function(pos){
    return this.topLeftHolePos.distanceFrom(pos) < HOLE_RADIUS;
}

GamePolicy.prototype.isInsideTopRightHole = function(pos){
    return this.topRightHolePos.distanceFrom(pos) < HOLE_RADIUS;
}

GamePolicy.prototype.isInsideBottomLeftHole = function(pos){
    return this.bottomLeftHolePos.distanceFrom(pos) < HOLE_RADIUS;
}

GamePolicy.prototype.isInsideBottomRightHole = function(pos){
    return this.bottomRightHolePos.distanceFrom(pos) < HOLE_RADIUS;
}

GamePolicy.prototype.isInsideTopCenterHole = function(pos){
    return this.topCenterHolePos.distanceFrom(pos) < (HOLE_RADIUS + 6);
}

GamePolicy.prototype.isInsideBottomCenterHole = function(pos){
    return this.bottomCenterHolePos.distanceFrom(pos) < (HOLE_RADIUS + 6);
}

GamePolicy.prototype.isInsideHole = function(pos){
    return this.isInsideTopLeftHole(pos) || this.isInsideTopRightHole(pos) ||
           this.isInsideBottomLeftHole(pos) || this.isInsideBottomRightHole(pos) ||
           this.isInsideTopCenterHole(pos) || this.isInsideBottomCenterHole(pos);
}
