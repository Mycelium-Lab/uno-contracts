const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const SushiswapFarmFactoryBeacon = artifacts.require('SushiswapFarmFactoryBeacon')
const SushiswapFarmUpgradeable = artifacts.require('SushiswapFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')

module.exports = async function (deployer) {
    const deployed = await SushiswapFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, SushiswapFarmFactoryBeacon, { deployer })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(SushiswapFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(SushiswapFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}