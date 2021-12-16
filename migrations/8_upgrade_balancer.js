const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const BalancerFarmFactoryBeacon = artifacts.require('BalancerFarmFactoryBeacon')
const BalancerFarmUpgradeable = artifacts.require('BalancerFarmUpgradeable')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')

module.exports = async function (deployer) {
    const deployed = await BalancerFarmFactoryBeacon.deployed()
    const instance = await upgradeProxy(deployed.address, BalancerFarmFactoryBeacon, { deployer })
    const farmBeacon = await deployed.farmBeacon()
    let upgradeableBeacon = await UpgradeableBeacon.at(farmBeacon)
    await deployer.deploy(BalancerFarmUpgradeable) 
    await upgradeableBeacon.upgradeTo(BalancerFarmUpgradeable.address)
    console.log("Upgraded", instance.address)
}