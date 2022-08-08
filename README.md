# Uno Contracts

# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `truffle compile --all`

3. Run specific migration: `truffle migrate --network aurora --compile-none -f 2 --to 2`

# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Run tests with `truffle test --network test`

# Deployed Smart Contracts

All contracts are deployed on the Aurora Blockchain

### UnoAccessManager

0x7Cc6c5e6a04581916A25e01446AdF3cc4CD207BA

## Trisolaris Stable

#### UnoAssetRouterTrisolarisStable

0x474dF60f64bA82553A5D69812a3E01442684cED9

#### UnoFarmFactory

0x033B92eAb5c35B7846453D6De06F86754Db51E85

## Trisolaris Standard

#### UnoAssetRouterTrisolarisStandard

0xf4Fc2E909B3c690a0899b6B84437F113E335E388

#### UnoFarmFactory

0x7B635036B57baEbBe8dc328Af5d02F3F4292e032
