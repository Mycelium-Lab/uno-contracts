const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const AssetRouterQuickswap = artifacts.require('UnoAssetRouterQuickswap')
const AssetRouterQuickswapDual = artifacts.require('UnoAssetRouterQuickswapDual')
const AssetRouterSushiswap = artifacts.require('UnoAssetRouterSushiswap')

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return
    const autoStrategyFactory = await AutoStrategyFactory.deployed()
    const quickswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterQuickswap.address)
    if (!quickswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterQuickswap.address)
    }
    const quickswapDualRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterQuickswapDual.address)
    if (!quickswapDualRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterQuickswapDual.address)
    }
    const sushiswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterSushiswap.address)
    if (!sushiswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterSushiswap.address)
    }
}
