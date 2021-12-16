const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const beacon = artifacts.require('QuickswapDualFarmFactoryBeacon')

module.exports = async function (deployer, network, accounts) {
  const instance = await deployProxy(beacon, [accounts[0]], { deployer })
  console.log('Deployed', instance.address)
}

