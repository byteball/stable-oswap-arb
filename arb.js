"use strict";
const _ = require('lodash');

const eventBus = require('ocore/event_bus.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const network = require('ocore/network.js');
const aa_composer = require("ocore/aa_composer.js");
const storage = require("ocore/storage.js");
const db = require("ocore/db.js");
const constants = require("ocore/constants.js");
const light_wallet = require("ocore/light_wallet.js");

const dag = require('aabot/dag.js');
const operator = require('aabot/operator.js');
const aa_state = require('aabot/aa_state.js');
const CurveAA = require('./curve.js');

let arb_aas;
let my_arb_aas;
let arbsByAAs = {};
let prev_trigger_initial_unit = {};

let curvesByArb = {};

let oswap_aas = {};

async function estimateAndArbAll() {
	for (let arb_aa of my_arb_aas)
		await estimateAndArb(arb_aa);
}

async function estimateAndArb(arb_aa) {
	const unlock = await mutex.lock('estimate');
	const curve_aa = curvesByArb[arb_aa];
	console.log('===== estimateAndArb arb ' + arb_aa + ' on curve ' + curve_aa);
	// simulate an arb request
	const aa_unlock = await aa_state.lock();
	let upcomingStateVars = _.cloneDeep(aa_state.getUpcomingStateVars());
	let upcomingBalances = _.cloneDeep(aa_state.getUpcomingBalances());
	let objUnit = {
		unit: 'dummy_trigger_unit',
		authors: [{ address: operator.getAddress() }],
		messages: [
			{
				app: 'payment',
				payload: {
					outputs: [{ address: arb_aa, amount: 1e4 }]
				}
			},
			{
				app: 'data',
				payload: {
					arb: 1
				}
			},
		]
	};
	let curveAA = CurveAA.get(curve_aa);
	await curveAA.updateDataFeeds(false, true);
	let arrResponses = await aa_composer.estimatePrimaryAATrigger(objUnit, arb_aa, upcomingStateVars, upcomingBalances);
	console.log(`--- estimated responses to simulated arb request`, JSON.stringify(arrResponses, null, 2));
	aa_unlock();
	if (arrResponses[0].bounced)
		return unlock(`${arb_aa}/${curve_aa} would bounce: ` + arrResponses[0].response.error);
	const balances = upcomingBalances[arb_aa];
	for (let asset in balances)
		if (balances[asset] < 0)
			return unlock(`${arb_aa}/${curve_aa}: ${asset} balance would become negative: ${balances[asset]}`);
	console.log(`estimateAndArb: ${arb_aa}/${curve_aa} would succeed`);
	const unit = await dag.sendAARequest(arb_aa, { arb: 1 });
	if (!unit)
		return unlock(`sending arb request failed`);
	const objJoint = await dag.readJoint(unit);
	// upcoming state vars are updated and the next request will see them
	console.log(`estimateAndArb: ${arb_aa}/${curve_aa} calling onAARequest manually`);
	await aa_state.onAARequest({ unit: objJoint.unit, aa_address: arb_aa });
	unlock();
}

async function checkOswapAAsForSufficientBytes() {
	console.log('checkOswapAAsForSufficientBytes');
	const upcomingBalances = aa_state.getUpcomingBalances();
	for (let oswap_aa in oswap_aas) {
		if (upcomingBalances[oswap_aa].base <= 50000) {
			console.log(`bytes balance of ${oswap_aa} is only ${upcomingBalances[oswap_aa].base}, will add`);
			// the request will bounce but leave 10Kb on the AA
			await dag.sendPayment({ to_address: oswap_aa, amount: 10000, is_aa: true });
		}
	}
	console.log('checkOswapAAsForSufficientBytes done');
}

async function onAAResponse(objAAResponse) {
	const { aa_address, trigger_unit, trigger_initial_unit, trigger_address, bounced, response } = objAAResponse;
	if (bounced && trigger_address === operator.getAddress())
		return console.log(`=== our request ${trigger_unit} bounced with error`, response.error);
	const arbs = getAffectedArbs([aa_address]);
	console.log(`arbs affected by response from ${aa_address} initial trigger ${trigger_initial_unit} trigger ${trigger_unit}`, arbs);
	if (arbs.length === 0)
		return;
	const unlock = await mutex.lock('resp');
	for (let arb of arbs) {
		if (trigger_initial_unit !== prev_trigger_initial_unit[arb])
			await estimateAndArb(arb);
		prev_trigger_initial_unit[arb] = trigger_initial_unit;
	}
	unlock();
}

async function onAARequest(objAARequest, arrResponses) {
	const address = objAARequest.unit.authors[0].address;
	if (address === operator.getAddress())
		return console.log(`skipping our own request`);
	const aas = arrResponses.map(r => r.aa_address);
	console.log(`request from ${address} trigger ${objAARequest.unit.unit} affected AAs`, aas);
	const arbs = getAffectedArbs(aas);
	console.log(`affected arbs`, arbs);
	for (let arb of arbs)
		await estimateAndArb(arb);
}

function getAffectedArbs(aas) {
	let arbs = [];
	for (let aa of aas) {
		const arb = arbsByAAs[aa];
		if (arb && !arbs.includes(arb))
			arbs.push(arb);
	}
	return arbs;
}

async function initArbList() {
	if (conf.arb_aas && conf.arb_aas.length > 0) {
		arb_aas = conf.arb_aas;
		my_arb_aas = conf.arb_aas;
		return;
	}
	if (!conf.owner)
		throw Error(`neither owner nor arb list`);
	const rows = await dag.getAAsByBaseAAs(conf.arb_base_aas);
	arb_aas = [];
	my_arb_aas = [];
	for (let { address, definition } of rows) {
		arb_aas.push(address);
		if (definition[1].params.owner === conf.owner)
			my_arb_aas.push(address);
	}
	console.log('my arb AAs', my_arb_aas);
	console.log('all arb AAs', arb_aas);
}

async function addArb(arb_aa) {
	console.log(`adding arb ${arb_aa}`);
	await aa_state.followAA(arb_aa);

	// follow the dependent AAs
	const { stable_aa, stable_oswap_aa, reserve_oswap_aa } = await dag.readAAParams(arb_aa);
	await aa_state.followAA(stable_aa);
	await aa_state.followAA(stable_oswap_aa);
	await aa_state.followAA(reserve_oswap_aa);
	oswap_aas[stable_oswap_aa] = true;
	oswap_aas[reserve_oswap_aa] = true;

	const { curve_aa } = await dag.readAAParams(stable_aa);
	const { decision_engine_aa, fund_aa, governance_aa } = await dag.readAAStateVars(curve_aa);
	await aa_state.followAA(decision_engine_aa);
	await aa_state.followAA(fund_aa);
	await aa_state.followAA(governance_aa);

	const { factory } = await dag.readAAParams(stable_oswap_aa);
	await aa_state.followAA(factory);

	if (my_arb_aas.includes(arb_aa)) {
		arbsByAAs[curve_aa] = arb_aa;
		arbsByAAs[stable_oswap_aa] = arb_aa;
		arbsByAAs[reserve_oswap_aa] = arb_aa;
		curvesByArb[arb_aa] = curve_aa;
	}

	await CurveAA.create(curve_aa);
}

async function watchForNewArbs() {
	for (let aa of conf.arb_base_aas) {
		await dag.loadAA(aa);
		network.addLightWatchedAa(aa); // to learn when new arb AAs are defined based on it
	}
	for (let aa of conf.arb_base_aas) {
		eventBus.on("aa_definition_applied-" + aa, async (address, definition) => {
			console.log(`new arb defined ${address}`);
			const owner = definition[1].params.owner;
			if (owner === conf.owner)
				my_arb_aas.push(address);
			arb_aas.push(address);
			await addArb(address);
		});
	}
}


async function watchBuffers() {
	const rows = await dag.getAAsByBaseAAs(conf.buffer_base_aas);
	for (let { address, definition } of rows) {
		let curve_aa = definition[1].params.curve_aa;
		if (CurveAA.get(curve_aa))
			await aa_state.followAA(address);
	}
}

async function watchForNewBuffers() {
	for (let aa of conf.buffer_base_aas) {
		await dag.loadAA(aa);
		network.addLightWatchedAa(aa); // to learn when new buffer AAs are defined based on it
	}
	for (let aa of conf.buffer_base_aas) {
		eventBus.on("aa_definition_applied-" + aa, async (address, definition) => {
			let curve_aa = definition[1].params.curve_aa;
			if (CurveAA.get(curve_aa))
				await aa_state.followAA(address);
		});
	}
}


async function loadLibs() {
	for (let address of conf.lib_aas) {
	//	await dag.loadAA(address);
		const definition = await dag.readAADefinition(address);
		const payload = { address, definition };
		await storage.insertAADefinitions(db, [payload], constants.GENESIS_UNIT, 0, false);
	}
}

async function watchV2Arbs() {
	const rows = await dag.getAAsByBaseAAs(conf.v2_arb_base_aas);
	for (let { address, definition } of rows) {
		const { stable_aa, stable_oswap_aa, reserve_oswap_aa } = definition[1].params;
		const { curve_aa } = await dag.readAAParams(stable_aa);
		if (CurveAA.get(curve_aa)) {
			await aa_state.followAA(address);
			await aa_state.followAA(stable_aa);
			await aa_state.followAA(stable_oswap_aa);
			await aa_state.followAA(reserve_oswap_aa);
		}
	}
}

async function watchV1V2Arbs() {
	const rows = await dag.getAAsByBaseAAs(conf.v1v2_arb_base_aas);
	for (let { address, definition } of rows) {
		const { oswap_v1_aa, oswap_v2_aa } = definition[1].params;
		await aa_state.followAA(address);
		await aa_state.followAA(oswap_v1_aa);
		await aa_state.followAA(oswap_v2_aa);
	}
}

async function startWatching() {
	await loadLibs();
	await initArbList();
	for (let arb_aa of arb_aas)
		await addArb(arb_aa);
	await watchForNewArbs();

	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);
	eventBus.on('data_feeds_updated', estimateAndArbAll);

	// init the buffers linked to the watched curves
	await watchBuffers();
	await watchForNewBuffers();

	await watchV2Arbs();
	await watchV1V2Arbs();

	await light_wallet.waitUntilFirstHistoryReceived();

	setTimeout(estimateAndArbAll, 1000);
	setTimeout(checkOswapAAsForSufficientBytes, 100);
	setInterval(checkOswapAAsForSufficientBytes, 3600 * 1000);
}


exports.startWatching = startWatching;

