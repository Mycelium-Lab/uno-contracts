require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider')

module.exports = {
    contracts_build_directory: './build',

    api_keys: {
        polygonscan: process.env.POLYGONSCAN
    },

    networks: {
        bsc: {
            provider: () => new HDWalletProvider({
                privateKeys: [process.env.PRIVATE_KEY],
                providerOrUrl: 'https://rpc.ankr.com/bsc',
                chainId: 56,
                pollingInterval: 30000
            }),
            networkCheckTimeout: 10000,
            gas: 300000,
            gasPrice: 5000000000,
            network_id: 56,
            addressIndex: 0
        },
        test: {
            host: '127.0.0.1',
            port: 8545,
            gas: 7500000,
            gasPrice: 200000,
            network_id: 56
        }
    },
    plugins: [
        'truffle-contract-size',
        'truffle-plugin-verify'
    ],
    compilers: {
        solc: {
            version: '0.8.10',
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            }
        }
    },

    db: {
        enabled: false
    }
}
