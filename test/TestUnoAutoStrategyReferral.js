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
const AutoStrategyV0 = artifacts.require('UnoAutoStrategyV0')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0xafb76771c98351aa7fca13b130c9972181612b54' // usdt-usdc quickswap
const pool2 = '0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001' // usdt-usdc sushiswap

const account1 = '0x477b8D5eF7C2C42DB84deB555419cd817c336b6F' // -u
const account2 = '0x72A53cDBBcc1b9efa39c834A540550e23463AAcB' // -u
const account3 = '0x7EF2D7B88D43F1831241F0dD63E0bdeF048Ba8aC' // -u
const distributor = '0x2aae5d0f3bee441acc1fb2abe9c2672a54f4bb48' // -u

const amounts = [new BN('100000000000'), new BN('1000')]

approxeq = (bn1, bn2, epsilon, message) => {
    console.log(bn1.toString())
    console.log(bn2.toString())
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAutoStrategy', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]
    const feeCollector = accounts[3]
    const randomAccount = accounts[5]
    const account4 = accounts[4]
    const account5 = accounts[6]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let snapshotId

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
    describe('Collect Fee', () => {
        let id

        let balanceBeforeAcc1
        let balanceBeforeAcc2
        let balanceBefore1
        let balanceBefore2
        let block1; let
            block2
        let tokenA
        let tokenB
        before(async () => {
            id = await autoStrategy.poolID()

            const data = await autoStrategy.pools(id)

            tokenA = await IERC20.at(data.tokenA)
            tokenB = await IERC20.at(data.tokenB)

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
        let block3
        let block4
        let expectedFee
        let expectedFee2
        it('Collects fee after 1 year', async () => {
            // even though we did not mint fee yet, totalSupply is already increased because of fantomTotalSupply
            const expectedTotalDeposits = balanceBeforeAcc2.add(balanceBeforeAcc1).add(new BN('1000'))
            assert.equal(
                expectedTotalDeposits.toString(),
                (await autoStrategy.totalSupply()).toString(),
                'Total Supply not correct'
            )
            await time.increase(31536000)// 1 year after

            // should fail silently because it throws return on address (0)
            let tx = await autoStrategy.collectFee(constants.ZERO_ADDRESS, { from: account1 })
            expectEvent.notEmitted(tx, 'CollectFee')
            assert.equal(
                balanceBefore1.toString(),
                (await autoStrategy.balanceOf(constants.ZERO_ADDRESS)).sub(balanceBefore1).toString(),
                'Token balance changed after collectFee on address (0)'
            )

            tx = await autoStrategy.collectFee(feeCollector, { from: account1 })
            block3 = await web3.eth.getBlock('latest')
            expectedFee = (new BN((block3.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul(balanceBeforeAcc1.add(new BN('1000')))
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: feeCollector,
                fee: expectedFee
            })
            const balanceFeeCollector = await autoStrategy.balanceOf(feeCollector)
            assert.equal(
                expectedFee.toString(),
                balanceFeeCollector.toString(),
                'Token balance not changed for fee collector after collectFee'
            )
            const expectedTotalDeposits2 = balanceBeforeAcc2.add(balanceBeforeAcc1).add(new BN('1000')).add(expectedFee)
            assert.equal(
                expectedTotalDeposits2.toString(),
                (await autoStrategy.totalSupply()).toString(),
                'Total Supply not correct'
            )

            tx = await autoStrategy.collectFee(account3, { from: account1 })
            block4 = await web3.eth.getBlock('latest')
            expectedFee2 = (new BN((block4.timestamp - block2.timestamp).toString())).mul(new BN('317097919')).mul(balanceBeforeAcc2)
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: account3,
                fee: expectedFee2
            })
            assert.equal(
                expectedFee2.toString(),
                (await autoStrategy.balanceOf(account3)).sub(balanceBefore2).toString(),
                'Token balance not changed for account3 after collectFee'
            )
        })
        it('Collects fee after another year', async () => {
            await time.increase(31536000)// another 1 year after
            const balanceFeeCollectorBefore = await autoStrategy.balanceOf(feeCollector)
            let tx = await autoStrategy.collectFee(feeCollector, { from: account1 })
            expectEvent(tx, 'CollectFee', {
                recipient: feeCollector
            })
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
                new BN(2),
                'Token balance not changed for fee collector after collectFee'
            )

            const balanceAcc3Before = await autoStrategy.balanceOf(account3)
            tx = await autoStrategy.collectFee(account3, { from: account1 })
            const expectedFee5 = (new BN(((await web3.eth.getBlock('latest')).timestamp - block4.timestamp).toString())).mul(new BN('317097919')).mul(balanceBeforeAcc2)
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: account3,
                fee: expectedFee5
            })
            assert.equal(
                expectedFee5.toString(),
                (await autoStrategy.balanceOf(account3)).sub(balanceAcc3Before).toString(),
                'Token balance not changed for acc3 after collectFee'
            )
        })
        let block5
        it('Changes referrer', async () => {
            await time.increase(31536000)// another 1 year after
            await tokenA.transfer(account2, amounts[0], {
                from: account1
            })
            await tokenB.transfer(account2, amounts[0], {
                from: account1
            })
            await tokenA.transfer(account3, amounts[1], {
                from: account1
            })
            await tokenB.transfer(account3, amounts[1], {
                from: account1
            })
            await tokenA.approve(autoStrategy.address, amounts[0], {
                from: account2
            })
            await tokenB.approve(autoStrategy.address, amounts[0], {
                from: account2
            })
            await tokenA.approve(autoStrategy.address, amounts[1], {
                from: account3
            })
            await tokenB.approve(autoStrategy.address, amounts[1], {
                from: account3
            })

            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, account4, {
                from: account2
            })
            const balance = await autoStrategy.balanceOf(account2)
            block5 = await web3.eth.getBlock('latest')

            await time.increase(31536000)// another 1 year after

            const expectedA = (await autoStrategy.userStake(account3)).stakeA.add((await autoStrategy.userStake(account3)).leftoverA)
            const expectedB = (await autoStrategy.userStake(account3)).stakeB.add((await autoStrategy.userStake(account3)).leftoverB)
            const balanceABefore = await tokenA.balanceOf(account3)
            const balanceBBefore = await tokenB.balanceOf(account3)
            let tx = await autoStrategy.withdraw(id, 0, 0, 0, account3, { from: account3 })
            expectEvent(tx, 'CollectFee', {
                recipient: account3
            })

            const balanceAAfter = await tokenA.balanceOf(account3)
            approxeq(
                expectedA,
                balanceAAfter.sub(balanceABefore),
                new BN(1000),
                'TokenA balance not correct'
            )

            const balanceBAfter = await tokenB.balanceOf(account3)
            approxeq(
                expectedB,
                balanceBAfter.sub(balanceBBefore),
                new BN(1000),
                'TokenB balance not correct'
            )

            tx = await autoStrategy.collectFee(account4, { from: account4 })
            const expectedFee6 = (new BN(((await web3.eth.getBlock('latest')).timestamp - block5.timestamp).toString())).mul(new BN('317097919')).mul(balance)
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: account4,
                fee: expectedFee6
            })

            assert.equal(
                expectedFee6.toString(),
                (await autoStrategy.balanceOf(account4)).toString(),
                'Token balance not changed for acc4 after collectFee'
            )
        })
    })

    describe('Collect Fee on Withdraw', () => {
        let id

        let tokenA
        let tokenB
        before(async () => {
            await timeMachine.revertToSnapshot(snapshotId)
            const snapshot = await timeMachine.takeSnapshot()
            snapshotId = snapshot.result

            id = await autoStrategy.poolID()

            const data = await autoStrategy.pools(id)

            tokenA = await IERC20.at(data.tokenA)
            tokenB = await IERC20.at(data.tokenB)

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

            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, account3, {
                from: account2
            })
        })
        it('Collects fee', async () => {
            await time.increase(31536000)// 1 year after
            {
                const {
                    stakeA, stakeB, leftoverA, leftoverB
                } = await autoStrategy.userStake(feeCollector)
                const balanceABefore = await tokenA.balanceOf(feeCollector)
                const balanceBBefore = await tokenB.balanceOf(feeCollector)
                const tx = await autoStrategy.withdraw(id, 0, 0, 0, feeCollector, { from: feeCollector })
                expectEvent(tx, 'CollectFee', {
                    recipient: feeCollector
                })

                assert.equal(
                    (await autoStrategy.userStake(feeCollector)).stakeA.add((await autoStrategy.userStake(feeCollector)).leftoverA).toString(),
                    '0',
                    'TokenA balance not null'
                )

                assert.equal(
                    (await autoStrategy.userStake(feeCollector)).stakeB.add((await autoStrategy.userStake(feeCollector)).leftoverB).toString(),
                    '0',
                    'TokenB balance not null'
                )

                // This won't be exact because of slippage
                const balanceAAfter = await tokenA.balanceOf(feeCollector)
                approxeq(
                    stakeA.add(leftoverA),
                    balanceAAfter.sub(balanceABefore),
                    new BN(1000),
                    'Token A balance not changed for fee collector after collectFee'
                )

                const balanceBAfter = await tokenB.balanceOf(feeCollector)
                approxeq(
                    stakeB.add(leftoverB),
                    balanceBAfter.sub(balanceBBefore),
                    new BN(1000),
                    'Token B balance not changed for fee collector after collectFee'
                )
            }

            const {
                stakeA, stakeB, leftoverA, leftoverB
            } = await autoStrategy.userStake(account3)
            const balanceABefore = await tokenA.balanceOf(account3)
            const balanceBBefore = await tokenB.balanceOf(account3)
            const tx = await autoStrategy.withdraw(id, 0, 0, 0, account3, { from: account3 })
            expectEvent(tx, 'CollectFee', {
                recipient: account3
            })

            assert.equal(
                (await autoStrategy.userStake(account3)).stakeA.add((await autoStrategy.userStake(account3)).leftoverA).toString(),
                '0',
                'TokenA balance not null'
            )

            assert.equal(
                (await autoStrategy.userStake(account3)).stakeB.add((await autoStrategy.userStake(account3)).leftoverB).toString(),
                '0',
                'TokenB balance not null'
            )

            // This won't be exact because of slippage
            const balanceAAfter = await tokenA.balanceOf(account3)
            approxeq(
                stakeA.add(leftoverA),
                balanceAAfter.sub(balanceABefore),
                new BN(1000),
                'Token A balance not changed for fee collector after collectFee'
            )

            const balanceBAfter = await tokenB.balanceOf(account3)
            approxeq(
                stakeB.add(leftoverB),
                balanceBAfter.sub(balanceBBefore),
                new BN(1000),
                'Token B balance not changed for fee collector after collectFee'
            )
        })
        it('Not collects fee after full withdrawal', async () => {
            await time.increase(31536000)// 1 year after
            const balance = await autoStrategy.balanceOf(account2)
            let tx = await autoStrategy.withdraw(id, balance, 0, 0, account2, { from: account2 })
            // there is no fee for account2
            expectEvent.notEmitted(tx, 'CollectFee')
            assert.equal(
                (await autoStrategy.balanceOf(account2)).toString(),
                '0',
                'Token balance not null'
            )
            await time.increase(31536000)// 1 year after
            // We transfer all account2's tokens to not affect userStake
            tx = await autoStrategy.collectFee(account3, { from: account3 })
            expectEvent(tx, 'CollectFee', { recipient: account3 })
            await autoStrategy.transfer(randomAccount, await autoStrategy.balanceOf(account3), { from: account3 })
            await time.increase(31536000)// 1 year after
            assert.equal(
                ((await autoStrategy.userStake(account3)).stakeA).add((await autoStrategy.userStake(account3)).leftoverA).toString(),
                '0',
                'Fee staked not null'
            )
            assert.equal(
                ((await autoStrategy.userStake(account3)).stakeB).add((await autoStrategy.userStake(account3)).leftoverB).toString(),
                '0',
                'Fee staked not null'
            )

            const balanceAcc3Before = await autoStrategy.balanceOf(account3)
            tx = await autoStrategy.collectFee(account3, { from: account1 })
            expectEvent.notEmitted(tx, 'CollectFee')
            assert.equal(
                (await autoStrategy.balanceOf(account3)).toString(),
                balanceAcc3Before.toString(),
                'Token balance changed'
            )
        })
    })
    describe('Sets correct totalSupply', () => {
        let id

        let tokenA
        let tokenB
        let block1
        let block2
        let balanceBefore1
        let balanceBefore2
        before(async () => {
            await timeMachine.revertToSnapshot(snapshotId)
            const snapshot = await timeMachine.takeSnapshot()
            snapshotId = snapshot.result
            id = await autoStrategy.poolID()

            const data = await autoStrategy.pools(id)

            tokenA = await IERC20.at(data.tokenA)
            tokenB = await IERC20.at(data.tokenB)

            await tokenA.approve(autoStrategy.address, amounts[0], {
                from: account1
            })
            await tokenB.approve(autoStrategy.address, amounts[0], {
                from: account1
            })
            // Deposit
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account1, constants.ZERO_ADDRESS, {
                from: account1
            })
            block1 = await web3.eth.getBlock('latest')
            balanceBefore1 = await autoStrategy.balanceOf(account1)

            await time.increase(31536000)// 1 year after

            await tokenA.approve(autoStrategy.address, amounts[0], {
                from: account1
            })
            await tokenB.approve(autoStrategy.address, amounts[0], {
                from: account1
            })
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, constants.ZERO_ADDRESS, {
                from: account1
            })
            block2 = await web3.eth.getBlock('latest')
            balanceBefore2 = await autoStrategy.balanceOf(account2)
        })
        it('Sets correct totalSupply', async () => {
            const expectedTotalDeposits = balanceBefore1.add(balanceBefore2).add(new BN('1000')).add((new BN((block2.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul(balanceBefore1.add(new BN('1000')))
                .div(new BN('1000000000000000000')))
            console.log(
                expectedTotalDeposits.toString(),
                (await autoStrategy.totalSupply()).toString()
            )
            assert.equal(
                expectedTotalDeposits.toString(),
                (await autoStrategy.totalSupply()).toString(),
                'Total Supply not correct'
            )
        })
    })
    describe('ERC-20 transfers', () => {
        let block1
        let balanceBefore1
        before(async () => {
            await timeMachine.revertToSnapshot(snapshotId)
            id = await autoStrategy.poolID()

            const data = await autoStrategy.pools(id)

            tokenA = await IERC20.at(data.tokenA)
            tokenB = await IERC20.at(data.tokenB)

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
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account1, account3, {
                from: account1
            })
            block1 = await web3.eth.getBlock('latest')
            balanceBefore1 = await autoStrategy.balanceOf(account1)
            // await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, account3, {
            //    from: account2
            // })
            // block2 = await web3.eth.getBlock('latest')
            // balanceBeforeAcc2 = await autoStrategy.balanceOf(account2)
            // balanceBefore2 = await autoStrategy.balanceOf(account3)
        })

        it('Transfers correctly', async () => {
            await time.increase(31536000)// 1 year after
            let tx = await autoStrategy.transfer(account2, balanceBefore1, {
                from: account1
            })
            const block2 = await web3.eth.getBlock('latest')

            expectEvent(tx, 'Transfer', {
                from: account1,
                to: account2,
                value: balanceBefore1
            })

            await time.increase(31536000)// 1 year after

            tx = await autoStrategy.collectFee(account3, { from: account1 })
            const block3 = await web3.eth.getBlock('latest')
            const expectedFee = (new BN((block2.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(balanceBefore1)
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: account3,
                fee: expectedFee
            })
            const balanceAcc3 = await autoStrategy.balanceOf(account3)
            assert.equal(
                expectedFee.toString(),
                balanceAcc3.toString(),
                'Token balance not changed for acc3 after collectFee'
            )

            tx = await autoStrategy.collectFee(feeCollector, { from: account1 })
            const block4 = await web3.eth.getBlock('latest')
            const expectedFeePrev = (new BN((block2.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul(new BN('1000'))
                .div(new BN('1000000000000000000'))
            const expectedFee1 = (new BN((block3.timestamp - block2.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul((new BN('1000')).add(balanceBefore1))
                .div(new BN('1000000000000000000'))
            const expectedFee2 = (new BN((block4.timestamp - block3.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul((new BN('1000')).add(balanceBefore1).add(expectedFee))
                .div(new BN('1000000000000000000'))

            // add expected fee because we also collect fee from account3
            expectEvent(tx, 'CollectFee', {
                recipient: feeCollector,
                fee: expectedFee.add(expectedFee1).add(expectedFee2).add(expectedFeePrev)
            })
            const balanceFeeCollector = await autoStrategy.balanceOf(feeCollector)
            assert.equal(
                expectedFee.add(expectedFee1).add(expectedFee2).add(expectedFeePrev).toString(),
                balanceFeeCollector.toString(),
                'Token balance not changed for feeCollector after collectFee'
            )
        })
    })
    describe('Upgrade from previous version', () => {
        let id
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

            const autoStrategyImplementation = await AutoStrategyV0.new()
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

            autoStrategy = await AutoStrategyV0.at(await autoStrategyFactory.autoStrategies(0))
        })
        it('Upgrades version', async () => {
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
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account1, {
                from: account1
            })

            const autoStrategyImplementation = await AutoStrategy.new()
            await autoStrategyFactory.upgradeStrategies(autoStrategyImplementation.address)

            autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))

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

            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account2, constants.ZERO_ADDRESS, {
                from: account2
            })
            const block1 = await web3.eth.getBlock('latest')
            const ts = await autoStrategy.totalSupply()

            await time.increase(31536000)// 1 year after

            tx = await autoStrategy.collectFee(feeCollector, { from: account1 })
            const block3 = await web3.eth.getBlock('latest')
            expectedFee = (new BN((block3.timestamp - block1.timestamp).toString())).mul(new BN('317097919')).mul(new BN('2')).mul(ts)
                .div(new BN('1000000000000000000'))
            expectEvent(tx, 'CollectFee', {
                recipient: feeCollector,
                fee: expectedFee
            })
            const balanceFeeCollector = await autoStrategy.balanceOf(feeCollector)
            assert.equal(
                expectedFee.toString(),
                balanceFeeCollector.toString(),
                'Token balance not changed for fee collector after collectFee'
            )
        })
        it('Does not collect fee from new deposits', async () => {
            await time.increase(3153600000)// 100 years after
            await tokenA.transfer(account5, amounts[0], {
                from: account1
            })
            await tokenB.transfer(account5, amounts[0], {
                from: account1
            })
            await tokenA.approve(autoStrategy.address, amounts[0], {
                from: account5
            })
            await tokenB.approve(autoStrategy.address, amounts[0], {
                from: account5
            })
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account5, constants.ZERO_ADDRESS, {
                from: account5
            })
            const balanceAAfter = await tokenA.balanceOf(account5)
            const balanceBAfter = await tokenB.balanceOf(account5)
            const {
                stakeA, stakeB, leftoverA, leftoverB
            } = await autoStrategy.userStake(account5)
            console.log('stakeA: ', amounts[0].sub(balanceAAfter).toString(), stakeA.add(leftoverA).toString())
            console.log('stakeB: ', amounts[0].sub(balanceBAfter).toString(), stakeB.add(leftoverB).toString())

            await autoStrategy.withdraw(id, await autoStrategy.balanceOf(account5), 0, 0, account5, {
                from: account5
            })

            approxeq(
                (await tokenA.balanceOf(account5)),
                stakeA.add(leftoverA),
                new BN(1000),
                'Token A balance not changed correctly'
            )
            approxeq(
                (await tokenB.balanceOf(account5)),
                stakeB.add(leftoverB),
                new BN(1000),
                'Token B balance not changed correctly'
            )
        })
    })

    describe('Upgrade from previous version 2', () => {
        let id
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

            const autoStrategyImplementation = await AutoStrategyV0.new()
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

            autoStrategy = await AutoStrategyV0.at(await autoStrategyFactory.autoStrategies(0))
        })
        it('Upgrades version', async () => {
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
            await autoStrategy.deposit(id, amounts[0], amounts[0], 0, 0, account1, {
                from: account1
            })

            const balanceABefore = await tokenA.balanceOf(account1)
            const balanceBBefore = await tokenB.balanceOf(account1)
            const {
                stakeA, stakeB, leftoverA, leftoverB
            } = await autoStrategy.userStake(account1)

            const autoStrategyImplementation = await AutoStrategy.new()
            await autoStrategyFactory.upgradeStrategies(autoStrategyImplementation.address)

            autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))

            await autoStrategy.withdraw(id, await autoStrategy.balanceOf(account1), 0, 0, account1, {
                from: account1
            })
            assert.equal(
                (await autoStrategy.balanceOf(account1)).toString(),
                '0',
                'Token balance not 0'
            )

            approxeq(
                (await tokenA.balanceOf(account1)).sub(balanceABefore),
                stakeA.add(leftoverA),
                new BN(10),
                'Token A balance not changed correctly'
            )
            approxeq(
                (await tokenB.balanceOf(account1)).sub(balanceBBefore),
                stakeB.add(leftoverB),
                new BN(10),
                'Token B balance not changed correctly'
            )
        })
    })
})
