// Koncluí: patched (see VENDOR.md). Same scoring weights as upstream; the outcome now comes from the glue's judge
// ({ contact, own, over, won, foul }) instead of the Game.policy singleton.
function AIPolicy(){

}

AIPolicy.prototype.evaluate = function(state, outcome){

    let evaluation = 1;

    for (var i = 0 ; i < state.balls.length; i++){
        for(var j = i + 1 ; j < state.balls.length ; j++){

            let firstBall = state.balls[i];
            let secondBall = state.balls[j];

            if(firstBall === state.whiteBall || secondBall === state.whiteBall
                ||
                firstBall.inHole || secondBall.inHole){
                continue;
            }
            evaluation += firstBall.position.distanceFrom(secondBall.position);
        }
    }

    evaluation = evaluation/5800;

    if(outcome.contact){
        evaluation+= 100;
    }

    evaluation += 2000 * outcome.own;

    if(outcome.over){
        if(outcome.won){
            evaluation += 10000;
        }
        else{
            evaluation -= 10000;
        }
    }

    if(outcome.foul){
        evaluation = evaluation - 3000;
    }

    return evaluation;
}
