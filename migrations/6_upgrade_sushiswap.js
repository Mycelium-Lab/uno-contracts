const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const SushiswapFarmFactoryBeacon = artifacts.require('SushiswapFarmFactoryBeacon')
const SushiswapFarmUpgradeable = artifacts.require('SushiswapFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')
const distributor = '0x7d3284F1E029b218f96e650Dbc909248A3DA82D7'

module.exports = async function (deployer) {
    const deployed = await SushiswapFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, SushiswapFarmFactoryBeacon, { deployer/*, call: {fn:'transferDistributor', args:[distributor]}*/ })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(SushiswapFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(SushiswapFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}