const { upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const FarmFactory = artifacts.require('UnoFarmFactory')
const { promises : fs } = require("fs")
const path = require("path")

const Farm = artifacts.require('UnoFarmQuickswap')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswap')

module.exports = async function (deployer, network) {
    if (network != "polygon") return
    //AssetRouter upgrade
    const assetRouter = await AssetRouter.deployed()
    const instance = await upgradeProxy(assetRouter.address, AssetRouter, { deployer })

    //Farm upgrade
    await deployer.deploy(Farm) 
    const factoryAddress = await readFactoryAddress()
    const farmFactory = await FarmFactory.at(factoryAddress)
    await farmFactory.upgradeFarms(Farm.address)

    console.log("Upgraded", instance.address)
}

async function readFactoryAddress(){
    const data = await fs.readFile(path.resolve(__dirname, './addresses/factories.json'))
    var json = JSON.parse(data)
  
    return json.quickswap
}