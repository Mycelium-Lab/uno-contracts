const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return

    // Create proposals using Openzeppelin Defender UI

    const autoStrategyFactory = await AutoStrategyFactory.deployed()

    const AssetRouterQuickswap = await readAddress('quickswap-router')
    const quickswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterQuickswap)
    if (!quickswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterQuickswap.address)
    }

    const AssetRouterQuickswapDual = await readAddress('quickswapDual-router')
    const quickswapDualRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterQuickswapDual)
    if (!quickswapDualRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterQuickswapDual.address)
    }

    const AssetRouterSushiswap = await readAddress('sushiswap-router')
    const sushiswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterSushiswap)
    if (!sushiswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterSushiswap.address)
    }

    const AssetRouterApeswap = await readAddress('apeswap-router')
    const apeswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterApeswap)
    if (!apeswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterApeswap.address)
    }

    const AssetRouterMeshswap = await readAddress('meshswap-router')
    const meshswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterMeshswap)
    if (!meshswapRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterMeshswap.address)
    }
}
