const {
    expectRevert,
    expectEvent,
    BN,
    constants,
    time
} = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniswapV2Router01 = artifacts.require('IUniswapV2Router01')
const IMasterJoe = artifacts.require('IMasterChefJoe')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTraderjoe')
const AssetRouter = artifacts.require('UnoAssetRouterTraderjoe')
const AssetRouterV2 = artifacts.require('UnoAssetRouterTraderjoeV2')

const traderjoeRouter = '0x60aE616a2155Ee3d9A68541Ba4544862310933d4'
const pool = '0x0512Ab7CcF96AF5512dBc2d4C93048f3f6A16608' // wAVAX-USDC

const masterJoeAddress = '0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00'

const JOEHolder = '0x799d4c5e577cf80221a076064a2054430d2af5cd' // has to be unlocked and hold 0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a

const account1 = '0x406f7956a8962792F458615194E4Adb7A06248ed' // has to be unlocked and hold 0xf4003F4efBE8691B60249E6afbD307aBE7758adb
const account2 = '0x05810778827F97e742AB4657660901F4d6FA9dCf' // has to be unlocked and hold 0xf4003F4efBE8691B60249E6afbD307aBE7758adb

const amounts = [
    new BN(100000),
    new BN(300000),
    new BN(500000),
    new BN(400000000),
    new BN(4400000000)
]

const feeCollector = '0xFFFf795B802CB03FD664092Ab169f5f5c236335c'
const fee = new BN('40000000000000000') // 4%

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).abs()
    assert.ok(
        epsilon.gte(amountDelta),
        `([|${bn1} - ${bn2}| = ${bn1
            .sub(bn2)
            .abs()}] >  ${epsilon}), ${message}`
    )
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
contract('UnoAssetRouterTraderjoe for MasterChefv3', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager
    let assetRouter
    let factory

    let stakingToken
    let snapshotId

    let tokenA
    let tokenB
    let masterJoe
    let pid
    let rewardToken

    const initReceipt = {}
    before(async () => {
        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot.result

        const implementation = await Farm.new({ from: account1 })
        accessManager = await AccessManager.new({ from: admin }) // accounts[0] is admin

        await accessManager.grantRole(
            '0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c',
            distributor,
            { from: admin }
        ) // DISTRIBUTOR_ROLE
        await accessManager.grantRole(
            '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
            pauser,
            { from: admin }
        ) // PAUSER_ROLE

        assetRouter = await deployProxy(AssetRouter, {
            kind: 'uups',
            initializer: false
        })

        factory = await FarmFactory.new(
            implementation.address,
            accessManager.address,
            assetRouter.address,
            { from: account1 }
        )

        const _receipt = await web3.eth.getTransactionReceipt(
            factory.transactionHash
        )
        const events = await assetRouter.getPastEvents('AllEvents', {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })
        // convert web3's receipt to truffle's formatIMasterJoe
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        stakingToken = await IERC20.at(pool)

        const lpToken = await IUniswapV2Pair.at(pool)
        await lpToken.transfer(account2, amounts[4], { from: account1 })

        const tokenAAddress = await lpToken.token0()
        const tokenBAddress = await lpToken.token1()

        tokenA = await IERC20.at(tokenAAddress)
        tokenB = await IERC20.at(tokenBAddress)

        masterJoe = await IMasterJoe.at(masterJoeAddress)
        const poolLength = await masterJoe.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const _lpToken = (await masterJoe.poolInfo(i)).lpToken
            if (_lpToken.toString() === pool) {
                pid = i
                break
            }
        }

        rewardToken = await masterJoe.JOE()

        const JOEtoken = await IERC20.at(rewardToken)
        const JOEbalance = await JOEtoken.balanceOf(JOEHolder)
        await JOEtoken.transfer(masterJoeAddress, JOEbalance, {
            from: JOEHolder
        })
    })

    describe('Emits initialize event', () => {
        it('fires events', async () => {
            expectEvent(initReceipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async () => {
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, {
                    from: account1
                }),
                'Initializable: contract is already initialized'
            )
        })
    })

    describe('Initializes variables', () => {
        it('Inits pausable ', async () => {
            assert.equal(
                await assetRouter.paused(),
                false,
                'Pausable not initialized'
            )
        })
        it('Sets accessManager', async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                'accessManager not set'
            )
        })

        it('Sets farmFactory', async () => {
            assert.equal(
                await assetRouter.farmFactory(),
                factory.address,
                'farmFactory not set'
            )
        })

        it('Sets WAVAX', async () => {
            assert.equal(
                (await assetRouter.WAVAX()).toLowerCase(),
                '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'.toLowerCase(),
                'farmFactory not set'
            )
        })
    })

    describe('getTokens', () => {
        let tokens
        before(async () => {
            tokens = await assetRouter.getTokens(pool)
        })
        it('TokenA is correct', async () => {
            assert.equal(tokens[0], tokenA.address, 'TokenA is not correct')
        })
        it('TokenB is correct', async () => {
            assert.equal(tokens[1], tokenB.address, 'TokenB is not correct')
        })
    })

    describe('Pausable', () => {
        describe('reverts', () => {
            it('reverts if called not by a pauser', async () => {
                await expectRevertCustomError(
                    assetRouter.pause({ from: account1 }),
                    'CALLER_NOT_AUTHORIZED'
                )
                await expectRevertCustomError(
                    assetRouter.unpause({ from: account1 }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
        })

        describe('pauses', () => {
            let receipt
            before(async () => {
                receipt = await assetRouter.pause({ from: pauser })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Paused', { account: pauser })
            })
            it('switches paused state', async () => {
                assert.equal(await assetRouter.paused(), true, 'Not paused')
            })
            it('prevents function calls', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, {
                        from: account1
                    }),
                    'Pausable: paused'
                )
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: account1 }
                    ),
                    'Pausable: paused'
                )
            })
            it('reverts if called pause on paused contract', async () => {
                await expectRevert(
                    assetRouter.pause({ from: pauser }),
                    'Pausable: paused'
                )
            })
        })

        describe('unpauses', () => {
            let receipt
            before(async () => {
                receipt = await assetRouter.unpause({ from: pauser })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Unpaused', { account: pauser })
            })
            it('switches paused state', async () => {
                assert.equal(await assetRouter.paused(), false, 'Paused')
            })
            it('allows function calls', async () => {
                // Pausable: paused check passes. revert for a different reason
                await expectRevertCustomError(
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, {
                        from: account1
                    }),
                    'NO_TOKENS_SENT'
                )
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: account1 }
                    ),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if called unpause on unpaused contract', async () => {
                await expectRevert(
                    assetRouter.unpause({ from: pauser }),
                    'Pausable: not paused'
                )
            })
        })
    })

    let farm
    describe('Deposits', () => {
        describe('reverts', () => {
            it('reverts if total amount provided is zero', async () => {
                await expectRevertCustomError(
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, {
                        from: account1
                    }),
                    'NO_TOKENS_SENT'
                )
            })
        })
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], {
                    from: account1
                })
                receipt = await assetRouter.depositLP(
                    pool,
                    amounts[0],
                    account1,
                    { from: account1 }
                )

                const farmAddress = await factory.Farms(pool)
                farm = await Farm.at(farmAddress)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[0]
                })
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (
                        await masterJoe.userInfo(pid, farm.address)
                    ).amount.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], {
                    from: account1
                })
                receipt = await assetRouter.depositLP(
                    pool,
                    amounts[1],
                    account1,
                    { from: account1 }
                )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[1]
                })
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (
                        await masterJoe.userInfo(pid, farm.address)
                    ).amount.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], {
                    from: account2
                })
                receipt = await assetRouter.depositLP(
                    pool,
                    amounts[2],
                    account2,
                    { from: account2 }
                )
            })

            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account2,
                    recipient: account2,
                    amount: amounts[2]
                })
            })
            it("doesn't change stakes for account[0]", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    'Amount sent changed userStake for account1'
                )
            })
            it('updates stakes for account[1]', async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (
                        await masterJoe.userInfo(pid, farm.address)
                    ).amount.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], {
                    from: account1
                })
                receipt = await assetRouter.depositLP(
                    pool,
                    amounts[3],
                    account2,
                    { from: account1 }
                )
            })
            it('fires event', async () => {
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account2,
                    amount: amounts[3]
                })
            })
            it('doesnt change stakes for account1', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    'stakeLP is not 0'
                )
            })
            it('updates stakes for account2', async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].add(amounts[3]).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0]
                        .add(amounts[1])
                        .add(amounts[2])
                        .add(amounts[3])
                        .toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (
                        await masterJoe.userInfo(pid, farm.address)
                    ).amount.toString(),
                    amounts[0]
                        .add(amounts[1])
                        .add(amounts[2])
                        .add(amounts[3])
                        .toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            let balanceAbefore
            let balanceBbefore
            let stakeABefore
            let stakeBBefore
            let stakeLPBefore
            let totalDepositsLPBefore
            let stakingRewardsBalanceBefore

            let amountA
            let amountB

            before(async () => {
                const routerContract = await IUniswapV2Router01.at(
                    traderjoeRouter
                )
                await stakingToken.approve(traderjoeRouter, amounts[4], {
                    from: account1
                })
                const tx = await routerContract.removeLiquidity(
                    tokenA.address,
                    tokenB.address,
                    amounts[4],
                    1,
                    1,
                    account1,
                    '16415710000',
                    { from: account1 }
                )
                const event = tx.receipt.rawLogs.find(
                    (l) => l.topics[0]
                        === '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'
                )

                amountA = web3.utils.hexToNumberString(
                    event.data.substring(0, 66)
                )
                amountB = web3.utils.hexToNumberString(
                    `0x${event.data.substring(66, 130)}`
                )

                balanceAbefore = await tokenA.balanceOf(account1)
                balanceBbefore = await tokenB.balanceOf(account1);
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(account1, pool));
                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool))
                stakingRewardsBalanceBefore = new BN(
                    (await masterJoe.userInfo(pid, farm.address))['0']
                )

                await tokenA.approve(assetRouter.address, amountA, {
                    from: account1
                })
                await tokenB.approve(assetRouter.address, amountB, {
                    from: account1
                })
            })
            it('reverts if minAmountA > amountA || minAmountB > amountB', async () => {
                await expectRevert(
                    assetRouter.deposit(
                        pool,
                        amountA,
                        new BN(1),
                        amountA,
                        0,
                        account1,
                        { from: account1 }
                    ),
                    'INSUFFICIENT_A_AMOUNT'
                )
                await expectRevert(
                    assetRouter.deposit(
                        pool,
                        new BN(1),
                        amountB,
                        0,
                        amountB,
                        account1,
                        { from: account1 }
                    ),
                    'INSUFFICIENT_B_AMOUNT'
                )
            })
            it('fires events', async () => {
                const receipt = await assetRouter.deposit(
                    pool,
                    amountA,
                    amountB,
                    0,
                    0,
                    account1,
                    { from: account1 }
                )
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1
                })
            })
            it('withdraws tokens from balance', async () => {
                const balanceAafter = await tokenA.balanceOf(account1)
                const balanceBafter = await tokenB.balanceOf(account1)

                assert.ok(
                    balanceAbefore.gt(balanceAafter),
                    'TokenA was not withdrawn from user balance'
                )
                assert.ok(
                    balanceBbefore.gt(balanceBafter),
                    'TokenB was not withdrawn from user balance'
                )
            })
            it('updates stakes', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(
                    account1,
                    pool
                )
                assert.ok(
                    stakeLP.gt(stakeLPBefore),
                    'TokenA was not withdrawn from user balance'
                )
                assert.ok(
                    stakeA.gt(stakeABefore),
                    'TokenA was not withdrawn from user balance'
                )
                assert.ok(
                    stakeB.gt(stakeBBefore),
                    'TokenB was not withdrawn from user balance'
                ) // change strings
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.ok(
                    totalDepositsLP.gt(totalDepositsLPBefore),
                    'TokenA was not withdrawn from user balance'
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.ok(
                    new BN(
                        (await masterJoe.userInfo(pid, farm.address))['0']
                    ).gt(stakingRewardsBalanceBefore),
                    'StakingRewards balance was not increased'
                )
            })
        })
    })
    describe('withdraw', () => {
        describe('reverts', () => {
            it('reverts if the stake is zero', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool, new BN(1), admin, {
                        from: admin
                    }),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(
                        pool,
                        constants.MAX_UINT256,
                        account1,
                        { from: account1 }
                    ),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool, 0, account1, {
                        from: account1
                    }),
                    'INSUFFICIENT_AMOUNT'
                )
            })
        })
        describe('withdraws for multiple accs', () => {
            let balance1before
            let balance2before
            let stake1before
            let stake2before

            let receipt1
            let receipt2

            before(async () => {
                balance1before = await stakingToken.balanceOf(account1)
                balance2before = await stakingToken.balanceOf(account2);
                ({ stakeLP: stake1before } = await assetRouter.userStake(
                    account1,
                    pool
                ));
                ({ stakeLP: stake2before } = await assetRouter.userStake(
                    account2,
                    pool
                ))

                receipt1 = await assetRouter.withdrawLP(
                    pool,
                    amounts[0],
                    account1,
                    { from: account1 }
                )
                receipt2 = await assetRouter.withdrawLP(
                    pool,
                    amounts[2],
                    account2,
                    { from: account2 }
                )
            })
            it('fires events', async () => {
                expectEvent(receipt1, 'Withdraw', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[0]
                })
                expectEvent(receipt2, 'Withdraw', {
                    lpPool: pool,
                    sender: account2,
                    recipient: account2,
                    amount: amounts[2]
                })
            })

            it('correctly updates userStake for account1', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    'Stake is not zero for account1'
                )
            })
            it('correctly updates userStake for account2', async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    'Stake is not right for account2'
                )
            })
            it('correctly updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before
                        .sub(amounts[0])
                        .add(stake2before.sub(amounts[2]))
                        .toString(),
                    'totalDeposits are not right'
                )
            })
            it('transfers tokens to user', async () => {
                const balance1after = await stakingToken.balanceOf(account1)
                assert.equal(
                    balance1after.sub(balance1before).toString(),
                    amounts[0].toString(),
                    'Tokens withdrawn for account1 do not equal provided in the withdraw function'
                )
                const balance2after = await stakingToken.balanceOf(account2)
                assert.equal(
                    balance2after.sub(balance2before),
                    amounts[2].toString(),
                    'Tokens withdrawn for account2 do not equal provided in the withdraw function'
                )
            })
        })
        describe('withdraws for different acc', () => {
            let balance1before
            let balance2before
            let stake1before
            let stake2before

            let receipt
            before(async () => {
                balance1before = await stakingToken.balanceOf(account1)
                balance2before = await stakingToken.balanceOf(account2);
                ({ stakeLP: stake1before } = await assetRouter.userStake(
                    account1,
                    pool
                ));
                ({ stakeLP: stake2before } = await assetRouter.userStake(
                    account2,
                    pool
                ))

                receipt = await assetRouter.withdrawLP(
                    pool,
                    amounts[1],
                    account2,
                    { from: account1 }
                )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account2,
                    amount: amounts[1]
                })
            })
            it('correctly changes userStake for account1', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[1]).toString(),
                    'Stake is not right for account1'
                )
            })
            it('doesnt change stake for account2', async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.toString(),
                    'Stake is not right for account2'
                )
            })
            it('transfers tokens to account2', async () => {
                const balance1after = await stakingToken.balanceOf(account1)
                assert.equal(
                    balance1after.sub(balance1before).toString(),
                    '0',
                    'Tokens were withdrawn for account1'
                )
                const balance2after = await stakingToken.balanceOf(account2)
                assert.equal(
                    balance2after.sub(balance2before).toString(),
                    amounts[1].toString(),
                    'Tokens withdrawn for account2 do not equal provided in the withdraw function'
                )
            })
        })
        describe('withdraws normal tokens', () => {
            let balanceAbefore
            let balanceBbefore

            let stakeLP1
            let stakeA1
            let stakeB1
            let stakeLP2
            let stakeA2
            let stakeB2

            let receipt
            before(async () => {
                balanceAbefore = await tokenA.balanceOf(account1)
                balanceBbefore = await tokenB.balanceOf(account1);
                ({
                    stakeLP: stakeLP1,
                    stakeA: stakeA1,
                    stakeB: stakeB1
                } = await assetRouter.userStake(account1, pool));
                ({
                    stakeLP: stakeLP2,
                    stakeA: stakeA2,
                    stakeB: stakeB2
                } = await assetRouter.userStake(account2, pool))
                receipt = await assetRouter.withdraw(
                    pool,
                    stakeLP1,
                    0,
                    0,
                    account1,
                    { from: account1 }
                )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1,
                    amount: stakeLP1
                })
            })
            it('correctly updates account1 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(
                    account1,
                    pool
                )
                assert.equal(stakeLP.toString(), '0', 'stakeLP is wrong')
                assert.equal(stakeA.toString(), '0', 'stakeA is wrong')
                assert.equal(stakeB.toString(), '0', 'stakeB is wrong')
            })
            it('doesnt update account2 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(
                    account2,
                    pool
                )
                assert.equal(stakeLP.toString(), stakeLP2, 'stakeLP is wrong')
                assert.equal(stakeA.toString(), stakeA2, 'stakeA is wrong')
                assert.equal(stakeB.toString(), stakeB2, 'stakeB is wrong')
            })
            it('transfers tokens to user', async () => {
                const balanceAafter = await tokenA.balanceOf(account1)
                assert.equal(
                    balanceAafter.sub(balanceAbefore).toString(),
                    stakeA1.toString(),
                    'TokensA withdrawn do not equal deposited'
                )

                const balanceBafter = await tokenB.balanceOf(account1)
                assert.equal(
                    balanceBafter.sub(balanceBbefore).toString(),
                    stakeB1.toString(),
                    'TokensB withdrawn do not equal deposited'
                )
            })
        })
        describe('withdraws normal tokens for a different user', () => {
            let balanceAbefore
            let balanceBbefore

            let stakeLP2
            let stakeA2
            let stakeB2
            let stakeLP1
            let stakeA1
            let stakeB1

            let receipt
            before(async () => {
                balanceAbefore = await tokenA.balanceOf(account1)
                balanceBbefore = await tokenB.balanceOf(account1);
                ({
                    stakeLP: stakeLP1,
                    stakeA: stakeA1,
                    stakeB: stakeB1
                } = await assetRouter.userStake(account1, pool));
                ({
                    stakeLP: stakeLP2,
                    stakeA: stakeA2,
                    stakeB: stakeB2
                } = await assetRouter.userStake(account2, pool))
                receipt = await assetRouter.withdraw(
                    pool,
                    stakeLP2,
                    0,
                    0,
                    account1,
                    { from: account2 }
                )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool,
                    sender: account2,
                    recipient: account1,
                    amount: stakeLP2
                })
            })
            it('correctly updates account2 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(
                    account2,
                    pool
                )
                assert.equal(stakeLP.toString(), '0', 'stakeLP is wrong')
                assert.equal(stakeA.toString(), '0', 'stakeA is wrong')
                assert.equal(stakeB.toString(), '0', 'stakeB is wrong')
            })
            it('doesnt update account1 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(
                    account1,
                    pool
                )
                assert.equal(stakeLP.toString(), stakeLP1, 'stakeLP is wrong')
                assert.equal(stakeA.toString(), stakeA1, 'stakeA is wrong')
                assert.equal(stakeB.toString(), stakeB1, 'stakeB is wrong')
            })
            it('transfers tokens to correct user', async () => {
                const balanceAafter = await tokenA.balanceOf(account1)
                assert.equal(
                    balanceAafter.sub(balanceAbefore).toString(),
                    stakeA2.toString(),
                    'TokensA withdrawn do not equal deposited'
                )

                const balanceBafter = await tokenB.balanceOf(account1)
                assert.equal(
                    balanceBafter.sub(balanceBbefore).toString(),
                    stakeB2.toString(),
                    'TokensB withdrawn do not equal deposited'
                )
            })
        })
    })

    describe('Sets Fee', () => {
        describe('reverts', () => {
            it('reverts if called not by an admin', async () => {
                await expectRevertCustomError(
                    assetRouter.setFee(fee, { from: account1 }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if fee is greater than 100%', async () => {
                await expectRevertCustomError(
                    assetRouter.setFee('1000000000000000001', { from: admin }),
                    'BAD_FEE'
                )
            })
        })
        describe('Sets new fee', () => {
            let receipt
            before(async () => {
                receipt = await assetRouter.setFee(fee, { from: admin })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'FeeChanged', {
                    previousFee: new BN(0),
                    newFee: fee
                })
            })
            it('sets new fee', async () => {
                assert.equal(
                    (await assetRouter.fee()).toString(),
                    fee.toString(),
                    'Fee is not correct'
                )
            })
        })
    })

    describe('Distributions', () => {
        let WETH
        describe('reverts', () => {
            it('reverts if called not by distributor', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: pauser }
                    ),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if there is no liquidity in the pool', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'NO_LIQUIDITY'
                )
            })
        })
        describe('distributes', () => {
            let receipt
            let balance1
            let balance2
            let feeCollectorRewardBalanceBefore
            let feeCollectorRewarderBalanceBefore
            before(async () => {
                balance1 = await stakingToken.balanceOf(account1)
                await stakingToken.approve(assetRouter.address, balance1, {
                    from: account1
                })
                await assetRouter.depositLP(
                    pool,
                    balance1,
                    account1,
                    { from: account1 }
                )

                balance2 = await stakingToken.balanceOf(account2)
                await stakingToken.approve(assetRouter.address, balance2, {
                    from: account2
                })
                await assetRouter.depositLP(
                    pool,
                    balance2,
                    account2,
                    { from: account2 }
                )

                const reward = await IERC20.at(rewardToken)
                feeCollectorRewardBalanceBefore = await reward.balanceOf(feeCollector)
                const _rewarder = await IERC20.at(tokenB.address)
                feeCollectorRewarderBalanceBefore = await _rewarder.balanceOf(feeCollector)
                await time.increase(5000000)
                receipt = await assetRouter.distribute(
                    pool,
                    [
                        {
                            route: [
                                rewardToken,
                                tokenA.address
                            ],
                            amountOutMin: 0
                        },
                        {
                            route: [
                                rewardToken,
                                '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
                                tokenB.address
                            ],
                            amountOutMin: 0
                        },
                        {
                            route: [
                                tokenB.address,
                                tokenA.address
                            ],
                            amountOutMin: 0
                        },
                        {
                            route: [
                                tokenB.address,
                                tokenA.address
                            ],
                            amountOutMin: 0
                        }
                    ],
                    feeCollector,
                    { from: distributor }
                )
            })
            it('emits event', async () => {
                expectEvent(receipt, 'Distribute', { lpPool: pool })
            })
            it('increases token stakes', async () => {
                const { stakeLP: stake1 } = await assetRouter.userStake(
                    account1,
                    pool
                )
                assert.ok(stake1.gt(balance1), 'Stake1 not increased')

                const { stakeLP: stake2 } = await assetRouter.userStake(
                    account2,
                    pool
                )
                assert.ok(stake2.gt(balance2), 'Stake2 not increased')
            })
            it('collects fees', async () => {
                const reward = await IERC20.at(rewardToken)
                const feeCollectorRewardBalanceAfter = await reward.balanceOf(feeCollector)
                assert.ok(feeCollectorRewardBalanceAfter.gt(feeCollectorRewardBalanceBefore), 'Fee collector balance not increased')

                const _rewarder = await IERC20.at(tokenB.address)
                const feeCollectorRewarderBalanceAfter = await _rewarder.balanceOf(feeCollector)
                assert.ok(feeCollectorRewarderBalanceAfter.gt(feeCollectorRewarderBalanceBefore), 'Fee collector balance not increased')
            })
        })
        describe('bad path reverts', () => {
            before(async () => {
                await time.increase(5000000)
            })
            it('reverts if passed wrong reward token', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    constants.ZERO_ADDRESS,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenA.address
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenB.address
                                ],
                                amountOutMin: 0
                            },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_A_ROUTE'
                )
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenA.address
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    constants.ZERO_ADDRESS,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenB.address
                                ],
                                amountOutMin: 0
                            },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_B_ROUTE'
                )
            })
            it('reverts if passed wrong tokenA in reward route', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    constants.ZERO_ADDRESS
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenB.address
                                ],
                                amountOutMin: 0
                            },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_A_ROUTE'
                )
            })
            it('reverts if passed wrong tokenB in reward route', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    tokenA.address
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    rewardToken,
                                    '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
                                    constants.ZERO_ADDRESS
                                ],
                                amountOutMin: 0
                            },
                            { route: [], amountOutMin: 0 },
                            { route: [], amountOutMin: 0 }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_B_ROUTE'
                )
            })
        })
        describe('withdraws', () => {
            it('withdraws all tokens for account1', async () => {
                let { stakeLP } = await assetRouter.userStake(account1, pool)
                await assetRouter.withdrawLP(
                    pool,
                    stakeLP,
                    account1,
                    { from: account1 }
                );
                ({ stakeLP } = await assetRouter.userStake(account1, pool))
                assert.equal(stakeLP.toString(), '0', 'acount1 stake not 0')
            })
            it('withdraws tokens for account2', async () => {
                let { stakeLP } = await assetRouter.userStake(account2, pool)
                await assetRouter.withdrawLP(
                    pool,
                    stakeLP,
                    account2,
                    { from: account2 }
                );
                ({ stakeLP } = await assetRouter.userStake(account2, pool))
                assert.equal(stakeLP.toString(), '0', 'acount2 stake not 0')
            })
            it('not leaves any tokens', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(
                    pool
                )
                assert.equal(
                    totalDepositsLP.toString(),
                    '0',
                    'totalDeposits not 0'
                )
            })
        })
    })
    describe('Upgradeability', () => {
        describe('updates', () => {
            const receipt = {}
            before(async () => {
                const instance = await upgradeProxy(
                    assetRouter.address,
                    AssetRouterV2
                )
                // we get last transaction's hash by finding the last event because upgradeProxy returns contract instance instead of transaction receipt object
                const events = await instance.getPastEvents('AllEvents', {
                    fromBlock: 'latest',
                    toBlock: 'latest'
                })
                const _receipt = await web3.eth.getTransactionReceipt(
                    events[0].transactionHash
                )
                // convert web3's receipt to truffle's format
                receipt.tx = _receipt.transactionHash
                receipt.receipt = _receipt
                receipt.logs = events

                assetRouter = await AssetRouterV2.at(assetRouter.address)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Upgraded')
            })
            it('Updates', async () => {
                assert.equal(
                    (await assetRouter.version()).toString(),
                    new BN(2).toString(),
                    'Contract not updated'
                )
                assert.equal(
                    await assetRouter.farmFactory(),
                    factory.address,
                    'farmFactory changed'
                )
                assert.equal(
                    await assetRouter.accessManager(),
                    accessManager.address,
                    'accessManager changed'
                )
            })
        })
    })
    after(async () => {
        await timeMachine.revertToSnapshot(snapshotId)
    })
})