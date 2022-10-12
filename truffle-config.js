require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider')

console.log(process.env.PRIVATE_KEY)
module.exports = {
    contracts_build_directory: './build',

    networks: {
        avalanche: {
            provider: () => {
                return new HDWalletProvider({
                    mnemonic: process.env.PRIVATE_KEY,
                    providerOrUrl: 'https://api.avax.network/ext/bc/C/rpc',
                    chainId: 43114,
                    pollingInterval: 30000,
                })
            },
            networkCheckTimeout: 10000,

            network_id: 43114,
            addressIndex: 0,
        },
        test: {
            host: '127.0.0.1',
            port: 8545,
            gas: 7500000,
            gasPrice: 70000000000,
            network_id: 43114,
        },
    },
    plugins: ['truffle-contract-size', 'truffle-plugin-verify'],
    compilers: {
        solc: {
            version: '0.8.17',
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200,
                },
            },
        },
    },

    db: {
        enabled: false,
    },
}
