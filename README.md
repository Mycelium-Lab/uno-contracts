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

0x3d9E9cFF89BA8184b31574e8D0C383E6B6Dfcdfd

## Trisolaris Stable

#### UnoAssetRouterTrisolarisStable

0xd275724762f25bb152dC4657F62582C8dd3BF34F

#### UnoFarmFactory

0x7a6966cdc49b0703ccE1d97c6083ae8E3548E548

## Trisolaris Standard

#### UnoAssetRouterTrisolarisStandard

0x16c0e00703887d7593Ababa4155B1e21da72b8b6

#### UnoFarmFactory

0xd2dd365Bd448116788853097AaE1eedE78338918