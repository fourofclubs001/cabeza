// Thinks for the CPU off the main thread. One worker = one Bot (its transposition table persists across moves).
importScripts('game.js', 'bot.js');
let bot = null;
onmessage = e => {
  const { gen, level, pieces, side } = e.data;
  if (!bot || bot.level.key !== level) bot = new Bot(LEVELS[level]);
  postMessage({ gen, turn: bot.choose(pieces, side) });
};
