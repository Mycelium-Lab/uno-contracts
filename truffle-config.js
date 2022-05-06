require('dotenv').config()
const HDWalletProvider = require("@truffle/hdwallet-provider");

module.exports = {
  contracts_build_directory: "./build",

  networks: {
    polygon: {
      provider: () => {
        return new HDWalletProvider({
          privateKeys:  [process.env.PRIVATE_KEY],
          providerOrUrl: "wss://speedy-nodes-nyc.moralis.io/001e5f8996373e891a2971f5/polygon/mainnet/ws",
          chainId: 137
        })
      },
      gas: 7500000,
      gasPrice: 70000000000,
      network_id: 137,
      addressIndex: 0
    },
    test: {
      host: '127.0.0.1',
      port: 8545,
      gas: 7500000,
      gasPrice: 1,
      network_id: 137
    }
  },

  compilers: {
    solc: {
      version: "0.8.10",
      settings: {
        optimizer: {
          enabled: true,
          runs: 1
        },
      }
    }
  },

  db: {
    enabled: false
  }
};
