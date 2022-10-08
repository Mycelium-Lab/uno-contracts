const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const AssetRouterApeswap = artifacts.require('UnoAssetRouterApeswap')
const AssetRouterPancakeswap = artifacts.require('UnoAssetRouterPancakeswap')

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return
    const autoStrategyFactory = await AutoStrategyFactory.deployed()
    const apeswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterApeswap.address)
    if (!apeswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterApeswap.address)
    }
    const pancakeswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterPancakeswap.address)
    if (!pancakeswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterPancakeswap.address)
    }
}
