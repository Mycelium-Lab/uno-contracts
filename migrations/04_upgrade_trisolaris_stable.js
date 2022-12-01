const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')

const Farm = artifacts.require('UnoFarmTrisolarisStable')
const AssetRouter = artifacts.require('UnoAssetRouterTrisolarisStable')

module.exports = async (deployer, network) => {
    if (network !== 'aurora') return

    // AssetRouter upgrade
    const impl = await prepareUpgrade('0xe8B78361C3B7db18116aFc3D145ABB958Ca5a8d0', AssetRouter, { deployer })

    // Farm upgrade
    await deployer.deploy(Farm)

    console.log('New Router implementation:', impl) // UpgradeTo(newImplementation)
    console.log('New Farm implementation:', Farm.address) // UpgradeFarms(newImplementation)
    // Create proposals using Openzeppelin Defender UI
}
