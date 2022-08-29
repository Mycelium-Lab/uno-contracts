const AutoStrategy = artifacts.require('UnoAutoStrategy')

module.exports = async function (deployer, network) {
    if (network != "polygon") return
    await deployer.deploy(AutoStrategy) 

    console.log('New AutoStrategy implementation:', AutoStrategy.address)   //upgradeStrategies(newImplementation)
    //Create proposals using Openzeppelin Defender UI
}
