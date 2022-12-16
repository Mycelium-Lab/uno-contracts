const AccessManager = artifacts.require('UnoAccessManager')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')
const { promises: fs } = require('fs')
const path = require('path')

const AutoStrategy = artifacts.require('UnoAutoStrategy')

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
    await deployer.deploy(AutoStrategyFactory, AutoStrategy.address, AccessManager.address)

    await addAddress('access-manager', AccessManager.address)
    await addAddress('autostrategy-factory', AutoStrategyFactory.address)
}
