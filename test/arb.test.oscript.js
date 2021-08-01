// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const crypto = require('crypto')
const Decimal = require('ocore/formula/common.js').Decimal;
const objectHash = require("ocore/object_hash.js");
const { expect } = require('chai');

const network_fee = 4000
const de_fee = 3000
const de2fund_bytes = 2000
const fund2curve_bytes = 2000
const aa2aa_bytes = 2000

function round(n, precision) {
	return parseFloat(n.toFixed(precision));
}

function number_from_seed(seed) {
	var hash = crypto.createHash("sha256").update(seed.toString(), "utf8").digest("hex");
	var head = hash.substr(0, 16);
	var nominator = new Decimal("0x" + head);
	var denominator = new Decimal("0x1" + "0".repeat(16));
	var num = nominator.div(denominator); // float from 0 to 1
	return num.toNumber();
}

describe('Arb tests', function () {
	this.timeout(1200000)


	before(async () => {
		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.asset({ imported_asset: {} })
			.with.agent({ bs: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/bonded-stablecoin.oscript') })
			.with.agent({ bsf: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/bonded-stablecoin-factory.oscript') })
			.with.agent({ governance: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/governance.oscript') })
			.with.agent({ stable: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/stable.oscript') })
			.with.agent({ fund: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/stability-fund.oscript') })
			.with.agent({ de: path.join(__dirname, '../node_modules/bonded-stablecoin/decision-engine/decision-engine.oscript') })
			.with.agent({ pool: path.join(__dirname, '../node_modules/oswap/public/pool.oscript') })
			.with.agent({ oswapFactory: path.join(__dirname, '../node_modules/oswap/public/factory.oscript') })
			.with.agent({ arb_base: path.join(__dirname, '../arb.oscript') })
			.with.wallet({ oracle: 1e9 })
			.with.wallet({ alice: {base: 10000e9, imported_asset: 1000e9} })
			.with.wallet({ bob: {base: 1000e9, imported_asset: 1000e9} })
			.with.explorer()
			.run()
		console.log('--- agents\n', this.network.agent)
	//	console.log('--- wallets\n', this.network.wallet)
		this.oracle = this.network.wallet.oracle
		this.oracleAddress = await this.oracle.getAddress()
		this.alice = this.network.wallet.alice
		this.aliceAddress = await this.alice.getAddress()
		this.bob = this.network.wallet.bob
		this.bobAddress = await this.bob.getAddress()
		
		this.imported_asset = this.network.asset.imported_asset

		const balance = await this.bob.getBalance()
		console.log(balance)
		expect(balance.base.stable).to.be.equal(1000e9)
	})

	it('Post data feed', async () => {
		const price = 20
		const { unit, error } = await this.oracle.sendMulti({
			messages: [{
				app: 'data_feed',
				payload: {
					GBYTE_USD: price,
				}
			}],
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { unitObj } = await this.oracle.getUnitInfo({ unit: unit })
		const dfMessage = unitObj.messages.find(m => m.app === 'data_feed')
		expect(dfMessage.payload.GBYTE_USD).to.be.equal(20)
		await this.network.witnessUntilStable(unit)

		this.target_p2 = 1/price
	})
	
	it('Bob defines a new stablecoin', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null

		const ts = Math.floor(Date.now() / 1000)
		this.reserve_asset = 'base'
		this.fee_multiplier = 4
		this.sf_capacity_share = 0.3
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.bsf,
			amount: 15000,
			data: {
				reserve_asset: 'base',
				reserve_asset_decimals: 9,
				decimals1: 9,
				decimals2: 4,
				m: 2,
				n: 2,
				fee_multiplier: this.fee_multiplier,
				interest_rate: 0,
				allow_grants: true,
				oracle1: this.oracleAddress,
				feed_name1: 'GBYTE_USD',
				decision_engine_base_aa: '625UKTER5WR5JQPQYS7CU4ST2EXFUCDG',
			//	capped_reward: 1,
				sf_capacity_share: this.sf_capacity_share,
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.network.agent.bsf)
		console.log('vars', vars)
		expect(Object.keys(vars).length).to.be.equal(8)
		for (let name in vars) {
			if (name.startsWith('curve_')) {
				this.curve_aa = name.substr(6)
				expect(vars[name]).to.be.equal("s1^2 s2^2")
			}
		}
		this.asset1 = vars['asset_' + this.curve_aa + '_1'];
		this.asset2 = vars['asset_' + this.curve_aa + '_2'];
		this.asset_stable = vars['asset_' + this.curve_aa + '_stable'];
		this.shares_asset = vars['asset_' + this.curve_aa + '_fund'];
		this.stable_aa = vars['stable_aa_' + this.curve_aa];
		this.governance_aa = vars['governance_aa_' + this.curve_aa];
		this.fund_aa = vars['fund_aa_' + this.curve_aa];

		const { vars: curve_vars } = await this.bob.readAAStateVars(this.curve_aa)
		console.log('curve vars', curve_vars, this.curve_aa)
		expect(curve_vars['asset1']).to.be.equal(this.asset1)
		expect(curve_vars['asset2']).to.be.equal(this.asset2)
		expect(curve_vars['governance_aa']).to.be.equal(this.governance_aa)
		expect(curve_vars['fund_aa']).to.be.equal(this.fund_aa)
		expect(curve_vars['growth_factor']).to.be.equal(1)
		expect(curve_vars['dilution_factor']).to.be.undefined
		expect(curve_vars['interest_rate']).to.be.equal(0)
		expect(parseInt(curve_vars['rate_update_ts'])).to.be.gte(ts)

		this.decision_engine_aa = curve_vars['decision_engine_aa'];

		this.getReserve = (s1, s2) => Math.ceil(1e9*(s1/1e9)**2 * (s2/1e4)**2)
		this.getP1 = (s1, s2) => 2 * (s1/1e9) * (s2/1e4)**2
		this.getP2 = (s1, s2) => (s1/1e9)**2 * 2 * (s2/1e4)
		this.getDistance = (p2, target_p2) => Math.abs(p2 - target_p2) / Math.min(p2, target_p2)
		this.getFee = (avg_reserve, old_distance, new_distance) => Math.ceil(avg_reserve * (new_distance**2 - old_distance**2) * this.fee_multiplier);

		this.buy = (tokens1, tokens2) => {
			const new_supply1 = this.supply1 + tokens1
			const new_supply2 = this.supply2 + tokens2
			const new_reserve = this.getReserve(new_supply1, new_supply2)
			const amount = new_reserve - this.reserve
			const abs_reserve_delta = Math.abs(amount)
			const avg_reserve = (this.reserve + new_reserve)/2
			const p2 = this.getP2(new_supply1, new_supply2)
	
			const old_distance = this.reserve ? this.getDistance(this.p2, this.target_p2) : 0
			const new_distance = this.getDistance(p2, this.target_p2)
			let fee = this.getFee(avg_reserve, old_distance, new_distance);
			if (fee > 0) {
				const reverse_reward = Math.floor((1 - old_distance / new_distance) * this.fast_capacity); // rough approximation
			}

			const fee_percent = round(fee / abs_reserve_delta * 100, 4)
			const reward = old_distance ? Math.floor((1 - new_distance / old_distance) * this.fast_capacity) : 0;
			const reward_percent = round(reward / abs_reserve_delta * 100, 4)

			this.p2 = p2
			this.distance = new_distance
			if (fee > 0) {
				this.slow_capacity += Math.floor(fee / 2)
				this.fast_capacity += fee - Math.floor(fee / 2)
			}
			else if (reward > 0)
				this.fast_capacity -= reward
			
			console.log('p2 =', p2, 'target p2 =', this.target_p2, 'amount =', amount, 'fee =', fee, 'reward =', reward, 'old distance =', old_distance, 'new distance =', new_distance, 'fast capacity =', this.fast_capacity)
	
			if (fee > 0 && reward > 0)
				throw Error("both fee and reward are positive");
			if (fee < 0 && reward < 0)
				throw Error("both fee and reward are negative");
	
			this.supply1 += tokens1
			this.supply2 += tokens2
			this.reserve += amount
	
			return { amount, fee, fee_percent, reward, reward_percent }
		}

		this.supply1 = 0
		this.supply2 = 0
		this.reserve = 0
		this.slow_capacity = 0
		this.fast_capacity = 0
		this.distance = 0

	})



	
	it('Bob defines a new oswap pool for stable/imported-stable', async () => {
		const swap_fee = 0.001e11
		const [asset0, asset1] = (number_from_seed(this.imported_asset) > number_from_seed(this.asset_stable)) ? [this.imported_asset, this.asset_stable] : [this.asset_stable, this.imported_asset]
		this.asset0 = asset0
		const definition = ['autonomous agent', {
			base_aa: this.network.agent.pool,
			params: {
				asset0,
				asset1,
				swap_fee,
				factory: this.network.agent.oswapFactory,
			}
		}];
		const address = objectHash.getChash160(definition);
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.oswapFactory,
			amount: 10000,
			data: {
				create: 1,
				asset0,
				asset1,
				swap_fee,
				address,
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.network.agent.oswapFactory)
		console.log('vars', vars)
		expect(Object.keys(vars).length).to.be.equal(7)
		expect(vars['pools.' + address + '.asset0']).to.be.equal(asset0)
		expect(vars['pools.' + address + '.asset1']).to.be.equal(asset1)
		expect(vars['pools.' + address + '.asset']).to.be.validUnit

		this.stable_pool_shares_asset = vars['pools.' + address + '.asset']
		this.stable_oswap_aa = address

	})
	
	it('Bob defines a new oswap pool for reserve/imported-stable', async () => {
		const swap_fee = 0.001e11
		const [asset0, asset1] = (number_from_seed(this.imported_asset) > number_from_seed(this.reserve_asset)) ? [this.imported_asset, this.reserve_asset] : [this.reserve_asset, this.imported_asset]
		this.asset0 = asset0
		const definition = ['autonomous agent', {
			base_aa: this.network.agent.pool,
			params: {
				asset0,
				asset1,
				swap_fee,
				factory: this.network.agent.oswapFactory,
			}
		}];
		const address = objectHash.getChash160(definition);
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.oswapFactory,
			amount: 10000,
			data: {
				create: 1,
				asset0,
				asset1,
				swap_fee,
				address,
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.network.agent.oswapFactory)
		console.log('vars', vars)
		expect(vars['pools.' + address + '.asset0']).to.be.equal(asset0)
		expect(vars['pools.' + address + '.asset1']).to.be.equal(asset1)
		expect(vars['pools.' + address + '.asset']).to.be.validUnit

		this.reserve_pool_shares_asset = vars['pools.' + address + '.asset']
		this.reserve_oswap_aa = address

	})
	
	it('Bob defines a new arbitrage AA', async () => {
		const definition = ['autonomous agent', {
			base_aa: this.network.agent.arb_base,
			params: {
				stable_aa: this.stable_aa,
				stable_oswap_aa: this.stable_oswap_aa,
				reserve_oswap_aa: this.reserve_oswap_aa,
				owner: this.bobAddress,
			}
		}];
		this.arb_aa = objectHash.getChash160(definition);
		const { unit, error } = await this.bob.sendMulti({
			messages: [{
				app: 'definition',
				payload: {
					address: this.arb_aa,
					definition,
				}
			}],
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit
	})


	it('Bob sends money to arbitrage AA', async () => {
		const amount = 10e9

		const { unit, error } = await this.bob.sendBytes({
			toAddress: this.arb_aa,
			amount,
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.be.eq('added ' + amount)

	})


	it('Alice buys shares, the DE buys tokens', async () => {
		const amount = 3.5e9
		const r = (amount - 1000) / 1e9
		const s2 = 2 * r / this.target_p2
		const s1 = (r / s2 ** 2) ** 0.5
		console.log({r, s1, s2})
		
		const tokens2 = Math.floor(s2 * 1e4)
		const tokens1 = Math.floor(s1 * 1e9)
		const { amount: consumed_amount, fee, fee_percent } = this.buy(tokens1, tokens2)
		console.log({ amount, consumed_amount })
		expect(consumed_amount).to.be.lte(amount)

		const { unit, error } = await this.alice.sendBytes({
			toAddress: this.decision_engine_aa,
			amount: amount + 1e4 + network_fee,
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(round(vars['p2'], 13)).to.be.equal(round(this.p2, 13))
		expect(vars['slow_capacity']).to.be.eq(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.eq(this.fast_capacity)
		expect(vars['lost_peg_ts']).to.be.undefined

		const { vars: de_vars } = await this.alice.readAAStateVars(this.decision_engine_aa)
		expect(de_vars['below_peg_ts']).to.be.undefined

		const { vars: fund_vars } = await this.alice.readAAStateVars(this.fund_aa)
		expect(fund_vars['shares_supply']).to.be.eq(amount + network_fee)
		this.shares_supply = fund_vars['shares_supply']

		// DE to fund
		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.fund_aa,
				amount: amount + 5000 + network_fee,
			},
		])
		const data = unitObj.messages.find(m => m.app === 'data').payload
		expect(data.forwarded_data).to.be.deep.eq({ tokens1, tokens2 })
		
		// fund to curve and alice
		const { response: response2 } = await this.network.getAaResponseToUnit(response.response_unit)
		const { unitObj: unitObj2 } = await this.alice.getUnitInfo({ unit: response2.response_unit })
		expect(Utils.getExternalPayments(unitObj2)).to.deep.equalInAnyOrder([
			{
				address: this.curve_aa,
				amount: amount + network_fee,
			},
			{
				asset: this.shares_asset,
				address: this.aliceAddress,
				amount: amount + network_fee,
			},
		])
		const data2 = unitObj2.messages.find(m => m.app === 'data').payload
		expect(data2).to.be.deep.eq({ tokens1, tokens2 })

		// curve to fund
		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		console.log('resp3 vars', response3.response.responseVars)
		expect(response3.response.responseVars.fee).to.be.eq(fee)
		const { unitObj: unitObj3 } = await this.alice.getUnitInfo({ unit: response3.response_unit })
		expect(Utils.getExternalPayments(unitObj3)).to.deep.equalInAnyOrder([
			{
				address: this.fund_aa,
				asset: this.asset1,
				amount: tokens1,
			},
			{
				address: this.fund_aa,
				asset: this.asset2,
				amount: tokens2,
			},
			{ // the curve returns the excess reserve asset
				address: this.fund_aa,
				amount: amount - consumed_amount - fee,
			},
		])
		expect(unitObj3.messages.find(m => m.app === 'data')).to.be.undefined

	})


	it('Alice buys some stable tokens, the DE immediately corrects the price', async () => {
		const initial_p2 = round(this.p2, 16)
		const tokens1 = 0
		const tokens2 = 50e4
		const { amount, fee, fee_percent } = this.buy(tokens1, tokens2)
		console.log({ amount, fee, fee_percent })
		const p2_1 = round(this.p2, 16)
		const distance_1 = this.distance

		const target_s1 = (this.target_p2 / 2 * (this.supply2 / 1e4) ** (1 - 2)) ** (1 / 2)
		const tokens1_delta = Math.round(target_s1 * 1e9) - this.supply1
		expect(tokens1_delta).to.be.lt(0)
		const { amount: amount2, reward } = this.buy(tokens1_delta, 0)
		console.log({ amount2, reward })

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.curve_aa,
			amount: amount + fee + network_fee + aa2aa_bytes,
			data: {
				tokens2: tokens2,
				tokens2_to: this.stable_aa,
			},
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars['fee%']).to.be.equal(fee_percent+'%')
		expect(response.response.responseVars.fee).to.be.eq(fee)

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)
		expect(vars['lost_peg_ts']).to.be.undefined

		const { vars: de_vars } = await this.alice.readAAStateVars(this.decision_engine_aa)
		expect(de_vars['below_peg_ts']).to.be.undefined

		// curve to DE and alice
		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.stable_aa,
				asset: this.asset2,
				amount: tokens2,
			},
			{
				address: this.stable_aa,
				amount: aa2aa_bytes,
			},
			{
				address: this.decision_engine_aa,
				amount: de_fee,
			},
		])
		const data = unitObj.messages.find(m => m.app === 'data').payload
		data.tx.res.fee_percent = round(data.tx.res.fee_percent, 4)
		data.tx.res.new_distance = round(data.tx.res.new_distance, 13)
		expect(data).to.be.deep.eq({
			to: this.aliceAddress,
			tx: {
				tokens2,
				res: {
					reserve_needed: amount + fee,
					reserve_delta: amount,
					fee,
					regular_fee: fee,
					reward: 0,
					initial_p2,
					p2: p2_1,
					target_p2: this.target_p2,
					new_distance: round(distance_1, 13),
					turnover: amount,
					fee_percent,
					slow_capacity_share: 0.5,
				}
			}
		})
		
		// DE to fund
		const { response: response2 } = await this.network.getAaResponseToUnitByAA(response.response_unit, this.decision_engine_aa)
		expect(response2.response.responseVars.message).to.be.equal("DE fixed the peg")
		const { unitObj: unitObj2 } = await this.alice.getUnitInfo({ unit: response2.response_unit })
		expect(Utils.getExternalPayments(unitObj2)).to.deep.equalInAnyOrder([
			{
				address: this.fund_aa,
				amount: de2fund_bytes,
			},
		])
		const data2 = unitObj2.messages.find(m => m.app === 'data').payload
		expect(data2).to.be.deep.equalInAnyOrder({
			payments: [{
				asset: this.asset1, address: this.curve_aa, amount: -tokens1_delta
			}]
		})

		// fund to curve
		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		const { unitObj: unitObj3 } = await this.alice.getUnitInfo({ unit: response3.response_unit })
		expect(Utils.getExternalPayments(unitObj3)).to.deep.equalInAnyOrder([
			{
				address: this.curve_aa,
				asset: this.asset1,
				amount: -tokens1_delta,
			},
		])
		expect(unitObj3.messages.find(m => m.app === 'data')).to.be.undefined

		// curve to fund
		const { response: response4 } = await this.network.getAaResponseToUnit(response3.response_unit)
		console.log('resp4 vars', response4.response.responseVars)
		expect(response4.response.responseVars.reward).to.be.eq(reward)
		const { unitObj: unitObj4 } = await this.alice.getUnitInfo({ unit: response4.response_unit })
		expect(Utils.getExternalPayments(unitObj4)).to.deep.equalInAnyOrder([
			{
				address: this.fund_aa,
				amount: -amount2 + reward - network_fee,
			},
		])
		expect(unitObj4.messages.find(m => m.app === 'data')).to.be.undefined

		// the fund didn't respond
		const { response: response5 } = await this.network.getAaResponseToUnit(response4.response_unit)
		expect(response5.response_unit).to.be.null
	})


	it("Alice redeems part of stable tokens, the price gets under the peg and the DE does not interfere", async () => {
		const tokens1 = 0
		const tokens2 = 10e4
		const { amount, fee, fee_percent, reward, reward_percent } = this.buy(-tokens1, -tokens2)

		const { unit, error } = await this.alice.sendMulti({
			asset: this.asset_stable,
			base_outputs: [{ address: this.stable_aa, amount: 1e4 }],
			asset_outputs: [{ address: this.stable_aa, amount: tokens2 }],
			messages: [{
				app: 'data',
				payload: {
					to: this.curve_aa,
				}
			}]
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { response: response2 } = await this.network.getAaResponseToUnit(response.response_unit)
		expect(response2.response_unit).to.be.validUnit
		expect(response2.response.responseVars.fee).to.be.equal(fee)

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(vars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(vars['fast_capacity']).to.be.equal(this.fast_capacity)

		const { unitObj } = await this.alice.getUnitInfo({ unit: response2.response_unit })
		expect(vars['lost_peg_ts']).to.be.equal(unitObj.timestamp)
		this.lost_peg_ts = vars['lost_peg_ts']

		const { vars: de_vars } = await this.alice.readAAStateVars(this.decision_engine_aa)
		expect(de_vars['below_peg_ts']).to.be.eq(unitObj.timestamp)
		this.below_peg_ts = de_vars['below_peg_ts']

		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				amount: -amount - fee - network_fee,
			},
			{
				address: this.decision_engine_aa,
				amount: de_fee,
			},
		])

		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		expect(response3.response_unit).to.be.null
		expect(response3.response.responseVars.message).to.be.equal("DE does not interfere yet")

	})

	it('Alice adds liquidity to stable/stable pool', async () => {
		const stable_amount = 40e4
		const imported_amount = 40e4
		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				base: [{ address: this.stable_oswap_aa, amount: 1e4 }],
				[this.asset_stable]: [{ address: this.stable_oswap_aa, amount: stable_amount }],
				[this.imported_asset]: [{ address: this.stable_oswap_aa, amount: imported_amount }],
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.type).to.be.equal("mint")
	})


	it('Alice adds liquidity to stable/reserve pool', async () => {
		const reserve_amount = 10e9
		const imported_amount = 200e4
		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.reserve_asset]: [{ address: this.reserve_oswap_aa, amount: reserve_amount }],
				[this.imported_asset]: [{ address: this.reserve_oswap_aa, amount: imported_amount }],
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.type).to.be.equal("mint")
	})

	
	it('Alice triggers arbitrage to buy T2 from the curve', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal("will arb by buying from the curve")
		console.log(response.response.responseVars);
	})

	it('Alice triggers arbitrage again after buying', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.eq("no arb opportunity exists")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})

	
	it('Alice sells imported stable to stable/reserve pool in order to lower its price and increase the reserve price', async () => {
		const imported_amount = 40e4
		const { unit, error } = await this.alice.sendMulti({
			asset: this.imported_asset,
			base_outputs: [{address: this.reserve_oswap_aa, amount: 1e4}],
			asset_outputs: [{address: this.reserve_oswap_aa, amount: imported_amount}],
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.type).to.be.equal("swap")
	})


	it('Alice triggers arbitrage to sell T2 to the curve', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		console.log(response.response.responseVars);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal("will arb by selling to the curve")
	})
	
	it('Alice triggers arbitrage again after selling', async () => {
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		console.log(response.response.responseVars);
		expect(response.response.error).to.be.eq("no arb opportunity exists")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})
	

	it('Bob withdraws the funds', async () => {
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				withdraw: 1,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })
		const payments = Utils.getExternalPayments(unitObj)
		expect(payments.length).to.eq(1)
		const payment = payments[0]
		expect(payment.asset).to.be.undefined
		expect(payment.address).to.be.eq(this.bobAddress)
		expect(payment.amount).to.be.gt(10e9)

	})


	after(async () => {
	//	await Utils.sleep(3600 * 1000)
		await this.network.stop()
	})
})
