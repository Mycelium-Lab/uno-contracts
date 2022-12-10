const AutoStrategy = artifacts.require('UnoAutoStrategy')
const { promises: fs } = require('fs')
const path = require('path')

async function readAddress(app) {
    const data = await fs.readFile(path.resolve(__dirname, './addresses/addresses.json'))
    const json = JSON.parse(data)

    return json[app]
}

module.exports = async (deployer, network) => {
    if (network !== 'polygon') return
    await deployer.deploy(AutoStrategy)
    const impl = AutoStrategy.address
    console.log('New AutoStrategy implementation:', impl) // upgradeStrategies(newImplementation)

    const multisig = await readAddress('multisig')
    const timelockAddress = await readAddress('timelock')
    const AutoStrategyFactory = await readAddress('autostrategy-factory')

    const ABI = ['function upgradeStrategies(address newImplementation)']
    const data = (new ethers.utils.Interface(ABI)).encodeFunctionData('upgradeStrategies', [impl])
    const timelock = {
        target: AutoStrategyFactory,
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
        contractId: `matic-${AutoStrategyFactory}`, // Target contract
        title: 'Upgrade', // Title of the proposal
        description: 'Upgrade', // Description of the proposal
        type: 'custom', // Use 'custom' for custom admin actions
        targetFunction: { name: 'upgradeStrategies', inputs: [{ type: 'address', name: 'newImplementation' }] }, // Function ABI
        functionInputs: [impl], // Arguments to the function
        via: multisig, // Address to execute proposal
        viaType: 'Gnosis Safe', // 'Gnosis Safe', 'Gnosis Multisig', or 'EOA'
        timelock,
        metadata: { sendValue: '0' },
        isArchived: false
    })
    console.log('Proposal:', proposal.url)
}
