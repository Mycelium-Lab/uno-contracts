const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')
const { promises: fs } = require('fs')
const path = require('path')

const Farm = artifacts.require('UnoFarmTraderjoe')
const AssetRouter = artifacts.require('UnoAssetRouterTraderjoe')

async function addAddress(key, address) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    json[key] = address
    await fs.writeFile(path.resolve(__dirname, './addresses/addresses.json'), JSON.stringify(json))
}

module.exports = async (deployer, network, accounts) => {
    if (network !== 'avalanche') return
    // AccessManager deployment, dont deploy if already deployed on this network
    await deployer.deploy(AccessManager, { overwrite: false, from: accounts[0] })
    // Deploy new Farm implementation for factory to deploy
    await deployer.deploy(Farm)
    // Deploy AssetRouter
    const assetRouter = await deployProxy(
        AssetRouter,
        { deployer, kind: 'uups', initializer: false }
    )
    // Deploy Factory
    await deployer.deploy(FarmFactory, Farm.address, AccessManager.address, assetRouter.address)

    await addAddress('access-manager', AccessManager.address)
    await addAddress('traderjoe-router', assetRouter.address)
    await addAddress('traderjoe-factory', FarmFactory.address)
}
