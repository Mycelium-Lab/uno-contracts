const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const beacon = artifacts.require('QuickswapFarmFactoryBeacon')

const distributor = '0x7d3284F1E029b218f96e650Dbc909248A3DA82D7'

module.exports = async function (deployer, network, accounts) {
  const instance = await deployProxy(beacon, [accounts[0]], { deployer })
  await instance.transferDistributor(distributor, {from: accounts[0]})
  console.log('Deployed', instance.address)
}

