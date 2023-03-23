# Uno Contracts

# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `npm run compile`

3. Deploy specific app with: `npm run deploy-${appname}`, where appname can be:
```
apeswap
pancakeswap
```
# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Compile all contracts before running tests `npm run compile`

4. Run tests with `npm run test`


# Deployed Smart Contracts

All contracts are deployed on the BSC Blockchain

## UnoAccessManager

0xB3C5c180025065ebdB4d056aFBD602950143d43d

## UnoAutoStrategyFactory

0x9aeb257C2C9B5E0855012083D35428A331e83d6e

### Apeswap 

#### UnoAssetRouterApeswap

0xbCaC58E0c159404fb0b7862C092aAF1cdED46F76

#### UnoFarmFactory

0x50cE50F5c2835D3A9c257A27D814E8d2C039449b

### Pancakeswap 

#### UnoAssetRouterPancakeswap

0x67C8aFF20754629308Ce5bE49F5cfEEF5c7D5296

#### UnoFarmFactory

0xd62c64a8846d704c7775679982219e477dcB564A
