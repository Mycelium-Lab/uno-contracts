# Uno Contracts

# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `truffle compile --all`

3. Run specific migration: `truffle migrate --network polygon --compile-none -f 2 --to 2`

# Deployed Smart Contracts

All contracts are deployed on the Polygon(Matic) Blockchain

### UnoAccessManager

0xbCc48E7aF0100ca3DFf680dE995d4C2726F81b71

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

### Example of ganache test config for aurora:

`ganache -i=1313161554 -q=true -k="berlin" -f="https://mainnet.aurora.dev" -u="0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a" -u="0x01bF61e1bCBfb54a0cdb6C41f5457EC08B997872" -u="0x949b82Dfc04558bC4D3CA033A1B194915a3A3bEE"`
