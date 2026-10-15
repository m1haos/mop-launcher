// The map project a script works on: its folder holds pack/, world/ and mod/.
// By default it is the folder above launcher/ (chapter 2); another chapter is given as the
// first argument:  npm.cmd run pack:build -- "..\..\MOP Chapter 1"

const path = require('path');

const arg = process.argv.slice(2).find(a => !a.startsWith('-'));
module.exports = path.resolve(arg || path.join(__dirname, '..', '..', '..'));
