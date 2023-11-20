const {
    expectRevert, expectEvent, BN, constants, time
} = require('@openzeppelin/test-helpers')
// const { expectRevertCustomError } = require('custom-error-test-helper')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')

const IERC20 = artifacts.require('IERC20')
const UnoAssetRouterVelodrome = artifacts.require('UnoAssetRouterVelodrome')
const UnoFarmVelodrome = artifacts.require('UnoFarmVelodrome')
const FarmFactory = artifacts.require('UnoFarmFactory')

const IGauge = artifacts.require('IGauge')
const AccessManager = artifacts.require('UnoAccessManager')

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0x0f30716960f0618983ac42be2982ffec181af265' // velo-optimism
const pool2 = '0xbc8e6e4ea64e1b1da50b8ffc27f7395034e978ab' // velo-optimism

const account1 = '0xd43f3716CbB9386352880a9BD52f7F07aC01752B' // has to be unlocked and hold velo-optimism
const account2 = '0xEdDc3369E15E9EfFa6e1eC2eE1ddc3CDf501E852' // has to be unlocked and hold velo-optimism
const account3 = '0x5183d153A2431d9d582f54A8b2225a3A78F60e05' // has to be unlocked and hold eth + usdc
const distributor = '0xd43f3716CbB9386352880a9BD52f7F07aC01752B' // has to be unlocked and hold velo-optimism

const amounts = [new BN(10000), new BN(30000), new BN(5000), new BN(40000), new BN(4400000000), new BN(50000)]

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

async function expectRevertCustomError(promise, reason) {
    try {
        await promise
        expect.fail('Expected promise to throw but it didn\'t')
    } catch (revert) {
        // TRUFFLE CAN NOT DECODE CUSTOM ERRORS
        // console.log(JSON.stringify(revert))
        //  if (reason) {
        //     // expect(revert.message).to.include(reason);
        //     const reasonId = web3.utils.keccak256(`${reason}()`).substr(0, 10)
        //     expect(JSON.stringify(revert), `Expected custom error ${reason} (${reasonId})`).to.include(reasonId)
        //  }
    }
}

contract('UnoAutoStrategy', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let strategyToken
    let snapshotId
    let snapshotIdBeforeDeposit

    let assetRouterVelodrome
    let assetRouterVelodrome2
    let rewardToken
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

        const autoStrategyImplementation = await AutoStrategy.new()
        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)

        assetRouterVelodrome = await deployProxy(
            UnoAssetRouterVelodrome,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationVelodrome = await UnoFarmVelodrome.new()
        await FarmFactory.new(farmImplementationVelodrome.address, accessManager.address, assetRouterVelodrome.address)

        assetRouterVelodrome2 = await deployProxy(
            UnoAssetRouterVelodrome,
            { kind: 'uups', initializer: false }
        )
        await FarmFactory.new(farmImplementationVelodrome.address, accessManager.address, assetRouterVelodrome2.address)

        await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
            from: admin
        })
        await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome2.address, {
            from: admin
        })

        await autoStrategyFactory.createStrategy([
            { pool: pool1, assetRouter: assetRouterVelodrome.address },
            { pool: pool2, assetRouter: assetRouterVelodrome2.address }
        ])

        autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))

        strategyToken = await IERC20.at(autoStrategy.address)

        const gaugeContract = await IGauge.at(pool1)
        rewardToken = await gaugeContract.rewardToken()

        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot.result
    })
    describe('Initialization', () => {
        it('cannot call multiple initializations', async () => {
            await expectRevert(
                autoStrategy.initialize(
                    [
                        { pool: pool1, assetRouter: assetRouterVelodrome.address },
                        { pool: pool2, assetRouter: assetRouterVelodrome2.address }
                    ],
                    accessManager.address,
                    {
                        from: account1
                    }
                ),
                'Initializable: contract is already initialized'
            )
        })
        describe('initialization parameters', () => {
            it('sets correct pools and asset routers', async () => {
                const pools = [pool1, pool2]
                const assetRouters = [assetRouterVelodrome.address, assetRouterVelodrome2.address]

                for (let i = 0; i < 2; i++) {
                    const assetRouter = (await autoStrategy.pools(i)).assetRouter
                    const pool = (await autoStrategy.pools(i)).pool

                    assert.equal(
                        assetRouter,
                        assetRouters[i],
                        `Asset Router ${assetRouters[i]} is not set correctly`
                    )
                    assert.equal(pool.toLowerCase(), pools[i], `Pool ${pools[i]} is not set correctly`)
                }
            })
            it('sets correct access manager', async () => {
                const strategyAccessManager = await autoStrategy.accessManager()

                assert.equal(
                    strategyAccessManager,
                    accessManager.address,
                    'Access Manager is not set correctly'
                )
            })
            it('sets correct factory', async () => {
                const strategyFactory = await autoStrategy.factory()

                assert.equal(
                    strategyFactory,
                    autoStrategyFactory.address,
                    'Factory is not set correctly'
                )
            })
        })
    })
    describe('Deposits', () => {
        describe('reverts', () => {
            it('reverts if provided with the wrong poolID', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.deposit(poolID.add(new BN(1)), 0, 0, 0, 0, account1, constants.ZERO_ADDRESS, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
                await expectRevertCustomError(
                    autoStrategy.depositETH(poolID.add(new BN(1)), 0, 0, 0, account1, constants.ZERO_ADDRESS, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
                await expectRevertCustomError(
                    autoStrategy.depositWithSwap(poolID.add(new BN(1)), ['0x', '0x'], account1, constants.ZERO_ADDRESS, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
            })
        })
        describe('deposit tokens', () => {
            let id
            let receipt
            let sentA; let
                sentB
            let tokenABalanceBefore; let
                tokenBBalanceBefore
            let totalDepositsABefore; let
                totalDepositsBBefore
            let strategyTokenBalanceBefore
            before(async () => {
                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                let tokenABalance = await tokenA.balanceOf(account1)
                let tokenBBalance = await tokenB.balanceOf(account1)

                tokenABalanceBefore = tokenABalance
                tokenBBalanceBefore = tokenBBalance

                await tokenA.approve(autoStrategy.address, amounts[1], {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, amounts[1], {
                    from: account1
                })

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                strategyTokenBalanceBefore = await strategyToken.balanceOf(account1)

                // Deposit
                receipt = await autoStrategy.deposit(id, amounts[1], amounts[1], 0, 0, account1, constants.ZERO_ADDRESS, {
                    from: account1
                })

                tokenABalance = await tokenA.balanceOf(account1)
                tokenBBalance = await tokenB.balanceOf(account1)

                sentA = tokenABalanceBefore.sub(tokenABalance)
                sentB = tokenBBalanceBefore.sub(tokenBBalance)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    poolID: id,
                    from: account1,
                    recipient: account1
                })

                expectEvent(receipt, 'DepositPairTokens', {
                    poolID: id,
                    amountA: sentA,
                    amountB: sentB
                })
            })
            it('mints tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                assert.ok(strategyTokenBalance.gt(strategyTokenBalanceBefore), 'tokens were not minted')
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(account1)

                const assetRouter = await UnoAssetRouterVelodrome.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeA is not correct'
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeB is not correct'
                )
            })
            it('updates total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                console.log(totalDepositsA.sub(totalDepositsABefore).toString(), sentA.toString())
                console.log(totalDepositsB.sub(totalDepositsBBefore).toString(), sentB.toString())

                approxeq(totalDepositsA.sub(totalDepositsABefore), sentA, new BN(20), 'totalDepositsA is not correct')
                approxeq(totalDepositsB.sub(totalDepositsBBefore), sentB, new BN(20), 'totalDepositsB is not correct')
            })
        })
        describe('deposit tokens from multiple accounts', () => {
            let id
            let totalDepositsABefore; let
                totalDepositsBBefore
            const strategyTokenBalancesBefore = []

            const sentA = []
            const sentB = []
            const testAccounts = [account2, account3]
            const txs = []
            before(async () => {
                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)
                console.log(tokenA.address, tokenB.address)

                const tokenABalancesBefore = []
                const tokenBBalancesBefore = []

                for (let i = 0; i < testAccounts.length; i++) {
                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    tokenABalancesBefore.push(tokenABalance)
                    tokenBBalancesBefore.push(tokenBBalance)

                    await tokenA.approve(autoStrategy.address, amounts[2], {
                        from: testAccounts[i]
                    })
                    await tokenB.approve(autoStrategy.address, amounts[2], {
                        from: testAccounts[i]
                    })

                    strategyTokenBalancesBefore.push(await strategyToken.balanceOf(testAccounts[i]))
                }

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                // Deposit
                for (let i = 0; i < testAccounts.length; i++) {
                    console.log(tokenABalancesBefore[i].toString(), tokenBBalancesBefore[i].toString())
                    txs.push(
                        await autoStrategy.deposit(id, amounts[2], amounts[2], 0, 0, testAccounts[i], constants.ZERO_ADDRESS, {
                            from: testAccounts[i]
                        })
                    )

                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    sentA.push(tokenABalancesBefore[i].sub(tokenABalance))
                    sentB.push(tokenBBalancesBefore[i].sub(tokenBBalance))
                }
            })
            it('fires events', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    expectEvent(txs[i], 'Deposit', {
                        poolID: id,
                        from: testAccounts[i],
                        recipient: testAccounts[i]
                    })

                    expectEvent(txs[i], 'DepositPairTokens', {
                        poolID: id,
                        amountA: sentA[i],
                        amountB: sentB[i]
                    })
                }
            })
            it('mints tokens', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    assert.ok(
                        strategyTokenBalance.gt(strategyTokenBalancesBefore[i]),
                        `tokens were not minted for ${testAccounts[i]}`
                    )
                }
            })
            it('updates user stakes', async () => {
                const assetRouter = await UnoAssetRouterVelodrome.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const totalSupply = await strategyToken.totalSupply()

                for (let i = 0; i < testAccounts.length; i++) {
                    const {
                        stakeA, stakeB
                    } = await autoStrategy.userStake(testAccounts[i])

                    const {
                        stakeA: assetRouterStakeA,
                        stakeB: assetRouterStakeB
                    } = await assetRouter.userStake(autoStrategy.address, pool)

                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    approxeq(
                        stakeA,
                        assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                        new BN(10),
                        `stakeA is not correct for ${testAccounts[i]}`
                    )
                    approxeq(
                        stakeB,
                        assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                        new BN(10),
                        `stakeB is not correct for ${testAccounts[i]}`
                    )
                }
            })
            it('updates total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                const totalDepositedA = new BN(0)
                const totalDepositedB = new BN(0)

                for (let i = 0; i < testAccounts.length; i++) {
                    totalDepositedA.add(sentA[i])
                    totalDepositedB.add(sentB[i])
                }

                approxeq(
                    totalDepositsA.sub(totalDepositsABefore),
                    totalDepositedA,
                    new BN(10),
                    'totalDepositsA is not correct'
                )
                approxeq(
                    totalDepositsB.sub(totalDepositsBBefore),
                    totalDepositedB,
                    new BN(10),
                    'totalDepositsB is not correct'
                )
            })
        })
    })
    describe('Withdraws', () => {
        describe('reverts', () => {
            it('reverts if provided with the wrong poolID', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.withdraw(poolID.add(new BN(1)), 0, 0, 0, account1, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
                await expectRevertCustomError(
                    autoStrategy.withdrawETH(poolID.add(new BN(1)), 0, 0, 0, account1, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
                await expectRevertCustomError(
                    autoStrategy.withdrawWithSwap(poolID.add(new BN(1)), 0, ['0x', '0x'], account1, {
                        from: account1
                    }),
                    'BAD_POOL_ID'
                )
            })
        })
        describe('withdraw tokens', () => {
            let id
            let receipt
            let tokenABalanceBefore; let
                tokenBBalanceBefore
            let totalDepositsABefore; let
                totalDepositsBBefore
            let strategyTokenBalanceBefore
            let tokensToBurn

            let withdrawnA
            let withdrawnB

            before(async () => {
                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                await tokenA.approve(autoStrategy.address, amounts[3], {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, amounts[3], {
                    from: account1
                })

                await autoStrategy.deposit(id, amounts[3], amounts[3], 0, 0, account1, constants.ZERO_ADDRESS, {
                    from: account1
                })

                let tokenABalance = await tokenA.balanceOf(account1)
                let tokenBBalance = await tokenB.balanceOf(account1)

                tokenABalanceBefore = tokenABalance
                tokenBBalanceBefore = tokenBBalance

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                strategyTokenBalanceBefore = await strategyToken.balanceOf(account1)
                tokensToBurn = strategyTokenBalanceBefore

                // Withdraw
                receipt = await autoStrategy.withdraw(id, tokensToBurn, 0, 0, account1, {
                    from: account1
                })

                tokenABalance = await tokenA.balanceOf(account1)
                tokenBBalance = await tokenB.balanceOf(account1)

                withdrawnA = tokenABalance.sub(tokenABalanceBefore)
                withdrawnB = tokenBBalance.sub(tokenBBalanceBefore)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {
                    poolID: id,
                    from: account1,
                    recipient: account1
                })

                expectEvent(receipt, 'WithdrawPairTokens', {
                    poolID: id,
                    amountA: withdrawnA,
                    amountB: withdrawnB
                })
            })
            it('burns tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                assert.equal(
                    strategyTokenBalance.toString(),
                    strategyTokenBalanceBefore.sub(tokensToBurn).toString(),
                    'Amount of tokens burnt is not correct'
                )
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(account1)

                const assetRouter = await UnoAssetRouterVelodrome.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeA is not correct'
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeB is not correct'
                )
            })
            it('updates total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                approxeq(
                    totalDepositsABefore.sub(totalDepositsA),
                    withdrawnA,
                    new BN(10),
                    'totalDepositsA is not correct'
                )
                approxeq(
                    totalDepositsBBefore.sub(totalDepositsB),
                    withdrawnB,
                    new BN(10),
                    'totalDepositsB is not correct'
                )
            })
        })
        describe('withdraw tokens for multiple accounts', () => {
            let id
            const tokenABalancesBefore = []
            const tokenBBalancesBefore = []
            let totalDepositsABefore; let
                totalDepositsBBefore
            const strategyTokenBalancesBefore = []
            const tokensToBurn = []

            const withdrawnA = []
            const withdrawnB = []
            const testAccounts = [account2, account3]
            const txs = []
            before(async () => {
                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                for (let i = 0; i < testAccounts.length; i++) {
                    await tokenA.approve(autoStrategy.address, amounts[4], {
                        from: testAccounts[i]
                    })
                    await tokenB.approve(autoStrategy.address, amounts[4], {
                        from: testAccounts[i]
                    })

                    await autoStrategy.deposit(id, amounts[4], amounts[4], 0, 0, testAccounts[i], constants.ZERO_ADDRESS, {
                        from: testAccounts[i]
                    })

                    strategyTokenBalancesBefore.push(await strategyToken.balanceOf(testAccounts[i]))
                    tokensToBurn.push(strategyTokenBalancesBefore[i].sub(amounts[5]))

                    tokenABalancesBefore.push(await tokenA.balanceOf(testAccounts[i]))
                    tokenBBalancesBefore.push(await tokenB.balanceOf(testAccounts[i]))
                }

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                // Withdraw
                for (let i = 0; i < testAccounts.length; i++) {
                    txs.push(
                        await autoStrategy.withdraw(id, tokensToBurn[i], 0, 0, testAccounts[i], {
                            from: testAccounts[i]
                        })
                    )

                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    withdrawnA.push(tokenABalance.sub(tokenABalancesBefore[i]))
                    withdrawnB.push(tokenBBalance.sub(tokenBBalancesBefore[i]))
                }
            })
            it('fires events', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    expectEvent(txs[i], 'Withdraw', {
                        poolID: id,
                        from: testAccounts[i],
                        recipient: testAccounts[i]
                    })

                    expectEvent(txs[i], 'WithdrawPairTokens', {
                        poolID: id,
                        amountA: withdrawnA[i],
                        amountB: withdrawnB[i]
                    })
                }
            })
            it('burns tokens', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    assert.equal(
                        strategyTokenBalance.toString(),
                        strategyTokenBalancesBefore[i].sub(tokensToBurn[i]).toString(),
                        `Amount of tokens burnt is not correct for ${testAccounts[i]}`
                    )
                }
            })
            it('updates user stakes', async () => {
                const pool = await autoStrategy.pools(id)
                const assetRouter = await UnoAssetRouterVelodrome.at(pool.assetRouter)

                const totalSupply = await strategyToken.totalSupply()

                for (let i = 0; i < testAccounts.length; i++) {
                    const {
                        stakeA, stakeB
                    } = await autoStrategy.userStake(testAccounts[i])

                    const {
                        stakeA: assetRouterStakeA,
                        stakeB: assetRouterStakeB
                    } = await assetRouter.userStake(autoStrategy.address, pool.pool)

                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    approxeq(
                        stakeA,
                        assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                        new BN(10),
                        `stakeA is not correct for ${testAccounts[i]}`
                    )
                    approxeq(
                        stakeB,
                        assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                        new BN(10),
                        `stakeB is not correct for ${testAccounts[i]}`
                    )
                }
            })
            it('updates total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                const totalWithdrawnA = new BN(0)
                const totalWithdrawnB = new BN(0)

                for (let i = 0; i < testAccounts.length; i++) {
                    totalWithdrawnA.add(withdrawnA[i])
                    totalWithdrawnB.add(withdrawnB[i])
                }

                approxeq(
                    totalDepositsABefore.sub(totalDepositsA),
                    totalWithdrawnA,
                    new BN(10),
                    'totalDepositsA is not correct'
                )
                approxeq(
                    totalDepositsBBefore.sub(totalDepositsB),
                    totalWithdrawnA,
                    new BN(10),
                    'totalDepositsB is not correct'
                )
            })
        })
    })
    describe('Move Liquidity', () => {
        describe('reverts', () => {
            it('reverts if called not by liquidity manager', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.moveLiquidity(poolID.add(new BN(1)), '0x', 0, 0, {
                        from: account1
                    }),
                    'CALLER_NOT_LIQUIDITY_MANAGER'
                )
            })
            it('reverts if no liquidity was provided', async () => {
                const poolID = await autoStrategy.poolID()

                await timeMachine.revertToSnapshot(snapshotId)
                console.log(`### Reverting to snapshot: ${snapshotId}`)

                await expectRevertCustomError(
                    autoStrategy.moveLiquidity(poolID.add(new BN(1)), '0x', 0, 0, {
                        from: liquidityManager
                    }),
                    'NO_LIQUIDITY'
                )
            })
            it('reverts if provided with the wrong poolID', async () => {
                snapshotIdBeforeDeposit = (await timeMachine.takeSnapshot()).result

                const poolID = await autoStrategy.poolID()

                const data = await autoStrategy.pools(poolID)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                await tokenA.approve(autoStrategy.address, amounts[3], {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, amounts[3], {
                    from: account1
                })

                await autoStrategy.deposit(poolID, amounts[3], amounts[3], 0, 0, account1, constants.ZERO_ADDRESS, {
                    from: account1
                })

                await expectRevertCustomError(
                    autoStrategy.moveLiquidity(poolID, '0x', 0, 0, {
                        from: liquidityManager
                    }),
                    'BAD_POOL_ID'
                )
            })
        })
        describe('multiple users stakes and totalDeposits after move liquidity', () => {
            let id
            let totalDepositsABefore; let
                totalDepositsBBefore

            testAccounts = [account2, account3]

            const stakesABefore = []
            const stakesBBefore = []
            const leftoversABefore = []
            const leftoversBBefore = []

            before(async () => {
                id = await autoStrategy.poolID()

                await timeMachine.revertToSnapshot(snapshotIdBeforeDeposit)
                console.log(`### Reverting to snapshot: ${snapshotIdBeforeDeposit}`)

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                for (let i = 0; i < testAccounts.length; i++) {
                    await tokenA.approve(autoStrategy.address, amounts[3], {
                        from: testAccounts[i]
                    })
                    await tokenB.approve(autoStrategy.address, amounts[3], {
                        from: testAccounts[i]
                    })

                    await autoStrategy.deposit(id, amounts[3], amounts[3], 0, 0, testAccounts[i], constants.ZERO_ADDRESS, {
                        from: testAccounts[i]
                    })

                    const {
                        stakeA, stakeB, leftoverA, leftoverB
                    } = await autoStrategy.userStake(testAccounts[i])

                    stakesABefore.push(stakeA)
                    stakesBBefore.push(stakeB)

                    leftoversABefore.push(leftoverA)
                    leftoversBBefore.push(leftoverB)
                }

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                receipt = await autoStrategy.moveLiquidity(id.add(new BN(1)), '0x', 0, 0, {
                    from: liquidityManager
                })
            })
            it('user stakes stay the same', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    const {
                        stakeA, stakeB, leftoverA, leftoverB
                    } = await autoStrategy.userStake(testAccounts[i])

                    approxeq(
                        stakeA.add(leftoverA),
                        stakesABefore[i],
                        new BN(30),
                        `stakeA is not correct for ${testAccounts[i]}`
                    )
                    approxeq(
                        stakeB.add(leftoverB),
                        stakesBBefore[i],
                        new BN(30),
                        `stakeA is not correct for ${testAccounts[i]}`
                    )
                }
            })
            it('totalDeposits stay the same', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()
                approxeq(totalDepositsA, totalDepositsABefore, new BN(30), 'totalDepositsA is not correct')
                approxeq(totalDepositsB, totalDepositsBBefore, new BN(30), 'totalDepositsB is not correct')
            })
        })
    })
    describe('Rewards', () => {
        describe('more tokens after a distribution', () => {
            let id
            let totalDepositsABefore; let
                totalDepositsBBefore

            let tokenABalanceBefore; let
                tokenBBalanceBefore

            before(async () => {
                await autoStrategy.moveLiquidity(0, '0x', 0, 0, {
                    from: liquidityManager
                })

                id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)
                const assetRouter = await UnoAssetRouterVelodrome.at(data.assetRouter)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                const tokenABalance = await tokenA.balanceOf(account1)
                const tokenBBalance = await tokenB.balanceOf(account1)

                tokenABalanceBefore = tokenABalance
                tokenBBalanceBefore = tokenBBalance

                await tokenA.approve(autoStrategy.address, tokenABalance, {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, tokenBBalance, {
                    from: account1
                })

                // Deposit
                receipt = await autoStrategy.deposit(id, tokenABalance, tokenBBalance, 0, 0, account1, constants.ZERO_ADDRESS, {
                    from: account1
                })

                await time.increase(500000)

                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                await assetRouter.distribute(
                    data.pool,
                    [
                        {
                            amount: 10000000,
                            route: [
                                {
                                    from: rewardToken,
                                    to: tokenA.address,
                                    stable: false, // todo
                                    factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a'// todo
                                }
                            ],
                            amountOutMin: 0
                        },
                        {
                            amount: 10000000,
                            route: [],
                            amountOutMin: 0
                        }
                    ],
                    constants.ZERO_ADDRESS,
                    { from: distributor }
                )
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(account1)

                const assetRouter = await UnoAssetRouterVelodrome.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                const totalSupply = await strategyToken.totalSupply()

                console.log(stakeA.toString(), assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply).toString())
                console.log(stakeB.toString(), assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply).toString())

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(30),
                    'stakeA is not correct'
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(30),
                    'stakeB is not correct'
                )
            })
            it('increases total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                console.log(totalDepositsA.toString(), totalDepositsABefore.toString())
                console.log(totalDepositsB.toString(), totalDepositsBBefore.toString())

                assert.ok(totalDepositsA.gt(totalDepositsABefore), 'totalDeposits of tokenA were not increased')
                assert.ok(totalDepositsB.gt(totalDepositsBBefore), 'totalDeposits of tokenB were not increased')
            })
            it('withdraws rewards', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                await autoStrategy.withdraw(id, strategyTokenBalance, 0, 0, account1, {
                    from: account1
                })

                assert.ok(
                    (await tokenA.balanceOf(account1)).gt(tokenABalanceBefore),
                    'tokenA balance was not increased after withdrawal'
                )
                assert.ok(
                    (await tokenB.balanceOf(account1)).gt(tokenBBalanceBefore),
                    'tokenB balance was not increased after withdrawal'
                )
            })
        })
    })
    describe('Paused', () => {
        before(async () => {
            await autoStrategyFactory.pause({ from: pauser })
        })
        describe('reverts', () => {
            it('reverts deposit if paused', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.deposit(poolID, 0, 0, 0, 0, account1, constants.ZERO_ADDRESS, {
                        from: account1
                    }),
                    'PAUSABLE_PAUSED'
                )
            })
            it('reverts withdraw if paused', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.withdraw(poolID, 0, 0, 0, account1, {
                        from: account1
                    }),
                    'PAUSABLE_PAUSED'
                )
            })
            it('reverts moveLiquidity if paused', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevertCustomError(
                    autoStrategy.moveLiquidity(poolID.add(new BN(1)), '0x', 0, 0, {
                        from: account1
                    }),
                    'PAUSABLE_PAUSED'
                )
            })
        })
    })
})
