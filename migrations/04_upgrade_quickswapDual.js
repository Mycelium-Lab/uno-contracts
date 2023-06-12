global.crypto = require('crypto')

const Farm = artifacts.require('UnoFarmQuickswapDual')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswapDual')

require('dotenv').config()
const ethers = require('ethers')
const { prepareUpgrade } = require('@openzeppelin/truffle-upgrades')
const fs = require('fs/promises')
const path = require('path')
const { AdminClient } = require('defender-admin-client')

const client = new AdminClient({ apiKey: process.env.DEFENDER_ACCOUNT, apiSecret: process.env.DEFENDER_PASSWORD })

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return

    const multisig = await readAddress('multisig')
    const timelockAddress = await readAddress('timelock')
    {
        // AssetRouter upgrade
        const UnoAssetRouter = await readAddress('quickswapDual-router')
        const impl = await prepareUpgrade(UnoAssetRouter, AssetRouter, { deployer })
        console.log('New Router implementation:', impl) // upgradeTo(newImplementation)

        const ABI = ['function upgradeTo(address newImplementation)']
        const data = (new ethers.utils.Interface(ABI)).encodeFunctionData('upgradeTo', [impl])
        const timelock = {
            target: UnoAssetRouter,
            value: '0',
            data,
            salt: ethers.BigNumber.from(ethers.utils.randomBytes(32))._hex,
            address: timelockAddress,
            delay: '86400'
        }
        timelock.operationId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'bytes', 'bytes32', 'bytes32'],
            [timelock.target, timelock.value, timelock.data, '0x0000000000000000000000000000000000000000000000000000000000000000', timelock.salt]
        ))

        const proposal = await client.createProposal({
            contractId: `matic-${UnoAssetRouter}`, // Target contract
            title: 'Upgrade', // Title of the proposal
            description: 'Upgrade', // Description of the proposal
            type: 'custom', // Use 'custom' for custom admin actions
            targetFunction: { name: 'upgradeTo', inputs: [{ type: 'address', name: 'newImplementation' }] }, // Function ABI
            functionInputs: [impl], // Arguments to the function
            via: multisig, // Address to execute proposal
            viaType: 'Gnosis Safe', // 'Gnosis Safe', 'Gnosis Multisig', or 'EOA'
            timelock,
            metadata: { sendValue: '0' },
            isArchived: false
        })
        console.log('Proposal:', proposal.url)
    }

    {
        // Farm upgrade
        const UnoFarmFactory = await readAddress('quickswapDual-factory')

        await deployer.deploy(Farm)
        const impl = Farm.address
        console.log('New Farm implementation:', impl) // upgradeFarms(newImplementation)

        const ABI = ['function upgradeFarms(address newImplementation)']
        const data = (new ethers.utils.Interface(ABI)).encodeFunctionData('upgradeFarms', [impl])
        const timelock = {
            target: UnoFarmFactory,
            value: '0',
            data,
            salt: ethers.BigNumber.from(ethers.utils.randomBytes(32))._hex,
            address: timelockAddress,
            delay: '86400'
        }
        timelock.operationId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint256', 'bytes', 'bytes32', 'bytes32'],
            [timelock.target, timelock.value, timelock.data, '0x0000000000000000000000000000000000000000000000000000000000000000', timelock.salt]
        ))

        const proposal = await client.createProposal({
            contractId: `matic-${UnoFarmFactory}`, // Target contract
            title: 'Upgrade', // Title of the proposal
            description: 'Upgrade', // Description of the proposal
            type: 'custom', // Use 'custom' for custom admin actions
            targetFunction: { name: 'upgradeFarms', inputs: [{ type: 'address', name: 'newImplementation' }] }, // Function ABI
            functionInputs: [impl], // Arguments to the function
            via: multisig, // Address to execute proposal
            viaType: 'Gnosis Safe', // 'Gnosis Safe', 'Gnosis Multisig', or 'EOA'
            timelock,
            metadata: { sendValue: '0' },
            isArchived: false
        })
        console.log('Proposal:', proposal.url)
    }
}
