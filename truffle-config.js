require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider')

module.exports = {
    contracts_build_directory: './build',

    api_keys: {
        polygonscan: process.env.POLYGONSCAN
    },

    networks: {
        polygon: {
            provider: () => new HDWalletProvider({
                privateKeys: [process.env.PRIVATE_KEY],
                providerOrUrl: 'https://polygon-rpc.com/',
                chainId: 137,
                pollingInterval: 30000
            }),
            networkCheckTimeout: 10000,
            gas: 7500000,
            gasPrice: 500000000000,
            network_id: 137,
            addressIndex: 0
        },
        test: {
            host: '127.0.0.1',
            port: 8545,
            gas: 7500000,
            gasPrice: 18675969,
            network_id: 137
        }
    },
    plugins: [
        'truffle-contract-size',
        'truffle-plugin-verify'
    ],
    compilers: {
        solc: {
            version: '0.8.19',
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 8000
                }
            }
        }
    },

    db: {
        enabled: false
    }
}
