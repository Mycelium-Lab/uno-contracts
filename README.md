# Uno Contracts

# Checkout the right branch

`polygon+` - core UNO contracts plus autostrategies on Polygon

`aurora` - core UNO contracts on Aurora

Please note that both branches include identical core contracts except for the `/contracts/apps` directory where specific (app / farm - related) contracts for Polygon and Aurora are located, the `/test` directory and the configs.

Branch `polygon+` also includes the autostrategies contracts located in the `/contracts/autostrategy` directory.

# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `npm run compile`

3. Run specific migration: `truffle migrate --network polygon --compile-none -f 2 --to 2`

# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Compile all contracts before running tests `npm run compile`

4. Run tests with `npm run test`


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

## Balancer

#### UnoAssetRouterBalancer

0xa9877C4cbd6b4c38604ee44a11948Aa4716D5b37

#### UnoFarmFactory

0xBAE4733e8E761DE20DF4Cd2c62823776489957e8

## Meshswap

#### UnoAssetRouterMeshswap

0xa86212cDb51867022302D194d373c3D45b06f76D

#### UnoFarmFactory

0x7A7a1ccAd0Df7193Cef581eD04FD9B03E940411c