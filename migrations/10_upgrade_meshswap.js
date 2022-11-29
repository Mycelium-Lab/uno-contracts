const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmMeshswap')
const AssetRouter = artifacts.require('UnoAssetRouterMeshswap')

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return

    // AssetRouter upgrade
    const assetRouter = await AssetRouter.at('0xa86212cDb51867022302D194d373c3D45b06f76D')
    const impl = await prepareUpgrade(assetRouter.address, AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    sconsole.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
