# Uno Contracts

# Checkout the right branch

`polygon+` - core UNO contracts plus autostrategies on Polygon

`aurora` - core UNO contracts on Aurora

Please note that both branches include identical core contracts except for the `/contracts/apps` directory where specific (app / farm - related) contracts for Polygon and Aurora are located, the `/test` directory and the configs.

Branch `polygon+` also includes the autostrategies contracts located in the `/contracts/autostrategy` directory.

# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `truffle compile --all`

3. Run specific migration: `truffle migrate --network polygon --compile-none -f 2 --to 2`

# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Run tests with `truffle test --network test`


# Deployed Smart Contracts

All contracts are deployed on the Polygon(Matic) Blockchain

### UnoAccessManager

0xbCc48E7aF0100ca3DFf680dE995d4C2726F81b71

## UnoAutoStrategyFactory

0x4c6eA6999D66a0aee4691644E0c8811369Cb6783

## Quickswap

#### UnoAssetRouterQuickswap

0xF5AE5c5151aE25019be8b328603C18153d669461

#### UnoFarmFactory

0x56888a3c0BC31a0b83bCd6cCd4dC2726E26239D7

## Quickswap Dual

#### UnoAssetRouterQuickswapDual

0xFf6d5909e81F7B764E58E0Af78eB9E938f187721

#### UnoFarmFactory

0x047A3AE1DC74f520a34a674dBD09895407FBBFC2

## Sushiswap

#### UnoAssetRouterSushiswap

0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8

#### UnoFarmFactory

0xb8698FbDFcd6044fA9C56938a50D7D0FDD22e8F0

## Apeswap

#### UnoAssetRouterApeswap

0xd121211de080D4cB3F588826a2EedaC75d721B17

#### UnoFarmFactory

0x35E19FD59212985209339aDD9fe0649604ffB7Be
