const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const AccessManager = artifacts.require("UnoAccessManager");
const FarmFactory = artifacts.require("UnoFarmFactory");
const { promises: fs } = require("fs");
const path = require("path");

const { distributor, pauser } = require("./addresses/addresses");

const Farm = artifacts.require("UnoFarmTrisolarisStable");
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStable");
const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";

module.exports = async function (deployer, network, accounts) {
  await deployer.deploy(Farm);
};
