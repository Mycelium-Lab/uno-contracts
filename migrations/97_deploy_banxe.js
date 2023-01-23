const AccessManager = artifacts.require('UnoAccessManager')
const AutoStrategy = artifacts.require('UnoAutoStrategyBanxe')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyBanxeFactory')
const fs = require('fs/promises')
const path = require('path')

const banxe = '0x57154597a53bb06a8707eefa8177c630c589fb0c'

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

async function addAddress(key, address) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    json[key] = address
    await fs.writeFile(path.resolve(__dirname, './addresses/addresses.json'), JSON.stringify(json))
}

module.exports = async (deployer, network, accounts) => {
    if (network !== 'polygon') return
    // AccessManager deployment, dont deploy if already deployed on this network
    await deployer.deploy(AccessManager, { overwrite: false, from: accounts[0] })
    // Deploy new AutoStrategy implementation for factory to deploy
    await deployer.deploy(AutoStrategy)
    // Deploy Factory
    const AssetRouterQuickswap = await readAddress('quickswap-router')
    const AssetRouterQuickswapDual = await readAddress('quickswapDual-router')
    const AssetRouterSushiswap = await readAddress('sushiswap-router')
    const AssetRouterApeswap = await readAddress('apeswap-router')
    const AssetRouterMeshswap = await readAddress('meshswap-router')

    await deployer.deploy(
        AutoStrategyFactory,
        AutoStrategy.address,
        AccessManager.address,
        [AssetRouterQuickswap, AssetRouterQuickswapDual, AssetRouterSushiswap, AssetRouterApeswap, AssetRouterMeshswap],
        banxe
    )

    await addAddress('access-manager', AccessManager.address)
    await addAddress('banxe-factory', AutoStrategyFactory.address)

    // first
    const first_strat = [
        { pool: '0xAFB76771C98351Aa7fCA13B130c9972181612b54', assetRouter: '0xF5AE5c5151aE25019be8b328603C18153d669461' }, // USDC-USDT quickswap
        { pool: '0x4B1F1e2435A9C96f7330FAea190Ef6A7C8D70001', assetRouter: '0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8' } // USDC-USDT sushiswap
    ]
    // second
    const second_strat = [
        { pool: '0xAFB76771C98351Aa7fCA13B130c9972181612b54', assetRouter: '0xF5AE5c5151aE25019be8b328603C18153d669461' }, // USDC-USDT quickswap
        { pool: '0x4B1F1e2435A9C96f7330FAea190Ef6A7C8D70001', assetRouter: '0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8' }, // USDC-USDT sushiswap
        { pool: '0xCD578F016888B57F1b1e3f887f392F0159E26747', assetRouter: '0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8' }, // USDC-DAI sushiswap
        { pool: '0xEd8413eCEC87c3d4664975743c02DB3b574012a7', assetRouter: '0xF5AE5c5151aE25019be8b328603C18153d669461' }, // USDC-DAI quickswap
        { pool: '0x97Efe8470727FeE250D7158e6f8F63bb4327c8A2', assetRouter: '0xF5AE5c5151aE25019be8b328603C18153d669461' } // DAI-USDT quickswap
    ]

    const autoStrategyFactory = await AutoStrategyFactory.deployed()
    await autoStrategyFactory.createStrategy(first_strat)
    await autoStrategyFactory.createStrategy(second_strat)

    console.log('Deployed', AutoStrategyFactory.address)
}
