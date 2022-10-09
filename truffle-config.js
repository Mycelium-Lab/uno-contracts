require('dotenv').config()
const HDWalletProvider = require('@truffle/hdwallet-provider')

module.exports = {
    contracts_build_directory: './build',

    api_keys: {
        aurorascan: process.env.AURORASCAN
    },

    networks: {
        aurora: {
            networkCheckTimeout: 100000,
            timeoutBlocks: 2000,
            provider: () => new HDWalletProvider({
                privateKeys: [process.env.PRIVATE_KEY],
                providerOrUrl: `https://mainnet.aurora.dev/${process.env.AURORA_PLUS}`,
                chainId: 1313161554,
                pollingInterval: 30000
            }),
            network_id: 1313161554,
            gas: 4500000,
            gasPrice: 70000000,
            addressIndex: 0
        },
        test: {
            host: '127.0.0.1',
            port: 8545,
            network_id: '1313161554',
            gas: 7500000,
            gasPrice: 50
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
