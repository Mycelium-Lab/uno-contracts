const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmQuickswapDual')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswapDual')

module.exports = async function (deployer) {
    //AssetRouter upgrade
    const assetRouter = await AssetRouter.deployed()
    const instance = await upgradeProxy(assetRouter.address, AssetRouter, { deployer })

    //Farm upgrade
    await deployer.deploy(Farm) 
    const farmFactory = await FarmFactory.deployed()
    await farmFactory.upgradeFarms(Farm.address)

    console.log("Upgraded", instance.address)
}

