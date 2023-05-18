const {
    expectRevert, expectEvent, BN, constants, time
} = require('@openzeppelin/test-helpers')
// const { expectRevertCustomError } = require('custom-error-test-helper')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')

const IERC20 = artifacts.require('IERC20')
const UnoAssetRouterQuickswap = artifacts.require('UnoAssetRouterQuickswap')
const UnoFarmQuickswap = artifacts.require('UnoFarmQuickswap')
const UnoAssetRouterSushiswap = artifacts.require('UnoAssetRouterSushiswap')
const UnoFarmSushiswap = artifacts.require('UnoFarmSushiswap')
const FarmFactory = artifacts.require('UnoFarmFactory')

const AccessManager = artifacts.require('UnoAccessManager')

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0xafb76771c98351aa7fca13b130c9972181612b54' // usdt-usdc quickswap
const pool2 = '0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001' // usdt-usdc sushiswap

const account1 = '0x477b8D5eF7C2C42DB84deB555419cd817c336b6F' // -u
const account2 = '0x72A53cDBBcc1b9efa39c834A540550e23463AAcB' // -u
const account3 = '0x7EF2D7B88D43F1831241F0dD63E0bdeF048Ba8aC' // -u
const distributor = '0x2aae5d0f3bee441acc1fb2abe9c2672a54f4bb48' // -u

const amounts = [new BN('100000000000')]

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAutoStrategy', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]
    const feeCollector = accounts[2]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let snapshotId
    let snapshotIdBeforeDeposit

    let assetRouterQuickswap
    let assetRouterSushiswap
    before(async () => {
        accessManager = await AccessManager.new({ from: admin }) // accounts[0] is admin
        await accessManager.grantRole(
            '0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c',
            distributor,
            { from: admin }
        )// DISTRIBUTOR_ROLE
        await accessManager.grantRole(
            '0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f',
            liquidityManager,
            { from: admin }
        ) // LIQUIDITY_MANAGER_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {
            from: admin
        }) // PAUSER_ROLE
        await accessManager.grantRole('0x2dca0f5ce7e75a4b43fe2b0d6f5d0b7a2bf92ecf89f8f0aa17b8308b67038821', feeCollector, {
            from: admin
        }) // FEE_COLLECTOR_ROLE

        const autoStrategyImplementation = await AutoStrategy.new()
        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)

        assetRouterQuickswap = await deployProxy(
            UnoAssetRouterQuickswap,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationQuickswap = await UnoFarmQuickswap.new()
        await FarmFactory.new(farmImplementationQuickswap.address, accessManager.address, assetRouterQuickswap.address)

        assetRouterSushiswap = await deployProxy(
            UnoAssetRouterSushiswap,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationSushiswap = await UnoFarmSushiswap.new()
        await FarmFactory.new(farmImplementationSushiswap.address, accessManager.address, assetRouterSushiswap.address)

        await autoStrategyFactory.approveAssetRouter(assetRouterQuickswap.address, {
            from: admin
        })
        await autoStrategyFactory.approveAssetRouter(assetRouterSushiswap.address, {
            from: admin
        })

        await autoStrategyFactory.createStrategy([
            { pool: pool1, assetRouter: assetRouterQuickswap.address },
            { pool: pool2, assetRouter: assetRouterSushiswap.address }
        ])

        autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))

        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot.result
    })
    describe('Deposits', () => {
        describe('deposit tokens', () => {
            let id

            let balanceBeforeAcc1
            let balanceBeforeAcc2
            let balanceBefore1
            let balanceBefore2
            let block1; let
                block2
            before(async () => {
                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                await tokenA.approve(autoStrategy.address, amounts[0], {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, amounts[0], {
                    from: account1
                })

                await tokenA.transfer(account2, amounts[0], {
                    from: account1
                })
                await tokenB.transfer(account2, amounts[0], {
                    from: account1
                })

                await tokenA.approve(autoStrategy.address, amounts[0], {
                    from: account2
                })
                await tokenB.approve(autoStrategy.address, amounts[0], {
                    from: account2
                })

                // Deposit
                await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account1, constants.ZERO_ADDRESS, {
                    from: account1
                })
                block1 = await web3.eth.getBlock('latest')
                balanceBeforeAcc1 = await autoStrategy.balanceOf(account1)
                balanceBefore1 = await autoStrategy.balanceOf(constants.ZERO_ADDRESS)

                await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, account3, {
                    from: account2
                })
                block2 = await web3.eth.getBlock('latest')
                balanceBeforeAcc2 = await autoStrategy.balanceOf(account2)
                balanceBefore2 = await autoStrategy.balanceOf(account3)
            })
            it('Collects fee', async () => {
                await time.increase(31536000)// 1 year after

                // should fail silently because it throws return on address (0)
                await autoStrategy.collectFee(constants.ZERO_ADDRESS, { from: account1 })
                assert.equal(
                    balanceBefore1.toString(),
                    (await autoStrategy.balanceOf(constants.ZERO_ADDRESS)).sub(balanceBefore1).toString(),
                    'Token balance changed after collectFee on address (0)'
                )

                await autoStrategy.collectFee(feeCollector, { from: account1 })
                const block3 = await web3.eth.getBlock('latest')
                const expectedFee = (new BN((block3.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul(balanceBeforeAcc1.add(new BN('1000')))
                    .div(new BN('1000000000000000000'))
                const balanceFeeCollector = await autoStrategy.balanceOf(feeCollector)
                assert.equal(
                    expectedFee.toString(),
                    balanceFeeCollector.toString(),
                    'Token balance not changed for fee collector after collectFee'
                )

                await autoStrategy.collectFee(account3, { from: account1 })
                const block4 = await web3.eth.getBlock('latest')
                const expectedFee2 = (new BN((block4.timestamp - block2.timestamp).toString())).mul(new BN('317097919')).mul(balanceBeforeAcc2)
                    .div(new BN('1000000000000000000'))
                assert.equal(
                    expectedFee2.toString(),
                    (await autoStrategy.balanceOf(account3)).sub(balanceBefore2).toString(),
                    'Token balance not changed for account3 after collectFee'
                )

                await time.increase(31536000)// another 1 year after
                const balanceFeeCollectorBefore = await autoStrategy.balanceOf(feeCollector)
                await autoStrategy.collectFee(feeCollector, { from: account1 })
                // We add expectedFee2 because it was not claimed yet
                // We loose precision here because we divide first then add, so we use approxeq with 1 as a param
                const expectedFee3 = (new BN(block4.timestamp - block3.timestamp)).mul(new BN('317097919')).mul(new BN('2')).mul((expectedFee).add(balanceBeforeAcc1.add(new BN('1000'))))
                    .div(new BN('1000000000000000000'))
                const expectedFee4 = (new BN(((await web3.eth.getBlock('latest')).timestamp - block4.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul((expectedFee).add(expectedFee2).add(balanceBeforeAcc1.add(new BN('1000'))))
                    .div(new BN('1000000000000000000'))
                // expectedFee2 is added because we did not collect it earlier
                approxeq(
                    expectedFee2.add(expectedFee3).add(expectedFee4),
                    (await autoStrategy.balanceOf(feeCollector)).sub(balanceFeeCollectorBefore),
                    new BN(1),
                    'Token balance not changed for fee collector after collectFee'
                )

                const balanceAcc3Before = await autoStrategy.balanceOf(account3)
                await autoStrategy.collectFee(account3, { from: account1 })
                const expectedFee5 = (new BN(((await web3.eth.getBlock('latest')).timestamp - block4.timestamp).toString())).mul(new BN('317097919')).mul(balanceBeforeAcc2)
                    .div(new BN('1000000000000000000'))
                assert.equal(
                    expectedFee5.toString(),
                    (await autoStrategy.balanceOf(account3)).sub(balanceAcc3Before).toString(),
                    'Token balance not changed for acc3 after collectFee'
                )
            })
            // TODO: check collectFee on withdraw
            // TODO: check comming from previous verison
            // TODO: check userStake calculation
            // TODO: check transfers
            // TODO: check withdrawals affecting fee amount (calling _collectFee)
            // TODO: totalSupply fantomTotalSupply check
        })
    })
})
