const fs = require('fs');
const { promisify } = require('util');
const flock = promisify(require('fs-ext').flock);
const mutex = require("ocore/mutex");


const lockFile = '../arblock';

const fd = fs.openSync(lockFile, 'r');

let mu;
let t;

function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function lock() {
	mu = await mutex.lock('arblock');
	await flock(fd, 'ex');
	console.log('locked arblock');
	t = setTimeout(() => {
		throw Error(`keeping arblock for too long`);
	}, 3600 * 1000);
}

async function unlock() {
	clearTimeout(t);
	await flock(fd, 'un');
	console.log('unlocked arblock');
	if (!mu)
		throw Error(`no mu`);
	mu();
}

exports.lock = lock;
exports.unlock = unlock;

