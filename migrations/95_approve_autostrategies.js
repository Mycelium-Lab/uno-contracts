const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

module.exports = async (deployer, network) => {
    if (network !== 'optimism') return

    // Create proposals using Openzeppelin Defender UI

    const autoStrategyFactory = await AutoStrategyFactory.deployed()

    const AssetRouterVelodrome = await readAddress('velodrome-router')
    const velodromeRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterVelodrome)
    if (!velodromeRouterApproved) {
        await autoStrategyFactory.approveAssetRouter(AssetRouterVelodrome.address)
    }
}
