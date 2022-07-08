const { deployProxy } = require("@openzeppelin/truffle-upgrades");
const AccessManager = artifacts.require("UnoAccessManager");
const FarmFactory = artifacts.require("UnoFarmFactory");
const { promises: fs } = require("fs");
const path = require("path");

const { distributor, pauser } = require("./addresses/addresses");

const Farm = artifacts.require("UnoFarmTrisolarisStable");
const ISwap = artifacts.require("ISwap");
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStable");
const swap_usdc_usdt_usn = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970";

module.exports = async function (deployer, network, accounts) {
  const farm = await Farm.deployed();

  // await farm.initialize(swap_usdc_usdt_usn, swap_usdc_usdt_usn);

  const swap = await ISwap.at(swap_usdc_usdt_usn);
  const swapStorage = await swap.swapStorage();
  const lpPairWeb3 = swapStorage["6"];
  console.log(`lpPairWeb3: ${lpPairWeb3.toString()}`);

  let lpPair = await farm.lpPair();
  console.log(`lpPair: ${lpPair.toString()}`);

  let pid = await farm.pid();
  console.log(pid.toString());

  let poolToken = await farm.poolTokens(1);
  console.log(poolToken.toString());
};
