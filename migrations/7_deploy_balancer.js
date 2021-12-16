const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const beacon = artifacts.require('BalancerFarmFactoryBeacon')
const distributor = '0x7d3284F1E029b218f96e650Dbc909248A3DA82D7'

module.exports = async function (deployer, network, accounts) {
  const instance = await deployProxy(beacon, [accounts[0], distributor], { deployer })
  console.log('Deployed', instance.address)
}