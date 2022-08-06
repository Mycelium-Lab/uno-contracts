const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')
const AutoStrategy = artifacts.require('UnoAutoStrategy')

module.exports = async function (deployer, network) {
    if (network != "polygon") return
    await deployer.deploy(AutoStrategy) 
    const autoStrategyFactory = await AutoStrategyFactory.deployed()
    await autoStrategyFactory.upgradeStrategies(AutoStrategy.address)

    console.log("Upgraded", AutoStrategyFactory.address)
}
