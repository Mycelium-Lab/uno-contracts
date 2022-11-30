const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmApeswap')
const AssetRouter = artifacts.require('UnoAssetRouterApeswap')

module.exports = async (deployer, network) => {
    if (network !== 'bsc') return

    // AssetRouter upgrade
    const assetRouter = await AssetRouter.at('0xbCaC58E0c159404fb0b7862C092aAF1cdED46F76')
    const impl = await prepareUpgrade(assetRouter.address, AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    console.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
