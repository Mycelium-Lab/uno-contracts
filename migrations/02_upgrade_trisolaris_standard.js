const { prepareUpgrade/* , forceImport */ } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmTrisolarisStandard')
const AssetRouter = artifacts.require('UnoAssetRouterTrisolarisStandard')

module.exports = async (deployer, network) => {
    if (network !== 'aurora') return

    // await forceImport('0xd19cfA4942E3aE4E94A53dEdee2A0a14F3FB4D97', AssetRouter)

    // AssetRouter upgrade
    // const assetRouter = await AssetRouter.at('0xd19cfA4942E3aE4E94A53dEdee2A0a14F3FB4D97')// '0xd19cfA4942E3aE4E94A53dEdee2A0a14F3FB4D97'
    const impl = await prepareUpgrade('0xd19cfA4942E3aE4E94A53dEdee2A0a14F3FB4D97', AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    console.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
