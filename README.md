# Uno Contracts
# Development

1. Provide your private key in the PRIVATE_KEY field in the `.env` file

2. Compile all contracts before running migrations `npm run compile`

3. Run specific migration: `npm run deploy-${appname}`, where appname can be:
```
velodrome
```

# Testing

1. Make sure you have `ganache` available from command line, it can be installed with `npm install -g ganache`.

2. Start ganache with `npm run ganache`. *Note!* It's preconfigured here, so if you run your ganache differently, the tests will be failing.

3. Compile all contracts before running tests `npm run compile`

4. Run tests with `npm run test`


# Deployed Smart Contracts

All contracts are deployed on the Optimism Blockchain

### UnoAccessManager

0x693148ae24AbB879e2f63f1b36f5594e54b19140


## Velodrome

#### UnoAssetRouterVelorome

0xAea777e4ee848CB99339719E663aF5320c2307A4

#### UnoFarmFactory

0x59E6a7Ea02Fe7c373aa005e1ab2d250F08DBEa89
