const {
    expectRevert, expectEvent, BN, constants, time
} = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IGauge = artifacts.require('IGauge')
const IBasePool = artifacts.require('IBasePool')
const IVault = artifacts.require('IVault')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmBalancer')
const AssetRouter = artifacts.require('UnoAssetRouterBalancer')
const AssetRouterV2 = artifacts.require('UnoAssetRouterBalancerV2')

const balancerVault = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
const gaugeFactoryAddress = '0x3b8cA519122CdD8efb272b0D3085453404B25bD0'

const pool = '0x8159462d255C1D24915CB51ec361F700174cD994' // WMATIC-stMATIC
const pool2 = '0x06Df3b2bbB68adc8B0e302443692037ED9f91b42' // USDC-DAI-miMATIC-USDT

const account1 = '0xD994932A46F1f2b456624327E8807455B7644b9d'// has to be unlocked and hold 0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D
const account2 = '0xb73FbaFce92dFe47DA875D2fDc0a699BeB1DA1eF'// has to be unlocked and hold 0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D
const account3 = '0x48A0CCaC57a3760e985Fdd2E3B11e69C7FC6e42F' // has to be unlocked and hold 0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4 (stMATIC)

const account4 = '0xFffbCD322cEace527C8ec6Da8de2461C6D9d4e6e' // has to be unlocked and hold 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270 (WMATIC)
const account5 = '0x765C6d09EF9223B1BECD3b92a0eC01548D53CFba' // has to be unlocked and hold 0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C4 (stMATIC)

const amounts = [new BN(1000000), new BN(3000000), new BN(500000), new BN(400000000)]

const feeCollector = '0xFFFf795B802CB03FD664092Ab169f5f5c236335c'
const fee = new BN('40000000000000000')// 4%

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterBalancer', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager; let assetRouter; let
        factory

    let stakingToken

    const initReceipt = {}

    let poolId; let
        gauge

    let Vault
    let tokens; let
        zeroAmounts

    const tokenContracts = []

    before(async () => {
        const implementation = await Farm.new({ from: account1 })
        accessManager = await AccessManager.new({ from: admin })// accounts[0] is admin

        await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor, { from: admin }) // DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, { from: admin }) // PAUSER_ROLE

        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: account1 })

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash)
        const events = await assetRouter.getPastEvents('AllEvents', {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })

        // convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        const gaugeFactory = await IGaugeFactory.at(gaugeFactoryAddress)
        const gaugeAddress = await gaugeFactory.getPoolGauge(pool)
        gauge = await IUniswapV2Pair.at(gaugeAddress) // this is not a IUniswapV2Pair, however the abi is sufficient for our purposes

        const poolContract = await IBasePool.at(pool)
        poolId = await poolContract.getPoolId()

        stakingToken = await IUniswapV2Pair.at(pool) // this is not a IUniswapV2Pair, however the abi is sufficient for our purposes
        Vault = await IVault.at(balancerVault)

        tokens = (await Vault.getPoolTokens(poolId)).tokens
        zeroAmounts = new Array(tokens.length).fill(0)

        for (let i = 0; i < tokens.length; i++) {
            tokenContracts.push(await IUniswapV2Pair.at(tokens[i])) // should be ERC20 but IUniswapV2Pair has everything we need
        }
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
    })

    describe('getTokens', () => {
        let _tokens
        before(async () => {
            _tokens = await assetRouter.getTokens(pool)
        })
        it('getTokens is correct', async () => {
            for (let i = 0; i < _tokens.length; i++) {
                assert.equal(
                    _tokens[i],
                    tokens[i],
                    'getTokens returned incorrect tokens'
                )
            }
        })
    })

    describe('Pausable', () => {
        describe('reverts', () => {
            it('reverts if called not by a pauser', async () => {
                await expectRevert(
                    assetRouter.pause({ from: account1 }),
                    'CALLER_NOT_AUTHORIZED'
                )
                await expectRevert(
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
                assert.equal(
                    await assetRouter.paused(),
                    true,
                    'Not paused'
                )
            })
            it('prevents function calls', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, [], [], 0, account1, { from: account1 }),
                    'Pausable: paused'
                )
                await expectRevert(
                    assetRouter.distribute(pool, [{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], feeCollector, { from: account1 }),
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
                assert.equal(
                    await assetRouter.paused(),
                    false,
                    'Paused'
                )
            })
            it('allows function calls', async () => {
                // Pausable: paused check passes. revert for a different reason
                await expectRevert(
                    assetRouter.deposit(pool, [], [], 0, account1, { from: account1 }),
                    'BAD_TOKENS_LENGTH'
                )
                await expectRevert(
                    assetRouter.distribute(pool, [{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], feeCollector, { from: account1 }),
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

    describe('Deposits', () => {
        let farm
        describe('reverts', () => {
            it('reverts if total amount provided is zero', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, zeroAmounts, tokens, 0, account1, { from: account1 }),
                    'NO_LIQUIDITY_PROVIDED'
                )
            })
        })
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[0], account1, { from: account1 })

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
            it('sets isComposable', async () => {
                const isComposable = await farm.isComposable()
                assert.equal(isComposable, true, 'Is not composable')
            })
            it('updates stakes', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(stakeLP.toString(), amounts[0].toString(), "Amount sent doesn't equal userStake")
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[1], account1, { from: account1 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(stakeLP.toString(), amounts[0].add(amounts[1]).toString(), "Amount sent doesn't equal userStake")
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], { from: account2 })
                receipt = await assetRouter.depositLP(pool, amounts[2], account2, { from: account2 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    'Amount sent changed userStake for account1'
                )
            })
            it('updates stakes for account[1]', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(stakeLP.toString(), amounts[2].toString(), "Amount sent doesn't equal userStake")
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    await gauge.balanceOf(farm.address),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], { from: account1 })
                receipt = await assetRouter.depositLP(pool, amounts[3], account2, { from: account1 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    'stakeLP is not 0'
                )
            })
            it('updates stakes for account2', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(stakeLP.toString(), amounts[2].add(amounts[3]).toString(), "Amount sent doesn't equal userStake")
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            const balancesBefore = []

            before(async () => {
                await tokenContracts[0].transfer(account1, await tokenContracts[0].balanceOf(account4), { from: account4 }) // wmatic
                await tokenContracts[1].transfer(account1, await tokenContracts[1].balanceOf(account5), { from: account5 }) // stmatic

                for (let i = 0; i < tokenContracts.length; i++) {
                    let balance = 0
                    if (tokenContracts[i].address !== stakingToken.address) {
                        balance = await tokenContracts[i].balanceOf(account1)
                        await tokenContracts[i].approve(assetRouter.address, balance, { from: account1 })
                    }
                    balancesBefore.push(balance.toString())
                }
            })
            it('reverts if minAmountLP is more than received amount', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, balancesBefore, tokens, constants.MAX_UINT256, account1, { from: account1 }),
                    'BAL#208'
                )
            })
            it('fires events', async () => {
                const receipt = await assetRouter.deposit(pool, balancesBefore, tokens, 0, account1, { from: account1 })
                expectEvent(receipt, 'Deposit', { lpPool: pool, sender: account1, recipient: account1 })
            })
            it('withdraws tokens from balance', async () => {
                for (let i = 0; i < tokenContracts.length; i++) {
                    if (tokenContracts[i].address !== stakingToken.address) {
                        balanceAfter = await tokenContracts[i].balanceOf(account1)
                        assert.equal(balanceAfter, '0', 'Token not withdrawn')
                    }
                }
            })

            let addedStake
            it('updates stakes', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.ok(stakeLP.gt(amounts[0].add(amounts[1])), 'LP stake not increased')
                addedStake = stakeLP.sub(amounts[0].add(amounts[1]))
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(addedStake))
                        .toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                const stakingRewardBalance = await gauge.balanceOf(farm.address)
                assert.equal(
                    stakingRewardBalance.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(addedStake))
                        .toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
    })
    describe('withdraw', () => {
        describe('reverts', () => {
            it('reverts if the pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool2, web3.eth.abi.encodeParameter('uint256', 1), zeroAmounts, true, account1, { from: account1 }),
                    'FARM_NOT_EXISTS'
                )
            })
            it('reverts if the stake is zero', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', 1), zeroAmounts, true, admin, { from: admin }),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', constants.MAX_UINT256), zeroAmounts, true, account1, { from: account1 }),
                    'INSUFFICIENT_BALANCE'
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', 0), zeroAmounts, true, account1, { from: account1 }),
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
                balance2before = await stakingToken.balanceOf(account2)

                stake1before = await assetRouter.userStake(account1, pool)
                stake2before = await assetRouter.userStake(account2, pool)

                receipt1 = await assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', amounts[0]), zeroAmounts, true, account1, { from: account1 })
                receipt2 = await assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', amounts[2]), zeroAmounts, true, account2, { from: account2 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    'Stake is not zero for account1'
                )
            })
            it('correctly updates userStake for account2', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    'Stake is not right for account2'
                )
            })
            it('correctly updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
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
                balance2before = await stakingToken.balanceOf(account2)

                stake1before = await assetRouter.userStake(account1, pool)
                stake2before = await assetRouter.userStake(account2, pool)

                receipt = await assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', amounts[1]), zeroAmounts, true, account2, { from: account1 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (stake1before.sub(amounts[1])).toString(),
                    'Stake is not right for account1'
                )
            })
            it('doesnt change stake for account2', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.toString(),
                    'Stake is not right for account2'
                )
            })
            it('transfers tokens to account2', async () => {
                const balance1after = await stakingToken.balanceOf(account1)
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
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
            const balancesBefore = []
            let stakeLP2; let
                stakeLP1

            let receipt
            before(async () => {
                for (let i = 0; i < tokenContracts.length; i++) {
                    balancesBefore.push(await tokenContracts[i].balanceOf(account1))
                }

                stakeLP1 = await assetRouter.userStake(account1, pool)
                stakeLP2 = await assetRouter.userStake(account2, pool)

                // single token exit
                const userData = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], ['0', stakeLP1.toString(), '0'])
                receipt = await assetRouter.withdraw(pool, userData, zeroAmounts, false, account1, { from: account1 })
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
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    'stakeLP is wrong'
                )
            })
            it('doesnt update account2 stake', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stakeLP2,
                    'stakeLP is wrong'
                )
            })
            it('transfers tokens to user', async () => {
                const balance0After = await tokenContracts[0].balanceOf(account1)
                const delta0 = balance0After.sub(balancesBefore[0])
                assert.ok(delta0.gt('0'), 'Token0 balance not increased')

                const balance1After = await tokenContracts[1].balanceOf(account1)
                const delta1 = balance1After.sub(balancesBefore[1])
                assert.equal(delta1.toString(), '0', 'Token1 balance changed')
            })
        })
        describe('withdraws normal tokens for a different user', () => {
            const balancesBefore = []
            let stakeLP1; let
                stakeLP2
            let delta1; let delta2

            let receipt
            const tokenAmounts = ['100000000', '100000000']

            before(async () => {
                for (let i = 0; i < tokenContracts.length; i++) {
                    balancesBefore.push(await tokenContracts[i].balanceOf(account1))
                }

                stakeLP1 = await assetRouter.userStake(account1, pool)
                stakeLP2 = await assetRouter.userStake(account2, pool)

                // exact tokens exit
                const userData = web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256'], ['1', tokenAmounts, stakeLP2.toString()])
                receipt = await assetRouter.withdraw(pool, userData, zeroAmounts, false, account1, { from: account2 })

                delta1 = stakeLP1.sub(await assetRouter.userStake(account1, pool))
                delta2 = stakeLP2.sub(await assetRouter.userStake(account2, pool))
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool,
                    sender: account2,
                    recipient: account1
                })
            })

            it('correctly updates account2 stake', async () => {
                assert.ok(
                    delta2.gt('0'),
                    'stakeLP is wrong'
                )
            })
            it('doesnt update account1 stake', async () => {
                assert.equal(
                    delta1.toString(),
                    '0',
                    'stakeLP is wrong'
                )
            })
            it('transfers tokens to correct user', async () => {
                let delta = (await tokenContracts[0].balanceOf(account1)).sub(balancesBefore[0])
                approxeq(
                    delta,
                    new BN(tokenAmounts[0]),
                    new BN(1),
                    'Token1 balance not increased'
                )

                delta = (await tokenContracts[1].balanceOf(account1)).sub(balancesBefore[1])
                approxeq(
                    delta,
                    new BN(tokenAmounts[1]),
                    new BN(1),
                    'Token2 balance not increased'
                )
            })
            after(async () => {
                const stake = await assetRouter.userStake(account2, pool)
                const userData = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], ['0', stake.toString(), '0'])
                await assetRouter.withdraw(pool, userData, zeroAmounts, false, account1, { from: account2 })
            })
        })
    })

    describe('Sets Fee', () => {
        describe('reverts', () => {
            it('reverts if called not by an admin', async () => {
                await expectRevert(
                    assetRouter.setFee(fee, { from: account1 }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if fee is greater than 100%', async () => {
                await expectRevert(
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
                await expectRevert(
                    assetRouter.distribute(pool, [{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], feeCollector, { from: pauser }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('reverts if pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.distribute(pool2, [{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], feeCollector, { from: distributor }),
                    'FARM_NOT_EXISTS'
                )
            })
            it('reverts if there is no liquidity in the pool', async () => {
                await expectRevert(
                    assetRouter.distribute(pool, [{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], feeCollector, { from: distributor }),
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

                await time.increase(5000)

                const farmAddress = await factory.Farms(pool)
                const gaugeContract = await IGauge.at(gauge.address) // this is not a IUniswapV2Pair, however the abi is sufficient for our purposes
                const rewardAmount = await gaugeContract.claimable_reward_write.call(farmAddress, '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3')
                const WMATIC = await IUniswapV2Pair.at('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270')
                feeCollectorBalanceBefore = await WMATIC.balanceOf(feeCollector)

                const reward = rewardAmount.mul(new BN(96)).div(new BN(100))
                const _fee = rewardAmount.mul(new BN(4)).div(new BN(100))

                receipt = await assetRouter.distribute(
                    pool,
                    [{
                        swaps: [{
                            poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: reward.toString(), userData: '0x'
                        }],
                        assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                        limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                    }],
                    [{
                        swaps: [{
                            poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: _fee.toString(), userData: '0x'
                        }],
                        assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                        limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                    }],
                    feeCollector,
                    { from: distributor }
                )
            })
            it('emits event', async () => {
                expectEvent(receipt, 'Distribute', { lpPool: pool })
            })
            it('increases token stakes', async () => {
                const stake1 = await assetRouter.userStake(account1, pool)
                assert.ok(stake1.gt(balance1), 'Stake1 not increased')

                const stake2 = await assetRouter.userStake(account2, pool)
                assert.ok(stake2.gt(balance2), 'Stake1 not increased')
            })
            it('collects fees', async () => {
                const WMATIC = await IUniswapV2Pair.at('0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270')
                const feeCollectorBalanceAfter = await WMATIC.balanceOf(feeCollector)
                assert.ok(feeCollectorBalanceAfter.gt(feeCollectorBalanceBefore), 'Fee collector balance not increased')
            })
        })

        describe('bad path reverts', () => {
            before(async () => {
                await time.increase(50000)
            })
            it('reverts if passed wrong number of params', async () => {
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [{
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        },
                        {
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        }],
                        [{
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        }],
                        feeCollector,
                        { from: distributor }
                    ),
                    'PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT'
                )
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [{
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        }],
                        [{
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        },
                        {
                            swaps: [{
                                poolId: '0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006', assetInIndex: 0, assetOutIndex: 1, amount: 0, userData: '0x'
                            }],
                            assets: ['0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3', '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'], // reward token to wmatic
                            limits: ['0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '0']
                        }],
                        feeCollector,
                        { from: distributor }
                    ),
                    'PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT'
                )
            })
        })
        describe('withdraws', () => {
            it('withdraws all tokens for account1', async () => {
                let stakeLP = await assetRouter.userStake(account1, pool)
                await assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', stakeLP), zeroAmounts, true, account1, { from: account1 })

                stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    'acount1 stake not 0'
                )
            })
            it('withdraws tokens for account2', async () => {
                let stakeLP = await assetRouter.userStake(account2, pool)
                await assetRouter.withdraw(pool, web3.eth.abi.encodeParameter('uint256', stakeLP), zeroAmounts, true, account2, { from: account2 })

                stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    'acount2 stake not 0'
                )
            })
            it('not leaves any tokens', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    '0',
                    'totalDeposits not 0'
                )
            })
        })
    })

    describe('deposit ETH', () => {
        const balancesBefore = []
        const tokensWithoutWMATIC = []
        const _amounts = []

        let ethBalanceBefore
        let ETHSpentOnGas
        let stakesBefore
        let totalDepositsLPBefore
        let stakingRewardBalanceBefore
        let receipt
        before(async () => {
            for (let i = 0; i < tokenContracts.length; i++) {
                if (tokenContracts[i].address !== '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' && tokenContracts[i].address !== stakingToken.address) {
                    tokensWithoutWMATIC.push(tokenContracts[i])
                    const balance = await tokenContracts[i].balanceOf(account3)

                    balancesBefore.push(balance)
                    await tokenContracts[i].approve(assetRouter.address, balance, { from: account3 })
                    _amounts.push(balance)
                } else {
                    _amounts.push(new BN(0))
                }
            }
            stakesBefore = await assetRouter.userStake(account3, pool)
            totalDepositsLPBefore = await assetRouter.totalDeposits(pool)

            const farmAddress = await factory.Farms(pool)
            stakingRewardBalanceBefore = await gauge.balanceOf(farmAddress)
            ethBalanceBefore = new BN(await web3.eth.getBalance(account3))

            receipt = await assetRouter.depositETH(pool, _amounts, tokens, 0, account3, {
                from: account3,
                value: new BN('10000000000000')
            })

            const gasUsed = new BN(receipt.receipt.gasUsed)
            const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)
            ETHSpentOnGas = gasUsed.mul(effectiveGasPrice)
        })
        it('fires events', async () => {
            expectEvent(receipt, 'Deposit', { lpPool: pool, sender: account3, recipient: account3 })
        })
        it('withdraws tokens from balance', async () => {
            for (let i = 0; i < tokensWithoutWMATIC.length; i++) {
                if (tokensWithoutWMATIC[i].address !== stakingToken.address) {
                    const balanceAfter = await tokensWithoutWMATIC[i].balanceOf(account3)
                    assert.ok(balancesBefore[i].sub(balanceAfter).gt('0'), 'Token not withdrawn')
                }
            }
        })
        it('withdraws ETH from balance', async () => {
            const ethBalanceAfter = new BN(await web3.eth.getBalance(account3))
            assert.ok(
                ethBalanceBefore.sub(ethBalanceAfter).sub(ETHSpentOnGas).gt(new BN('0')),
                'Amount ETH withdrawn is not correct'
            )
        })
        let addedStake
        it('updates stakes', async () => {
            const stakeLP = await assetRouter.userStake(account3, pool)
            assert.ok(stakeLP.gt(stakesBefore), 'LP stake not increased')
            addedStake = stakeLP.sub(stakesBefore)
        })
        it('updates totalDeposits', async () => {
            const totalDepositsLP = await assetRouter.totalDeposits(pool)
            assert.ok(totalDepositsLP.gt(totalDepositsLPBefore), 'totalDepositsLP not increased')
        })
        it('stakes tokens in Gauge contract', async () => {
            const farmAddress = await factory.Farms(pool)
            const farmETH = await Farm.at(farmAddress)
            const stakingRewardBalance = await gauge.balanceOf(farmETH.address)
            assert.equal(
                stakingRewardBalance.toString(),
                stakingRewardBalanceBefore.add(addedStake).toString(),
                "Total amount sent doesn't equal gauge balance"
            )
        })
    })
    describe('withdraw ETH', () => {
        const balancesBefore = []
        const tokensWithoutWMATIC = []
        const _amounts = []

        let ethBalanceBefore
        let ETHSpentOnGas
        let stakesBefore
        let totalDepositsLPBefore
        let stakingRewardBalanceBefore
        let receipt
        before(async () => {
            for (let i = 0; i < tokenContracts.length; i++) {
                if (tokenContracts[i].address !== '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' && tokenContracts[i].address !== stakingToken.address) {
                    tokensWithoutWMATIC.push(tokenContracts[i])
                    const balance = await tokenContracts[i].balanceOf(account3)
                    balancesBefore.push(balance)
                    _amounts.push(balance)
                } else {
                    _amounts.push(new BN(0))
                }
            }
            stakesBefore = await assetRouter.userStake(account3, pool)
            totalDepositsLPBefore = await assetRouter.totalDeposits(pool)

            const farmAddress = await factory.Farms(pool)
            stakingRewardBalanceBefore = await gauge.balanceOf(farmAddress)
            ethBalanceBefore = new BN(await web3.eth.getBalance(account3))

            const tokenAmounts = ['100000000', '100000000']
            const userData = web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256'], ['1', tokenAmounts, stakesBefore.toString()])
            // web3.eth.abi.encodeParameters(['uint256', 'uint256'], ['1', stakesBefore.toString()])
            receipt = await assetRouter.withdrawETH(pool, userData, zeroAmounts, account3, {
                from: account3
            })

            const gasUsed = new BN(receipt.receipt.gasUsed)
            const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)
            ETHSpentOnGas = gasUsed.mul(effectiveGasPrice)
        })
        it('fires events', async () => {
            expectEvent(receipt, 'Withdraw', { lpPool: pool, sender: account3, recipient: account3 })
        })
        it('tokens to balance', async () => {
            for (let i = 0; i < tokensWithoutWMATIC.length; i++) {
                if (tokensWithoutWMATIC[i].address !== stakingToken.address) {
                    const balanceAfter = await tokensWithoutWMATIC[i].balanceOf(account3)
                    assert.ok(balanceAfter.sub(balancesBefore[i]).gt('0'), 'Token not added')
                }
            }
        })
        it('adds ETH to balance', async () => {
            const ethBalanceAfter = new BN(await web3.eth.getBalance(account3))
            assert.ok(ethBalanceAfter.sub(ethBalanceBefore).add(ETHSpentOnGas).gt('0'), 'ETH not added')
        })
        let removedStake
        it('updates stakes', async () => {
            const stakeLP = await assetRouter.userStake(account3, pool)
            assert.ok(stakesBefore.gt(stakeLP), 'LP stake not reduced')
            removedStake = stakesBefore.sub(stakeLP)
        })
        it('updates totalDeposits', async () => {
            const totalDepositsLP = await assetRouter.totalDeposits(pool)
            assert.ok(totalDepositsLPBefore.gt(totalDepositsLP), 'totalDepositsLP not increased')
        })
        it('stakes tokens in Gauge contract', async () => {
            const farmAddress = await factory.Farms(pool)
            const farmETH = await Farm.at(farmAddress)
            const stakingRewardBalance = await gauge.balanceOf(farmETH.address)
            assert.equal(
                stakingRewardBalanceBefore.toString(),
                stakingRewardBalance.add(removedStake).toString(),
                "Total amount sent doesn't equal gauge balance"
            )
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
                    (new BN(2)).toString(),
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
})
