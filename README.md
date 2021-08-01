# Arbitrage AA and bot for arbitraging between Ostable and 2 Oswap pools

This Autonomous Agent seeks opportunities to make profit by trading between [Ostable](https://ostable.org) and 2 [Oswap](https://oswap.io) pools that make a circle, e.g.
* GBYTE -> OUSDV2 on Ostable
* OUSDV2 -> USDC on Oswap
* USDC -> GBYTE on Oswap

or the same circle in the opposite direction.

The AA trades only if it gets more GBYTE in the final trade than it sent in the first one.

The companion bot watches the markets and triggers the AA when it sees an arbitrage opportunity.


## Usage

The base AA is already deployed (see its address by opening `arb.oscript` in VS Code with [Oscript plugin](https://marketplace.visualstudio.com/items?itemName=obyte.oscript-vscode-plugin)), deploy your personal arbitrage AA by indicating the following params:
* `owner`: your address.
* `stable_aa`: stable AA address, look it up on the Parameters tap at ostable.org.
* `stable_oswap_aa`: Oswap Pool AA that connects two stablecoins: one from Ostable (O-token such as OUSDV2) and a stablecoin imported from another network (such as USDC) via [Counterstake bridge](https://counterstake.org).
* `reserve_oswap_aa`: Oswap Pool AA that connects the imported stablecoin with the reserve currency (such as GBYTE).

Indicate your address in the `owner` field of your conf.json.

Run the bot:
```bash
node run.js stable-oswap-arb 2>errlog
```

Add some money to your arb AA and a small amount (for network fees) to the bot's balance.


### Run tests
```bash
yarn test
```

