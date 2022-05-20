const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const UnoAccessManager = artifacts.require('UnoAccessManager')
const UnoFarmQuickswap = artifacts.require('UnoFarmQuickswap')
const UnoFarmFactory = artifacts.require('UnoFarmFactory')
const UnoAssetRouterQuickswap = artifacts.require('UnoAssetRouterQuickswap')

const distributor = '0x7d3284F1E029b218f96e650Dbc909248A3DA82D7'
const pauser = '0xA7b7DDF752Ed3A9785F747a3694760bB8994e15F'

module.exports = async function (deployer, network, accounts) {
  await deployer.deploy(UnoAccessManager, {overwrite: false, from: accounts[0]})
  await deployer.deploy(UnoFarmQuickswap)
  const assetRouter = await deployProxy(
    UnoAssetRouterQuickswap,
    //[AccessManager.address, FarmFactory.address],
    { deployer, kind: 'uups', initializer: false }
  )
  await deployer.deploy(UnoFarmFactory, UnoFarmQuickswap.address, UnoAccessManager.address, assetRouter.address)

  const accessManager = await UnoAccessManager.deployed()
  //DISTRIBUTOR_ROLE
  const distributorHasRole = await accessManager.hasRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor)
  if(!distributorHasRole){
    await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor) 
    console.log('Distributor set')
  }
  //PAUSER_ROLE
  const pauserHasRole = await accessManager.hasRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser)
  if(!pauserHasRole){
    await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser) 
    console.log('Pauser set')
  }

  console.log('Deployed', assetRouter.address)
}

