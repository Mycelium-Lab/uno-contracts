const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmPancakeswap')
const AssetRouter = artifacts.require('UnoAssetRouterPancakeswap')

module.exports = async (deployer, network) => {
    if (network !== 'bsc') return

    // AssetRouter upgrade
    const assetRouter = await AssetRouter.at('0x67C8aFF20754629308Ce5bE49F5cfEEF5c7D5296')
    const impl = await prepareUpgrade(assetRouter.address, AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    console.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
