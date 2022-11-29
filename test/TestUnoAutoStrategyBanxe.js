const {
    expectRevert, expectEvent, BN, constants, time
} = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const IERC20 = artifacts.require('IERC20')
const UnoAssetRouterQuickswap = artifacts.require('UnoAssetRouterQuickswap')
const UnoFarmQuickswap = artifacts.require('UnoFarmQuickswap')
const UnoAssetRouterSushiswap = artifacts.require('UnoAssetRouterSushiswap')
const UnoFarmSushiswap = artifacts.require('UnoFarmSushiswap')
const FarmFactory = artifacts.require('UnoFarmFactory')

const AccessManager = artifacts.require('UnoAccessManager')
const AutoStrategy = artifacts.require('UnoAutoStrategyBanxe')
const AutoStrategyV2 = artifacts.require('UnoAutoStrategyBanxeV2')

const pool1 = '0xafb76771c98351aa7fca13b130c9972181612b54' // usdt-usdc quickswap
const pool2 = '0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001' // usdt-usdc sushiswap

const account1 = '0x72A53cDBBcc1b9efa39c834A540550e23463AAcB' // -u
const distributor = '0x2aae5d0f3bee441acc1fb2abe9c2672a54f4bb48' // -u
const banxe = '0x477b8D5eF7C2C42DB84deB555419cd817c336b6F' // -u

const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(4400000000), new BN(5000)]

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAutoStrategyBanxe', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]

    let accessManager

    let autoStrategy

    let strategyToken

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

        autoStrategy = await deployProxy(
            AutoStrategy,
            [
                [
                    { pool: pool1, assetRouter: assetRouterQuickswap.address },
                    { pool: pool2, assetRouter: assetRouterSushiswap.address }
                ],
                accessManager.address,
                banxe
            ],
            { kind: 'uups' }
        )

        strategyToken = await IERC20.at(autoStrategy.address)
    })
    describe('Initialization', () => {
        it('cannot call multiple initializations', async () => {
            await expectRevert(
                autoStrategy.initialize(
                    [
                        { pool: pool1, assetRouter: assetRouterQuickswap.address },
                        { pool: pool2, assetRouter: assetRouterSushiswap.address }
                    ],
                    accessManager.address,
                    banxe,
                    {
                        from: banxe
                    }
                ),
                'Initializable: contract is already initialized'
            )
        })
        describe('initialization parameters', () => {
            it('sets correct pools and asset routers', async () => {
                const pools = [pool1, pool2]
                const assetRouters = [assetRouterQuickswap.address, assetRouterSushiswap.address]

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
            it('sets correct banxe', async () => {
                const _banxe = await autoStrategy.banxe()

                assert.equal(
                    _banxe,
                    banxe,
                    'Banxe is not set correctly'
                )
            })
            it('sets correct tokens', async () => {
                const _tokenA = await autoStrategy.tokenA()
                assert.equal(
                    _tokenA.toLowerCase(),
                    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase(),
                    'tokenA is not set correctly'
                )

                const _tokenB = await autoStrategy.tokenB()
                assert.equal(
                    _tokenB.toLowerCase(),
                    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'.toLowerCase(),
                    'tokenB is not set correctly'
                )
            })
        })
    })
    describe('Deposits', () => {
        describe('reverts', () => {
            it('reverts moveLiquidity if no liquidity was provided', async () => {
                await expectRevert(
                    autoStrategy.moveLiquidity(1, 0, 0, {
                        from: liquidityManager
                    }),
                    'NO_LIQUIDITY'
                )
            })
            it('reverts if called by an account other than banxe', async () => {
                await expectRevert(
                    autoStrategy.deposit(0, 0, 0, 0, banxe, {
                        from: account1
                    }),
                    'CALLER_NOT_BANXE'
                )
            })
        })
        describe('deposit tokens', () => {
            let id
            let receipt
            let sentA; let
                sentB
            let totalDepositsABefore; let
                totalDepositsBBefore
            let strategyTokenBalanceBefore
            before(async () => {
                id = await autoStrategy.poolID()

                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()

                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                const tokenABalanceBefore = await tokenA.balanceOf(banxe)
                const tokenBBalanceBefore = await tokenB.balanceOf(banxe)

                await tokenA.approve(autoStrategy.address, amounts[1], {
                    from: banxe
                })
                await tokenB.approve(autoStrategy.address, amounts[1], {
                    from: banxe
                });
                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())
                strategyTokenBalanceBefore = await strategyToken.balanceOf(banxe)

                // Deposit
                receipt = await autoStrategy.deposit(amounts[1], amounts[1], 0, 0, banxe, {
                    from: banxe
                })

                sentA = tokenABalanceBefore.sub(await tokenA.balanceOf(banxe))
                sentB = tokenBBalanceBefore.sub(await tokenB.balanceOf(banxe))
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    poolID: id,
                    from: banxe,
                    recipient: banxe,
                    amountA: sentA,
                    amountB: sentB
                })
            })
            it('mints tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(banxe)
                assert.ok(strategyTokenBalance.gt(strategyTokenBalanceBefore), 'tokens were not minted')
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(banxe)

                const assetRouter = await UnoAssetRouterQuickswap.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(banxe)
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

                approxeq(totalDepositsA.sub(totalDepositsABefore), sentA, new BN(10), 'totalDepositsA is not correct')
                approxeq(totalDepositsB.sub(totalDepositsBBefore), sentB, new BN(10), 'totalDepositsB is not correct')
            })
        })
        describe('deposit tokens for different account', () => {
            let id
            let receipt
            let sentA; let
                sentB
            let totalDepositsABefore; let
                totalDepositsBBefore
            let strategyTokenBalanceBefore
            before(async () => {
                id = await autoStrategy.poolID()

                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                const tokenABalancesBefore = await tokenA.balanceOf(banxe)
                const tokenBBalancesBefore = await tokenB.balanceOf(banxe)

                await tokenA.approve(autoStrategy.address, amounts[2], {
                    from: banxe
                })
                await tokenB.approve(autoStrategy.address, amounts[2], {
                    from: banxe
                });

                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())
                strategyTokenBalanceBefore = await strategyToken.balanceOf(account1)

                // Deposit
                receipt = await autoStrategy.deposit(amounts[2], amounts[2], 0, 0, account1, {
                    from: banxe
                })

                sentA = tokenABalancesBefore.sub(await tokenA.balanceOf(banxe))
                sentB = tokenBBalancesBefore.sub(await tokenB.balanceOf(banxe))
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    poolID: id,
                    from: banxe,
                    recipient: account1,
                    amountA: sentA,
                    amountB: sentB
                })
            })
            it('mints tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                assert.ok(
                    strategyTokenBalance.gt(strategyTokenBalanceBefore),
                    `tokens were not minted for ${account1}`
                )
            })
            it('updates user stakes', async () => {
                const assetRouter = await UnoAssetRouterQuickswap.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const totalSupply = await strategyToken.totalSupply()

                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(account1)

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    `stakeA is not correct for ${account1}`
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    `stakeB is not correct for ${account1}`
                )
            })
            it('updates total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                approxeq(
                    totalDepositsA.sub(totalDepositsABefore),
                    sentA,
                    new BN(10),
                    'totalDepositsA is not correct'
                )
                approxeq(
                    totalDepositsB.sub(totalDepositsBBefore),
                    sentB,
                    new BN(10),
                    'totalDepositsB is not correct'
                )
            })
        })
    })
    describe('Withdraws', () => {
        describe('reverts', () => {
            it('reverts if called with insufficient liquidity', async () => {
                await expectRevert(
                    autoStrategy.withdraw(0, 0, 0, account1, {
                        from: account1
                    }),
                    'INSUFFICIENT_LIQUIDITY_BURNED'
                )
            })
            it('reverts if account has no liquidity', async () => {
                await expectRevert(
                    autoStrategy.withdraw(1000000, 0, 0, account1, {
                        from: account1
                    }),
                    'ERC20: burn amount exceeds balance'
                )
            })
        })
        describe('withdraw tokens', () => {
            let receipt
            let totalDepositsABefore; let
                totalDepositsBBefore

            let withdrawnA
            let withdrawnB

            before(async () => {
                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                const tokenABalanceBefore = await tokenA.balanceOf(banxe)
                const tokenBBalanceBefore = await tokenB.balanceOf(banxe);
                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())

                const strategyTokenBalance = await strategyToken.balanceOf(banxe)
                receipt = await autoStrategy.withdraw(strategyTokenBalance, 0, 0, banxe, {
                    from: banxe
                })

                withdrawnA = (await tokenA.balanceOf(banxe)).sub(tokenABalanceBefore)
                withdrawnB = (await tokenB.balanceOf(banxe)).sub(tokenBBalanceBefore)
            })
            it('fires events', async () => {
                const id = await autoStrategy.poolID()
                expectEvent(receipt, 'Withdraw', {
                    poolID: id,
                    from: banxe,
                    recipient: banxe,
                    amountA: withdrawnA,
                    amountB: withdrawnB
                })
            })
            it('burns tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(banxe)
                assert.equal(
                    strategyTokenBalance.toString(),
                    '0',
                    'Amount of tokens burnt is not correct'
                )
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(banxe)

                assert.equal(
                    stakeA.toString(),
                    '0',
                    'stakeA is not correct'
                )
                assert.equal(
                    stakeB.toString(),
                    '0',
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
            let receipt
            let totalDepositsABefore; let
                totalDepositsBBefore

            let withdrawnA
            let withdrawnB
            before(async () => {
                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                const tokenABalanceBefore = await tokenA.balanceOf(banxe)
                const tokenBBalanceBefore = await tokenB.balanceOf(banxe);
                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                receipt = await autoStrategy.withdraw(strategyTokenBalance, 0, 0, banxe, {
                    from: account1
                })

                withdrawnA = (await tokenA.balanceOf(banxe)).sub(tokenABalanceBefore)
                withdrawnB = (await tokenB.balanceOf(banxe)).sub(tokenBBalanceBefore)
            })
            it('fires events', async () => {
                const id = await autoStrategy.poolID()
                expectEvent(receipt, 'Withdraw', {
                    poolID: id,
                    from: account1,
                    recipient: banxe,
                    amountA: withdrawnA,
                    amountB: withdrawnB
                })
            })
            it('burns tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                assert.equal(
                    strategyTokenBalance.toString(),
                    '0',
                    'Amount of tokens burnt is not correct'
                )
            })
            it('updates user stakes', async () => {
                const {
                    stakeA, stakeB
                } = await autoStrategy.userStake(account1)

                assert.equal(
                    stakeA.toString(),
                    '0',
                    'stakeA is not correct'
                )
                assert.equal(
                    stakeB.toString(),
                    '0',
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
    })
    describe('Move Liquidity', () => {
        describe('reverts', () => {
            it('reverts if called not by liquidity manager', async () => {
                await expectRevert(
                    autoStrategy.moveLiquidity(1, 0, 0, {
                        from: account1
                    }),
                    'CALLER_NOT_LIQUIDITY_MANAGER'
                )
            })
            it('reverts if provided with the wrong poolID', async () => {
                const poolID = await autoStrategy.poolID()

                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                await tokenA.approve(autoStrategy.address, amounts[3], {
                    from: banxe
                })
                await tokenB.approve(autoStrategy.address, amounts[3], {
                    from: banxe
                })

                await autoStrategy.deposit(amounts[3], amounts[3], 0, 0, banxe, {
                    from: banxe
                })

                await expectRevert(
                    autoStrategy.moveLiquidity(poolID, 0, 0, {
                        from: liquidityManager
                    }),
                    'BAD_POOL_ID'
                )
            })
        })
        describe('multiple users stakes and totalDeposits after move liquidity', () => {
            let totalDepositsABefore; let
                totalDepositsBBefore

            let stakesABefore1
            let stakesBBefore1
            let stakesABefore2
            let stakesBBefore2

            before(async () => {
                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                const tokenABalance = await tokenA.balanceOf(banxe)
                const tokenBBalance = await tokenB.balanceOf(banxe)

                await tokenA.approve(autoStrategy.address, tokenABalance, {
                    from: banxe
                })
                await tokenB.approve(autoStrategy.address, tokenBBalance, {
                    from: banxe
                })

                await autoStrategy.deposit(tokenABalance, tokenBBalance, 0, 0, account1, {
                    from: banxe
                });

                ({ stakeA: stakesABefore1, stakeB: stakesBBefore1 } = await autoStrategy.userStake(banxe));
                ({ stakeA: stakesABefore2, stakeB: stakesBBefore2 } = await autoStrategy.userStake(account1));
                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())

                receipt = await autoStrategy.moveLiquidity(1, 0, 0, {
                    from: liquidityManager
                })
            })
            it('fires event', async () => {
                expectEvent(receipt, 'MoveLiquidity', {
                    previousPoolID: new BN(0),
                    nextPoolID: new BN(1)
                })
            })
            it('user stakes stay the same', async () => {
                it('user stakes for banxe', async () => {
                    const { stakeA, stakeB } = await autoStrategy.userStake(banxe)
                    approxeq(
                        stakeA,
                        stakesABefore1,
                        new BN(10),
                        `stakeA is not correct for ${banxe}`
                    )
                    approxeq(
                        stakeB,
                        stakesBBefore1,
                        new BN(10),
                        `stakeA is not correct for ${banxe}`
                    )
                })
                it('user stakes for account1', async () => {
                    const { stakeA, stakeB } = await autoStrategy.userStake(account1)
                    approxeq(
                        stakeA,
                        stakesABefore2,
                        new BN(10),
                        `stakeA is not correct for ${account1}`
                    )
                    approxeq(
                        stakeB,
                        stakesBBefore2,
                        new BN(10),
                        `stakeA is not correct for ${account1}`
                    )
                })
            })
            it('totalDeposits stay the same', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()
                approxeq(totalDepositsA, totalDepositsABefore, new BN(10), 'totalDepositsA is not correct')
                approxeq(totalDepositsB, totalDepositsBBefore, new BN(10), 'totalDepositsB is not correct')
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
                await autoStrategy.moveLiquidity(0, 0, 0, {
                    from: liquidityManager
                })

                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                tokenABalanceBefore = await tokenA.balanceOf(account1)
                tokenBBalanceBefore = await tokenB.balanceOf(account1)

                await time.increase(500000);
                ({ totalDepositsA: totalDepositsABefore, totalDepositsB: totalDepositsBBefore } = await autoStrategy.totalDeposits())

                id = await autoStrategy.poolID()
                const data = await autoStrategy.pools(id)
                const assetRouter = await UnoAssetRouterQuickswap.at(data.assetRouter)

                await assetRouter.distribute(
                    data.pool,
                    [
                        {
                            route: [
                                '0xf28164A485B0B2C90639E47b0f377b4a438a16B1',
                                '0x831753DD7087CaC61aB5644b308642cc1c33Dc13', // rewardsToken is dQUICK so we have to swap it to QUICK first and then to tokenA
                                tokenAAddress
                            ],
                            amountOutMin: 1
                        },

                        {
                            route: [
                                '0xf28164A485B0B2C90639E47b0f377b4a438a16B1',
                                '0x831753DD7087CaC61aB5644b308642cc1c33Dc13', // rewardsToken is dQUICK so we have to swap it to QUICK first and then to tokenB
                                tokenBAddress
                            ],
                            amountOutMin: 1
                        }
                    ],
                    { route: [], amountOutMin: 0 },
                    constants.ZERO_ADDRESS,
                    { from: distributor }
                )
            })
            it('updates user stakes', async () => {
                const assetRouter = await UnoAssetRouterQuickswap.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool
                const totalSupply = await strategyToken.totalSupply()
                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                it('user stakes for account1', async () => {
                    const { stakeA, stakeB } = await autoStrategy.userStake(account1)
                    const strategyTokenBalance = await strategyToken.balanceOf(account1)

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
                it('user stakes for banxe', async () => {
                    const { stakeA, stakeB } = await autoStrategy.userStake(banxe)
                    const strategyTokenBalance = await strategyToken.balanceOf(banxe)

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
            })
            it('increases total deposits', async () => {
                const { totalDepositsA, totalDepositsB } = await autoStrategy.totalDeposits()

                assert.ok(totalDepositsA.gt(totalDepositsABefore), 'totalDeposits of tokenA were not increased')
                assert.ok(totalDepositsB.gt(totalDepositsBBefore), 'totalDeposits of tokenB were not increased')
            })
            it('withdraws rewards', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                const tokenAAddress = await autoStrategy.tokenA()
                const tokenBAddress = await autoStrategy.tokenB()
                const tokenA = await IERC20.at(tokenAAddress)
                const tokenB = await IERC20.at(tokenBAddress)

                await autoStrategy.withdraw(strategyTokenBalance, 0, 0, account1, {
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
            await autoStrategy.pause({ from: pauser })
        })
        describe('reverts', () => {
            it('reverts deposit if paused', async () => {
                await expectRevert(
                    autoStrategy.deposit(0, 0, 0, 0, account1, {
                        from: banxe
                    }),
                    'Pausable: paused'
                )
            })
            it('reverts withdraw if paused', async () => {
                await expectRevert(
                    autoStrategy.withdraw(0, 0, 0, account1, {
                        from: account1
                    }),
                    'Pausable: paused'
                )
            })
            it('reverts moveLiquidity if paused', async () => {
                await expectRevert(
                    autoStrategy.moveLiquidity(0, 0, 0, {
                        from: account1
                    }),
                    'Pausable: paused'
                )
            })
        })
    })

    describe('Banxe role transfer', () => {
        it('reverts transferBanxe if called not by a banxe', async () => {
            await expectRevert(
                autoStrategy.transferBanxe(account1, {
                    from: account1
                }),
                'CALLER_NOT_BANXE'
            )
        })
        it('reverts moveLiquidity if paused', async () => {
            await expectRevert(
                autoStrategy.transferBanxe(constants.ZERO_ADDRESS, {
                    from: banxe
                }),
                'TRANSFER_TO_ZERO_ADDRESS'
            )
        })
        it('transfers banxe', async () => {
            const receipt = await autoStrategy.transferBanxe(account1, {
                from: banxe
            })
            expectEvent(receipt, 'BanxeTransferred', {
                previousBanxe: banxe,
                newBanxe: account1
            })

            const _banxe = await autoStrategy.banxe()

            assert.equal(
                _banxe,
                account1,
                'Banxe is not transfered correctly'
            )
        })
    })
    describe('Upgradeability', () => {
        describe('updates', () => {
            const receipt = {}
            before(async () => {
                const instance = await upgradeProxy(autoStrategy.address, AutoStrategyV2)
                // we get last transaction's hash by finding the last event because upgradeProxy returns contract instance instead of transaction receipt object
                const events = await instance.getPastEvents('AllEvents', {
                    fromBlock: 'latest',
                    toBlock: 'latest'
                })
                const _receipt = await web3.eth.getTransactionReceipt(events[0].transactionHash)
                // convert web3's receipt to truffle's format
                receipt.tx = _receipt.transactionHash
                receipt.receipt = _receipt
                receipt.logs = events

                autoStrategy = await AutoStrategyV2.at(autoStrategy.address)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Upgraded')
            })
            it('Updates', async () => {
                assert.equal(
                    (await autoStrategy.version()).toString(),
                    (new BN(2)).toString(),
                    'Contract not updated'
                )
                assert.equal(
                    await autoStrategy.banxe(),
                    account1,
                    'banxe changed'
                )
                assert.equal(
                    await autoStrategy.accessManager(),
                    accessManager.address,
                    'accessManager changed'
                )
                assert.equal(
                    (await autoStrategy.tokenA()).toLowerCase(),
                    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase(),
                    'tokenA changed'
                )
                assert.equal(
                    (await autoStrategy.tokenB()).toLowerCase(),
                    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'.toLowerCase(),
                    'tokenB changed'
                )
            })
        })
    })
})
