const { upgradeProxy,forceImport } = require('@openzeppelin/truffle-upgrades')
const UnoFarmQuickswap = artifacts.require('UnoFarmQuickswap')
const UnoFarmFactory = artifacts.require('UnoFarmFactory')
const UnoAssetRouterQuickswap = artifacts.require('UnoAssetRouterQuickswap')


module.exports = async function (deployer) {


    console.log("Upgrading...")
    //UnoAssetRouterQuickswap update
    const assetRouter = await UnoAssetRouterQuickswap.deployed()

   /* await forceImport(
        assetRouter.address,
        UnoAssetRouterQuickswap,
        {
          kind:'uups' 
        }
      )*/

    const instance = await upgradeProxy(assetRouter.address, UnoAssetRouterQuickswap, { deployer })

    //UnoFarmQuickswap update
    await deployer.deploy(UnoFarmQuickswap) 
    const farmFactory = await UnoFarmFactory.deployed()
    await farmFactory.upgradeFarms(UnoFarmQuickswap.address)

    console.log("Upgraded", instance.address)
}

