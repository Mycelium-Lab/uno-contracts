const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const QuickswapDualFarmFactoryBeacon = artifacts.require('QuickswapDualFarmFactoryBeacon')
const QuickswapDualFarmUpgradeable = artifacts.require('QuickswapDualFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')

module.exports = async function (deployer) {
    const deployed = await QuickswapDualFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, QuickswapDualFarmFactoryBeacon, { deployer })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(QuickswapDualFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(QuickswapDualFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}