const {
    expectRevert, expectEvent, BN, constants, time
} = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniswapV2Router02 = artifacts.require('IUniswapV2Router02')
const IUniversalMasterChef = artifacts.require('IUniversalMasterChef')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTrisolarisStandard')
const AssetRouter = artifacts.require('UnoAssetRouterTrisolarisStandard')
const AssetRouterV2 = artifacts.require('UnoAssetRouterTrisolarisStandardV2')

const trisolarisRouter = '0x2CB45Edb4517d5947aFdE3BEAbF95A582506858B'
const pool = '0x2fe064B6c7D274082aa5d2624709bC9AE7D16C77' // USDC-USDT pool
const pool2 = '0x03B666f3488a7992b2385B12dF7f35156d7b29cD' // wNEAR-USDT pool
const pool3 = '0x5eeC60F348cB1D661E4A5122CF4638c7DB7A886e' // AURORA-ETH pool

const masterChefV1 = '0x1f1Ed214bef5E83D8f5d0eB5D7011EB965D0D79B'
const masterChefV2 = '0x3838956710bcc9D122Dd23863a0549ca8D5675D6'

const account1 = '0x631A44F635c8fF85848324Be5F8f5aCbed0b9ce5' // has to be unlocked
const account2 = '0xe73AAF36edd9BDE33DBf9eb42047d326333319e0' // has to be unlocked
const account3 = '0xDca192b98BB4EA03076b3b52845519C30d68524D' // has to be unlocked

const TRIholder = '0x670FBcd11fD54908cabE97384F0D2785d369DCD5' // has to be unlocked

const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(2500), new BN(52792912217)]

const feeCollector = '0xFFFf795B802CB03FD664092Ab169f5f5c236335c'
const fee = new BN('40000000000000000')// 4%

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

contract('UnoAssetRouterTrisolarisStandard', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager; let assetRouter; let
        factory
    let snapshotId
    let MasterChef
    let pid
    let lpToken
    let tokenA; let
        tokenB

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

        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })

        factory = await FarmFactory.new(
            implementation.address,
            accessManager.address,
            assetRouter.address,
            { from: account1 }
        )

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash)
        const events = await assetRouter.getPastEvents('AllEvents', {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })
        // convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        const MasterChefV1 = await IUniversalMasterChef.at(masterChefV1)
        const MasterChefV2 = await IUniversalMasterChef.at(masterChefV2)

        const poolLengthV1 = (await MasterChefV1.poolLength()).toNumber()
        const poolLengthV2 = (await MasterChefV2.poolLength()).toNumber()

        let poolFound = false

        for (let i = 0; i < poolLengthV2; i++) {
            const _lpToken = await MasterChefV2.lpToken(i)
            if (_lpToken.toString() === pool) {
                pid = i
                poolFound = true
                masterChefType = 2
                break
            }
        }

        if (!poolFound) {
            for (let i = 0; i < poolLengthV1; i++) {
                const _lpToken = (await MasterChefV1.poolInfo(i))['0']
                if (_lpToken.toString() === pool) {
                    pid = i
                    poolFound = true
                    masterChefType = 1
                    break
                }
            }
        }

        MasterChef = masterChefType === 1 ? MasterChefV1 : MasterChefV2

        rewardTokenAddress = masterChefType === 1
            ? (await MasterChef.tri()).toString()
            : (await MasterChef.TRI()).toString()

        const complexRewarder = (await MasterChef.rewarder(pid)).toString()

        if (complexRewarder !== constants.ZERO_ADDRESS) {
            const ComplexRewarder = await IComplexRewarder.at(complexRewarder)
            const data = await ComplexRewarder.pendingTokens(pid, constants.ZERO_ADDRESS, 0)
            rewarderTokenAddress = data['0']['0'].toString()
        } else {
            rewarderTokenAddress = constants.ZERO_ADDRESS
        }

        lpToken = await IUniswapV2Pair.at(pool)

        const tokenAAddress = (await lpToken.token0()).toString()
        const tokenBAddress = (await lpToken.token1()).toString()

        tokenA = await IERC20.at(tokenAAddress)
        tokenB = await IERC20.at(tokenBAddress)

        stakingToken = await IERC20.at(pool)

        const TRItoken = await IERC20.at(rewardTokenAddress)
        const TRIbalance = await TRItoken.balanceOf(TRIholder)
        await TRItoken.transfer(MasterChef.address, TRIbalance, { from: TRIholder })
    })

    describe('Emits initialize event', () => {
        it('fires events', async () => {
            expectEvent(initReceipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async () => {
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, { from: account1 }),
                'Initializable: contract is already initialized'
            )
        })
    })

    describe('Initializes variables', () => {
        it('Inits pausable ', async () => {
            assert.equal(await assetRouter.paused(), false, 'Pausable not initialized')
        })
        it('Sets accessManager', async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                'accessManager not set'
            )
        })

        it('Sets farmFactory', async () => {
            assert.equal(await assetRouter.farmFactory(), factory.address, 'farmFactory not set')
        })
    })

    describe('getTokens', () => {
        let _tokens
        before(async () => {
            _tokens = await assetRouter.getTokens(pool)
        })
        it('TokenA is correct', async () => {
            assert.equal(_tokens[0], tokenA.address, 'TokenA is not correct')
        })
        it('TokenB is correct', async () => {
            assert.equal(_tokens[1], tokenB.address, 'TokenB is not correct')
        })
    })

    describe('Pausable', () => {
        describe('reverts', () => {
            it('reverts if called not by a pauser', async () => {
                await expectRevertCustomError(assetRouter.pause({ from: account1 }), 'CALLER_NOT_AUTHORIZED')
                await expectRevertCustomError(assetRouter.unpause({ from: account1 }), 'CALLER_NOT_AUTHORIZED')
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
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, { from: account1 }),
                    'Pausable: paused'
                )
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                        feeCollector,
                        { from: account1 }
                    ),
                    'Pausable: paused'
                )
            })
            it('reverts if called pause on paused contract', async () => {
                await expectRevert(assetRouter.pause({ from: pauser }), 'Pausable: paused')
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
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, { from: account1 }),
                    'NO_TOKENS_SENT'
                )
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                        feeCollector,
                        { from: account1 }
                    ),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if called unpause on unpaused contract', async () => {
                await expectRevert(assetRouter.unpause({ from: pauser }), 'Pausable: not paused')
            })
        })
    })

    let farm
    describe('Deposits', () => {
        describe('reverts', () => {
            it('reverts if total amount provided is zero', async () => {
                await expectRevertCustomError(
                    assetRouter.deposit(pool, 0, 0, 0, 0, account1, { from: account1 }),
                    'NO_TOKENS_SENT'
                )
            })
            it('cant deposit using depositETH without value', async () => {
                await expectRevertCustomError(
                    assetRouter.depositETH(pool, 0, 0, 0, account1, { from: account1 }),
                    'NO_ETH_SENT'
                )
            })
            it('cant deposit using depositETH in not weth pool', async () => {
                await expectRevertCustomError(
                    assetRouter.depositETH(pool, 1, 0, 0, account1, { from: account1, value: 1 }),
                    'NOT_WETH_POOL'
                )
            })
        })
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[0], account1, {
                    from: account1
                })

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
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))['0'].toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[1], account1, {
                    from: account1
                })
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
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))['0'].toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], { from: account2 })
                receipt = await assetRouter.depositLP(pool, amounts[2], account2, {
                    from: account2
                })
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
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))['0'].toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[3], account2, {
                    from: account1
                })
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
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))['0'].toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            let balanceAbefore; let
                balanceBbefore
            let stakeABefore; let
                stakeBBefore

            let amountA; let
                amountB

            let receipt

            before(async () => {
                const routerContract = await IUniswapV2Router02.at(trisolarisRouter)
                await stakingToken.approve(trisolarisRouter, amounts[4], {
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
                const event = tx.receipt.rawLogs.find((l) => (
                    l.topics[0]
                        === '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496'
                ))

                amountA = web3.utils.hexToNumberString(event.data.substring(0, 66))
                amountB = web3.utils.hexToNumberString(`0x${event.data.substring(66, 130)}`)

                balanceAbefore = await tokenA.balanceOf(account1)
                balanceBbefore = await tokenB.balanceOf(account1);
                ({
                    stakeLP,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(account1, pool))

                await tokenA.approve(assetRouter.address, amountA, { from: account1 })
                await tokenB.approve(assetRouter.address, amountB, { from: account1 })
            })
            it('reverts if minAmountA > amountA || minAmountB > amountB', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, amountA, new BN(1), amountA, 0, account1, {
                        from: account1
                    }),
                    'INSUFFICIENT_A_AMOUNT'
                )
                await expectRevert(
                    assetRouter.deposit(pool, new BN(1), amountB, 0, amountB, account1, {
                        from: account1
                    }),
                    'INSUFFICIENT_B_AMOUNT'
                )
            })
            it('fires events', async () => {
                receipt = await assetRouter.deposit(pool, amountA, amountB, 0, 0, account1, {
                    from: account1
                })
                expectEvent(receipt, 'Deposit', {
                    lpPool: pool,
                    sender: account1,
                    recipient: account1
                })
            })
            it('withdraws tokens from balance', async () => {
                const { stakeA, stakeB } = await assetRouter.userStake(account1, pool)
                const balanceAafter = await tokenA.balanceOf(account1)
                const balanceBafter = await tokenB.balanceOf(account1)

                approxeq(
                    stakeA.sub(stakeABefore),
                    balanceAbefore.sub(balanceAafter),
                    new BN(10),
                    'StakeA is not correct'
                )
                approxeq(
                    stakeB.sub(stakeBBefore),
                    balanceBbefore.sub(balanceBafter),
                    new BN(10),
                    'StakeB is not correct'
                )
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool)
                approxeq(
                    stakeLP,
                    amounts[0].add(amounts[1]).add(amounts[4]),
                    new BN(10),
                    "LP Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                approxeq(
                    totalDepositsLP,
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]),
                    new BN(10),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                approxeq(
                    new BN((await MasterChef.userInfo(pid, farm.address))['0'].toString()),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]),
                    new BN(10),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
        })
    })
    describe('withdraw', () => {
        describe('reverts', () => {
            it('reverts if the pool doesnt exist', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool2, amounts[0], account1, {
                        from: account1
                    }),
                    'FARM_NOT_EXISTS'
                )
            })
            it('reverts if the stake is zero', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool, new BN(1), admin, { from: admin }),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool, constants.MAX_UINT256, account1, {
                        from: account1
                    }),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevertCustomError(
                    assetRouter.withdrawLP(pool, 0, account1, { from: account1 }),
                    'INSUFFICIENT_AMOUNT'
                )
            })
        })
        describe('withdraws for multiple accs', () => {
            let balance1before; let
                balance2before
            let stake1before; let
                stake2before

            let receipt1; let
                receipt2

            before(async () => {
                balance1before = await stakingToken.balanceOf(account1)
                balance2before = await stakingToken.balanceOf(account2);

                ({ stakeLP: stake1before } = await assetRouter.userStake(account1, pool));
                ({ stakeLP: stake2before } = await assetRouter.userStake(account2, pool))

                receipt1 = await assetRouter.withdrawLP(pool, amounts[0], account1, {
                    from: account1
                })
                receipt2 = await assetRouter.withdrawLP(pool, amounts[2], account2, {
                    from: account2
                })
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
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before.sub(amounts[0]).add(stake2before.sub(amounts[2])).toString(),
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
            let balance1before; let
                balance2before
            let stake1before; let
                stake2before

            let receipt
            before(async () => {
                balance1before = await stakingToken.balanceOf(account1)
                balance2before = await stakingToken.balanceOf(account2);

                ({ stakeLP: stake1before } = await assetRouter.userStake(account1, pool));
                ({ stakeLP: stake2before } = await assetRouter.userStake(account2, pool))

                receipt = await assetRouter.withdrawLP(pool, amounts[1], account2, {
                    from: account1
                })
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
            let balanceAbefore; let
                balanceBbefore

            let stakeLP1; let stakeA1; let
                stakeB1
            let stakeLP2; let stakeA2; let
                stakeB2

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
                receipt = await assetRouter.withdraw(pool, stakeLP1, 0, 0, account1, {
                    from: account1
                })
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
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account1, pool)
                assert.equal(stakeLP.toString(), '0', 'stakeLP is wrong')
                assert.equal(stakeA.toString(), '0', 'stakeA is wrong')
                assert.equal(stakeB.toString(), '0', 'stakeB is wrong')
            })
            it('doesnt update account2 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account2, pool)
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
            let balanceAbefore; let
                balanceBbefore

            let stakeLP2; let stakeA2; let
                stakeB2
            let stakeLP1; let stakeA1; let
                stakeB1

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
                receipt = await assetRouter.withdraw(pool, stakeLP2, 0, 0, account1, {
                    from: account2
                })
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
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account2, pool)
                assert.equal(stakeLP.toString(), '0', 'stakeLP is wrong')
                assert.equal(stakeA.toString(), '0', 'stakeA is wrong')
                assert.equal(stakeB.toString(), '0', 'stakeB is wrong')
            })
            it('doesnt update account1 stake', async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account1, pool)
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
                expectEvent(receipt, 'FeeChanged', { previousFee: new BN(0), newFee: fee })
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
        describe('reverts', () => {
            it('reverts if called not by distributor', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                        feeCollector,
                        { from: pauser }
                    ),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if pool doesnt exist', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool2,
                        [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                        feeCollector,
                        { from: distributor }
                    ),
                    'FARM_NOT_EXISTS'
                )
            })
            it('reverts if there is no liquidity in the pool', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                        feeCollector,
                        { from: distributor }
                    ),
                    'NO_LIQUIDITY'
                )
            })
        })
        describe('distributes', () => {
            let receipt
            let balance1; let
                balance2
            let feeCollectorBalanceBefore
            before(async () => {
                balance1 = await stakingToken.balanceOf(account1)
                await stakingToken.approve(assetRouter.address, balance1, { from: account1 })
                await assetRouter.depositLP(pool, balance1, account1, { from: account1 })

                balance2 = await stakingToken.balanceOf(account2)
                await stakingToken.approve(assetRouter.address, balance2, { from: account2 })
                await assetRouter.depositLP(pool, balance2, account2, { from: account2 })

                const TOKEN = await IERC20.at('0xFa94348467f64D5A457F75F8bc40495D33c65aBB')
                feeCollectorBalanceBefore = await TOKEN.balanceOf(feeCollector)

                await time.increase(5000000)
                receipt = await assetRouter.distribute(
                    pool,
                    [
                        {
                            route: [
                                '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802',
                                '0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB',
                                '0x4988a896b1227218e4A686fdE5EabdcAbd91571f'
                            ],
                            amountOutMin: 0
                        },
                        {
                            route: [
                                '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802'
                            ],
                            amountOutMin: 0
                        },
                        {
                            route: [],
                            amountOutMin: 0
                        },
                        {
                            route: [],
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
                const { stakeLP: stake1 } = await assetRouter.userStake(account1, pool)
                assert.isAbove(stake1.toNumber(), balance1.toNumber(), 'Stake1 not increased')

                const { stakeLP: stake2 } = await assetRouter.userStake(account2, pool)
                assert.isAbove(stake2.toNumber(), balance2.toNumber(), 'Stake2 not increased')
            })
            it('collects fees', async () => {
                const TOKEN = await IERC20.at('0xFa94348467f64D5A457F75F8bc40495D33c65aBB')
                const feeCollectorBalanceAfter = await TOKEN.balanceOf(feeCollector)
                assert.ok(feeCollectorBalanceAfter.gt(feeCollectorBalanceBefore), 'Fee collector balance not increased')
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
                                    '0x4988a896b1227218e4A686fdE5EabdcAbd91571f'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            }
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
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    '0x4988a896b1227218e4A686fdE5EabdcAbd91571f'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    constants.ZERO_ADDRESS,
                                    '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_B_ROUTE'
                )
            })
            it('reverts if passed wrong tokenA', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    constants.ZERO_ADDRESS
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            }
                        ],
                        feeCollector,
                        { from: distributor }
                    ),
                    'BAD_REWARD_TOKEN_A_ROUTE'
                )
            })
            it('reverts if passed wrong tokenB', async () => {
                await expectRevertCustomError(
                    assetRouter.distribute(
                        pool,
                        [
                            {
                                route: [
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    '0x4988a896b1227218e4A686fdE5EabdcAbd91571f'
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [
                                    '0xFa94348467f64D5A457F75F8bc40495D33c65aBB',
                                    constants.ZERO_ADDRESS
                                ],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            },
                            {
                                route: [],
                                amountOutMin: 0
                            }
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
                await assetRouter.withdrawLP(pool, stakeLP, account1, { from: account1 });

                ({ stakeLP } = await assetRouter.userStake(account1, pool))
                assert.equal(stakeLP.toString(), '0', 'acount1 stake not 0')
            })
            it('withdraws tokens for account2', async () => {
                let { stakeLP } = await assetRouter.userStake(account2, pool)
                await assetRouter.withdrawLP(pool, stakeLP, account2, { from: account2 });

                ({ stakeLP } = await assetRouter.userStake(account2, pool))
                assert.equal(stakeLP.toString(), '0', 'acount2 stake not 0')
            })
            it('not leaves any tokens', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(totalDepositsLP.toString(), '0', 'totalDeposits not 0')
            })
        })
    })
    describe('ETH deposit and withdraw', () => {
        describe('deposit ETH', () => {
            let stakeABefore
            let stakeBBefore

            let amountETH
            let amountToken
            let tokenAAddress
            let tokenBAddress
            let token
            let tokenBalanceBefore
            let ethBalanceBefore

            let receipt
            before(async () => {
                amountETH = new BN(40000000)
                amountToken = new BN(4000000000);
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool3))

                ethPooltokenA = await IERC20.at(tokenAAddress)
                ethPooltokenB = await IERC20.at(tokenBAddress);// ETH

                ({
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(account3, pool3))

                if (tokenAAddress.toLowerCase() === '0xc9bdeed33cd01541e1eed10f90519d2c06fe3feb') {
                    await ethPooltokenB.approve(assetRouter.address, amountToken, { from: account3 })
                    token = ethPooltokenB
                    tokenBalanceBefore = await token.balanceOf(account3)
                } else {
                    await ethPooltokenA.approve(assetRouter.address, amountToken, { from: account3 })
                    token = ethPooltokenA
                    tokenBalanceBefore = await token.balanceOf(account3)
                }

                ethBalanceBefore = new BN(await web3.eth.getBalance(account3))
                receipt = await assetRouter.depositETH(pool3, amountToken, 0, 0, account3, {
                    from: account3,
                    value: amountETH
                })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', { lpPool: pool3, sender: account3, recipient: account3 })
            })
            it('withdraws tokens and ETH from balance', async () => {
                const { stakeA: stakeAAfter, stakeB: stakeBAfter } = await assetRouter.userStake(account3, pool3)
                const tokenBalanceAfter = await token.balanceOf(account3)
                const ethBalanceAfter = new BN(await web3.eth.getBalance(account3))

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)
                const ETHDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(gasUsed.mul(effectiveGasPrice))
                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)

                let tokenStakeDiff
                let ETHStakeDiff

                if (tokenAAddress.toLowerCase() === '0xc9bdeed33cd01541e1eed10f90519d2c06fe3feb') {
                    tokenStakeDiff = stakeBAfter.sub(stakeBBefore)
                    ETHStakeDiff = stakeAAfter.sub(stakeABefore)
                } else {
                    tokenStakeDiff = stakeAAfter.sub(stakeABefore)
                    ETHStakeDiff = stakeBAfter.sub(stakeBBefore)
                }

                approxeq(tokenDiff, tokenStakeDiff, new BN(10), 'Token Stake is not correct')
                approxeq(ETHDiff, ETHStakeDiff, new BN(10), 'ETH Stake is not correct')
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(account3, pool3)
                assert.ok(stakeLP.gt(new BN('0')), 'Stake not increased')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool3)
                assert.ok(totalDepositsLP.gt(new BN('0')), 'Stake not increased')
            })
        })
        describe('withdraw ETH', () => {
            let stakeABefore
            let stakeBBefore
            let stakeLPBefore

            let tokenAAddress
            let tokenBAddress
            let token
            let tokenBalanceBefore
            let totalDepositsLPBefore
            let ethBalanceBefore

            let receipt

            before(async () => {
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool3))

                ethPooltokenA = await IERC20.at(tokenAAddress)
                ethPooltokenB = await IERC20.at(tokenBAddress);
                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool3));
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(account3, pool3))

                if (tokenAAddress.toLowerCase() === '0xc9bdeed33cd01541e1eed10f90519d2c06fe3feb') {
                    token = ethPooltokenB
                    tokenBalanceBefore = await token.balanceOf(account3)
                } else {
                    token = ethPooltokenA
                    tokenBalanceBefore = await token.balanceOf(account3)
                }

                ethBalanceBefore = new BN(await web3.eth.getBalance(account3))

                receipt = await assetRouter.withdrawETH(pool3, stakeLPBefore, 0, 0, account3, {
                    from: account3
                })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', { lpPool: pool3, sender: account3, recipient: account3 })
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(account3, pool3)
                assert.equal(stakeLP.toString(), '0', 'Stake not reduced')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool3)
                assert.equal((totalDepositsLPBefore.sub(stakeLPBefore)).toString(), totalDepositsLP, 'totalDeposits not reduced')
            })
            it('adds tokens and ETH to balance', async () => {
                const { stakeA: stakeAAfter, stakeB: stakeBAfter } = await assetRouter.userStake(account3, pool3)
                const tokenBalanceAfter = await token.balanceOf(account3)
                const ethBalanceAfter = new BN(await web3.eth.getBalance(account3))

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                const ETHDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(gasUsed.mul(effectiveGasPrice))
                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)

                let tokenStakeDiff
                let ETHStakeDiff

                if (tokenAAddress.toLowerCase() === '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270') {
                    tokenStakeDiff = stakeBAfter.sub(stakeBBefore)
                    ETHStakeDiff = stakeAAfter.sub(stakeABefore)
                } else {
                    tokenStakeDiff = stakeAAfter.sub(stakeABefore)
                    ETHStakeDiff = stakeBAfter.sub(stakeBBefore)
                }

                approxeq(tokenDiff, tokenStakeDiff, new BN(10), 'Token Stake is not correct')
                approxeq(ETHDiff, ETHStakeDiff, new BN(10), 'ETH Stake is not correct')
            })
        })
    })
    describe('Upgradeability', () => {
        describe('updates', () => {
            const receipt = {}
            before(async () => {
                const instance = await upgradeProxy(assetRouter.address, AssetRouterV2)
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
