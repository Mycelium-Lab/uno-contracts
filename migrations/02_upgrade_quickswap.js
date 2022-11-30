const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmQuickswap')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswap')

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return

    // AssetRouter upgrade
    const assetRouter = await AssetRouter.at('0xF5AE5c5151aE25019be8b328603C18153d669461')
    const impl = await prepareUpgrade(assetRouter.address, AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    console.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
