# Uno Contracts
# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `npm run compile`

3. Run specific migration: `npm run deploy-${appname}`, where appname can be:
```
traderjoe
```

# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Compile all contracts before running tests `npm run compile`

4. Run tests with `npm run test`


# Deployed Smart Contracts

All contracts are deployed on the Avalanche Blockchain

### UnoAccessManager

0x85f5A518399b072288Ff3fb7022EAdE71f99c7BC


## Traderjoe

#### UnoAssetRouterTraderjoe

0xe137ca875d80470B1B552aAFf1488093063f4322

#### UnoFarmFactory

0x6Eae93D177BFDDAF5ee238F55C36A847A35E62A0
