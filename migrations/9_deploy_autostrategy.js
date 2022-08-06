const AccessManager = artifacts.require('UnoAccessManager')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const {liquidityManager, pauser} = require('./addresses/addresses')

const AutoStrategy = artifacts.require('UnoAutoStrategy')

module.exports = async function (deployer, network, accounts) {
  if (network != "polygon") return
  // AccessManager deployment, dont deploy if already deployed on this network
  await deployer.deploy(AccessManager, {overwrite: false, from: accounts[0]})
  // Deploy new AutoStrategy implementation for factory to deploy
  await deployer.deploy(AutoStrategy)
  // Deploy Factory
  await deployer.deploy(AutoStrategyFactory, AutoStrategy.address, AccessManager.address)

  const accessManager = await AccessManager.deployed()
  //LIQUIDITY_MANAGER_ROLE
  const liquidityManagerHasRole = await accessManager.hasRole('0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f', liquidityManager)
  if(!liquidityManagerHasRole){
    await accessManager.grantRole('0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f', liquidityManager) 
    console.log('Liquidity manager set')
  }
  //PAUSER_ROLE
  const pauserHasRole = await accessManager.hasRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser)
  if(!pauserHasRole){
    await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser) 
    console.log('Pauser set')
  }
  console.log('Deployed', AutoStrategyFactory.address)
}