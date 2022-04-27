const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const QuickswapDualFarmFactoryBeacon = artifacts.require('QuickswapDualFarmFactoryBeacon')
const QuickswapDualFarmUpgradeable = artifacts.require('QuickswapDualFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')
const distributor = '0x7d3284F1E029b218f96e650Dbc909248A3DA82D7'

module.exports = async function (deployer) {
    const deployed = await QuickswapDualFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, QuickswapDualFarmFactoryBeacon, { deployer/*, call: {fn:'transferDistributor', args:[distributor]}*/ })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(QuickswapDualFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(QuickswapDualFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}