const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')
const fs = require('fs/promises')
const path = require('path')

require('dotenv').config()
const ethers = require('ethers')
const { AdminClient } = require('defender-admin-client')

const client = new AdminClient({ apiKey: process.env.DEFENDER_ACCOUNT, apiSecret: process.env.DEFENDER_PASSWORD })

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

module.exports = async (deployer, network) => {
    if (network !== 'bsc') return

    const multisig = await readAddress('multisig')
    const timelockAddress = await readAddress('timelock')
    const ABI = ['function approveAssetRouter(address _assetRouter)']

    const autoStrategyFactory = await AutoStrategyFactory.deployed()

    const AssetRouterApeswap = await readAddress('apeswap-router')
    const apeswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterApeswap)
    if (!apeswapRouterApproved) {
        // await autoStrategyFactory.approveAssetRouter(AssetRouterApeswap.address)
        const data = (new ethers.utils.Interface(ABI)).encodeFunctionData('approveAssetRouter', [AssetRouterApeswap])
        const timelock = {
            target: autoStrategyFactory.address,
            value: '0',
            data,
            salt: ethers.BigNumber.from(ethers.utils.randomBytes(32))._hex,
            address: timelockAddress,
            delay: '172800'
        }
        timelock.operationId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'bytes', 'bytes32', 'bytes32'],
            [timelock.target, timelock.value, timelock.data, '0x0000000000000000000000000000000000000000000000000000000000000000', timelock.salt]
        ))

        const proposal = await client.createProposal({
            contractId: `bsc-${autoStrategyFactory.address}`, // Target contract
            title: 'Approve asset router', // Title of the proposal
            description: 'Approve asset router', // Description of the proposal
            type: 'custom', // Use 'custom' for custom admin actions
            targetFunction: { name: 'approveAssetRouter', inputs: [{ type: 'address', name: '_assetRouter' }] }, // Function ABI
            functionInputs: [AssetRouterApeswap], // Arguments to the function
            via: multisig, // Address to execute proposal
            viaType: 'Gnosis Safe', // 'Gnosis Safe', 'Gnosis Multisig', or 'EOA'
            timelock,
            metadata: { sendValue: '0' },
            isArchived: false
        })
        console.log('Proposal:', proposal.url)
    }

    const AssetRouterPancakeswap = await readAddress('pancakeswap-router')
    const pancakeswapRouterApproved = await autoStrategyFactory.assetRouterApproved(AssetRouterPancakeswap)
    if (!pancakeswapRouterApproved) {
        // await autoStrategyFactory.approveAssetRouter(AssetRouterPancakeswap.address)
        const data = (new ethers.utils.Interface(ABI)).encodeFunctionData('approveAssetRouter', [AssetRouterPancakeswap])
        const timelock = {
            target: autoStrategyFactory.address,
            value: '0',
            data,
            salt: ethers.BigNumber.from(ethers.utils.randomBytes(32))._hex,
            address: timelockAddress,
            delay: '172800'
        }
        timelock.operationId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'bytes', 'bytes32', 'bytes32'],
            [timelock.target, timelock.value, timelock.data, '0x0000000000000000000000000000000000000000000000000000000000000000', timelock.salt]
        ))

        const proposal = await client.createProposal({
            contractId: `bsc-${autoStrategyFactory.address}`, // Target contract
            title: 'Approve asset router', // Title of the proposal
            description: 'Approve asset router', // Description of the proposal
            type: 'custom', // Use 'custom' for custom admin actions
            targetFunction: { name: 'approveAssetRouter', inputs: [{ type: 'address', name: '_assetRouter' }] }, // Function ABI
            functionInputs: [AssetRouterPancakeswap], // Arguments to the function
            via: multisig, // Address to execute proposal
            viaType: 'Gnosis Safe', // 'Gnosis Safe', 'Gnosis Multisig', or 'EOA'
            timelock,
            metadata: { sendValue: '0' },
            isArchived: false
        })
        console.log('Proposal:', proposal.url)
    }
}
