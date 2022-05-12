/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';

// for local testing
//exports.WS_PROTOCOL === 'ws://';
//exports.port = 16611;
//exports.myUrl = 'ws://127.0.0.1:' + exports.port;

exports.bServeAsHub = false;
exports.bLight = true;

exports.storage = 'sqlite';

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Stable-to-oswap arbitrage bot';
exports.permanent_pairing_secret = '*';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.bSingleAddress = true;
exports.bWantNewPeers = true;
exports.KEYS_FILENAME = 'keys.json';

// TOR
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.bNoPassphrase = true;

exports.explicitStart = true;

exports.min_reserve_delta = 1e8;
exports.min_distance_delta = 1e-3;

exports.min_profit = 0.1; // in USD

exports.arb_base_aas = ['IO63YJGOTTFS6NUENQQ3NB5MW56HHI3A'];
exports.owner = ''; // set in conf.json
exports.arb_aas = []; // set in conf.json
exports.buffer_base_aas = ['VXY4L4NGFQ773NOQKUFFVJEWLZUBCYHI', '6UZ3XA5M6B6ZL5YSBLTIDCCVAQGSYYWR'];

exports.lib_aas = ['5GG2PDVJ555WEUFGNPX55W2Z2T4P6BG5', 'ASXH57GPNWI5FO5KJWJWLRMVZTXBRKJX', '2R5PP7IZRWIBXAKGI6YXIYDQ4EZKAWHE', 'U75U5R3BYXVXBOTSRRDKS7HUIB63DJ2K', 'MC5KTC25FGEMSGDBD6KBYW3DUFF35OKT', 'IXBHF6T4IKMYAFGRM54F5FVMXGKCTFNT', 'FVFJQZVUWUANWRWXJ5LWVYDUP2XF7BIB'];
exports.v2_arb_base_aas = ['B23R7Z5DR742TK7AV23TDJVY74J4KK23'];
exports.v1v2_arb_base_aas = ['IPYGU34BYID3DOXI3JZMMZPHLFDVRL5I'];

console.log('finished arb conf');
