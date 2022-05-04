const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const QuickswapFarmFactoryBeacon = artifacts.require('QuickswapFarmFactoryBeacon')
const QuickswapFarmUpgradeable = artifacts.require('QuickswapFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')

module.exports = async function (deployer) {
    const deployed = await QuickswapFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, QuickswapFarmFactoryBeacon, { deployer })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(QuickswapFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(QuickswapFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}