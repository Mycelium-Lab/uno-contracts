const { upgradeProxy } = require("@openzeppelin/truffle-upgrades");
const FarmFactory = artifacts.require("UnoFarmFactory");
const { promises: fs } = require("fs");
const path = require("path");

const Farm = artifacts.require("UnoFarmTrisolarisStandart");
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStandart");

module.exports = async function (deployer) {
  //AssetRouter upgrade
  const assetRouter = await AssetRouter.deployed();
  const instance = await upgradeProxy(assetRouter.address, AssetRouter, { deployer });

  //Farm upgrade
  await deployer.deploy(Farm);
  const factoryAddress = await readFactoryAddress();
  const farmFactory = await FarmFactory.at(factoryAddress);
  await farmFactory.upgradeFarms(Farm.address);

  console.log("Upgraded", instance.address);
};

async function readFactoryAddress() {
  const data = await fs.readFile(path.resolve(__dirname, "./addresses/factories.json"));
  var json = JSON.parse(data);

  return json.sushiswap;
}
