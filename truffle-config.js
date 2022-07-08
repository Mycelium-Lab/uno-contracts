require("dotenv").config();
const HDWalletProvider = require("@truffle/hdwallet-provider");

const fs = require("fs");
const mnemonic = fs.readFileSync(".secret").toString().trim();

require("dotenv").config();

const setupWallet = url => {
  return new HDWalletProvider({
    mnemonic: mnemonic,
    providerOrUrl: url,
    numberOfAddresses: 1,
  });
};

module.exports = {
  contracts_build_directory: "./build",

  networks: {
    aurora: {
      networkCheckTimeout: 100000,
      timeoutBlocks: 2000,
      provider: () => new HDWalletProvider(mnemonic, "https://mainnet.aurora.dev"),
      // provider: () => new HDWalletProvider(mnemonic, "https://aurora-mainnet.infura.io/v3/125bc41c3c54485d8a57568bc1a83829"),
      network_id: 0x4e454152,
      gas: 7500000,
      gasPrice: 70000000,
      from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    },
    development: {
      host: "localhost",
      port: 8545,
      network_id: "1313161554",
      gas: 7500000,
      gasPrice: 765625000,
    },
    auroraTestnet: {
      provider: () => setupWallet("wss://testnet.aurora.dev"),
      network_id: 0x4e454153,
      gas: 10000000,
      from: "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a",
    },
  },
  plugins: ["truffle-contract-size"],
  compilers: {
    solc: {
      version: "0.8.10",
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
};
