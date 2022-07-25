const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')
const { promises : fs } = require("fs")
const path = require("path")

const {distributor, pauser} = require('./addresses/addresses')

const Farm = artifacts.require('UnoFarmSushiswap')
const AssetRouter = artifacts.require('UnoAssetRouterSushiswap')

module.exports = async function (deployer, network, accounts) {
  if (network != "polygon") return
  // AccessManager deployment, dont deploy if already deployed on this network
  await deployer.deploy(AccessManager, {overwrite: false, from: accounts[0]})
  // Deploy new Farm implementation for factory to deploy
  await deployer.deploy(Farm)
  // Deploy AssetRouter
  const assetRouter = await deployProxy(
    AssetRouter,
    { deployer, kind: 'uups', initializer: false }
  )
  // Deploy Factory
  await deployer.deploy(FarmFactory, Farm.address, AccessManager.address, assetRouter.address)
  await addFactoryAddress(FarmFactory.address)

  const accessManager = await AccessManager.deployed()
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

async function addFactoryAddress(address){
  const data = await fs.readFile(path.resolve(__dirname, './addresses/factories.json'))
  var json = JSON.parse(data)

  json.sushiswap = address
  await fs.writeFile(path.resolve(__dirname, './addresses/factories.json'), JSON.stringify(json))
}