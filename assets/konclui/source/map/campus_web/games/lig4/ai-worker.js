// Koru's brain for Lig 4: negamax with alpha-beta, off the main thread.
//
// Win detection is the vendored connect-four rules (Game.check.*), run on Game.board exactly as the page does; only the
// search and the position score live here. Protocol: { id, cells, who, depth, random } in, { id, col } out.
// cells: 42 chars of ".", "0", "1", row 0 at the top. who: the seat to move (0 = "black" in the vendored code, 1 = "red").
"use strict";

importScripts("vendor/connect-four/vars.js", "vendor/connect-four/functions.js");

const COLS = 7, ROWS = 6, WIN = 100000;
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first prunes best
const NAMES = ["black", "red"];
const board = Game.board;

const lowestEmpty = (c) => {
  for (let r = ROWS - 1; r >= 0; r -= 1) if (board[r][c] === 0) return r;
  return -1;
};
const won = () => Game.check.isVerticalWin() || Game.check.isHorizontalWin() || Game.check.isDiagonalWin();

// Score of the position for `me`: open threes and twos in every window of four, plus the centre column.
const LINES = [[0, 1], [1, 0], [1, 1], [1, -1]];
function evaluate(me) {
  const you = NAMES[1 - NAMES.indexOf(me)];
  let score = 0;
  for (let r = 0; r < ROWS; r += 1) if (board[r][3] === me) score += 3;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      for (const [dr, dc] of LINES) {
        const r3 = r + 3 * dr, c3 = c + 3 * dc;
        if (r3 < 0 || r3 >= ROWS || c3 < 0 || c3 >= COLS) continue;
        let mine = 0, theirs = 0;
        for (let k = 0; k < 4; k += 1) {
          const v = board[r + k * dr][c + k * dc];
          if (v === me) mine += 1;
          else if (v === you) theirs += 1;
        }
        if (mine && theirs) continue;
        if (mine === 3) score += 5;
        else if (mine === 2) score += 2;
        else if (theirs === 3) score -= 4;
        else if (theirs === 2) score -= 1;
      }
    }
  }
  return score;
}

// Value for `who` to move; the previous mover has not won (the caller checked).
function search(depth, alpha, beta, who) {
  if (depth === 0) return evaluate(who);
  const other = who === "black" ? "red" : "black";
  let best = -Infinity;
  for (const c of ORDER) {
    const r = lowestEmpty(c);
    if (r < 0) continue;
    board[r][c] = who;
    const value = won() ? WIN + depth : -search(depth - 1, -beta, -alpha, other);
    board[r][c] = 0;
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? 0 : best; // no column left: a full board is a draw
}

function pick(cells, seat, depth, random) {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const ch = cells[r * COLS + c];
      board[r][c] = ch === "." ? 0 : NAMES[Number(ch)];
    }
  }
  const who = NAMES[seat], other = NAMES[1 - seat];
  const open = ORDER.filter((c) => lowestEmpty(c) >= 0);
  if (!open.length) throw new Error("board is full");
  if (Math.random() < random) return open[Math.floor(Math.random() * open.length)];
  let bestValue = -Infinity, bestCols = [];
  for (const c of open) {
    const r = lowestEmpty(c);
    board[r][c] = who;
    const value = won() ? WIN * 2 : -search(depth - 1, -Infinity, Infinity, other);
    board[r][c] = 0;
    if (value > bestValue) {
      bestValue = value;
      bestCols = [c];
    } else if (value === bestValue) bestCols.push(c);
  }
  return bestCols[Math.floor(Math.random() * bestCols.length)];
}

self.onmessage = (e) => {
  const { id, cells, who, depth, random } = e.data;
  try {
    self.postMessage({ id, col: pick(cells, who, depth, random) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
