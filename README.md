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

0x05404cBA2dBF1EBe965a6f0fe11C58dcabD3eFca

## Trisolaris Stable

#### UnoAssetRouterTrisolarisStable

0xe8B78361C3B7db18116aFc3D145ABB958Ca5a8d0

#### UnoFarmFactory

0x552f55dDbCD8a5e2ae6f07b5e369675A62c1F957

## Trisolaris Standard

#### UnoAssetRouterTrisolarisStandard

0xd19cfA4942E3aE4E94A53dEdee2A0a14F3FB4D97

#### UnoFarmFactory

0x64c9899fcdB6f9565Ba69B0939Aec51e320C5489