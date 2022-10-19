const AccessManager = artifacts.require('UnoAccessManager')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const AutoStrategy = artifacts.require('UnoAutoStrategyBanxe')

const banxe = '0x57154597a53bb06a8707eefa8177c630c589fb0c'

module.exports = async (deployer, network, accounts) => {
    if (network !== 'polygon') return
    // AccessManager deployment, dont deploy if already deployed on this network
    await deployer.deploy(AccessManager, { overwrite: false, from: accounts[0] })
    // Deploy autoStrategy
    const autoStrategy = await deployProxy(
        AutoStrategy,
        [
            [
                { pool: '0xafb76771c98351aa7fca13b130c9972181612b54', assetRouter: '0xF5AE5c5151aE25019be8b328603C18153d669461' },
                { pool: '0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001', assetRouter: '0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8' }
            ],
            AccessManager.address,
            banxe
        ],
        { deployer, kind: 'uups' }
    )

    console.log('Deployed', autoStrategy.address)
}
