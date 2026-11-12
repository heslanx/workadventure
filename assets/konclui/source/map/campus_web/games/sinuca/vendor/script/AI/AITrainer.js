// Koncluí: patched (see VENDOR.md). Same search as upstream (random restart every 10 candidates, otherwise a mutation of
// the best one so far), but time-sliced so no task blocks the page, and decoupled from Game/GameWorld globals: the glue
// passes run(power, rotation), which simulates one candidate shot on a private world and returns its evaluation.
function AITrainer(){

    this.AIPolicy = new AIPolicy();

}

AITrainer.prototype.init = function(run){

    this.run = run;
    this.opponents = [];
    this.currentOpponent = new Opponent();
    this.iteration = 0;

    this.bestOpponentIndex = 0;
    this.bestOpponentEval = 0;

}

// Evaluates candidates until TRAIN_ITER is reached or `budget` milliseconds pass. Returns true when finished.
AITrainer.prototype.train = function(budget){

    let start = performance.now();

    while(this.iteration < TRAIN_ITER){

        if(performance.now() - start >= budget)
            return false;

        this.buildNewOpponent();
        this.currentOpponent.evaluation = this.run(this.currentOpponent.power, this.currentOpponent.rotation);
        this.opponents.push(this.currentOpponent);

        if(this.currentOpponent.evaluation > this.bestOpponentEval){
            this.bestOpponentEval = this.currentOpponent.evaluation;
            this.bestOpponentIndex = this.opponents.length - 1;
        }
    }

    return true;
}

AITrainer.prototype.buildNewOpponent = function(){

    if(this.iteration % 10 === 0){
        this.currentOpponent = new Opponent();
        this.iteration++;
        return;
    }

    let bestOpponent = this.opponents[this.bestOpponentIndex];

    let newPower = bestOpponent.power;
    newPower += + ((Math.random() * 30) - 15);
    newPower = newPower < 20 ? 20 : newPower;
    newPower = newPower > 75 ? 75 : newPower;

    let newRotation = bestOpponent.rotation;

    if(bestOpponent.evaluation > 0){
        newRotation += (1/bestOpponent.evaluation)*(Math.random() * 2 * Math.PI - Math.PI)
    }
    else{
        newRotation = (Math.random() * 2 * Math.PI - Math.PI);
    }

    this.currentOpponent = new Opponent(newPower,newRotation);

    this.iteration++;

}

AITrainer.prototype.best = function(){

    return this.opponents[this.bestOpponentIndex];
}

const AI = new AITrainer();
