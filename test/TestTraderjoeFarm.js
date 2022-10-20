const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const Farm = artifacts.require('UnoFarmTraderjoe')
const IMasterTraderjoe = artifacts.require('IMasterChefJoe')

const pool = '0xf4003F4efBE8691B60249E6afbD307aBE7758adb' // wavax usdc
const masterTraderjoeAddress = '0x4483f0b6e2F5486D06958C20f8C39A7aBe87bf8F'

contract('UnoFarmTraderjoe', (accounts) => {
    const assetRouter = accounts[0]

    let implementation
    let stakingToken
    let masterTraderjoe
    let pid
    let rewardToken

    let receipt

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] })

        receipt = await implementation.initialize(pool, assetRouter, {
            from: accounts[0]
        })

        masterTraderjoe = await IMasterTraderjoe.at(masterTraderjoeAddress)
        const poolLength = await masterTraderjoe.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const lpToken = (await masterTraderjoe.poolInfo(i)).lpToken
            if (lpToken.toString() === pool) {
                pid = i
                break
            }
        }

        stakingToken = await IUniswapV2Pair.at(pool)
        rewardToken = await masterTraderjoe.JOE()
    })

    describe('Emits initialize event', () => {
        it('fires events', async () => {
            expectEvent(receipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async () => {
            await expectRevert(
                implementation.initialize(pool, assetRouter, {
                    from: accounts[0]
                }),
                'Initializable: contract is already initialized'
            )
        })
    })

    describe('Initializes variables', () => {
        it('Sets pool ID', async () => {
            assert.equal(await implementation.pid(), pid, 'PID is not correct')
        })
        it('Sets lpPair', async () => {
            assert.equal(
                await implementation.lpPair(),
                stakingToken.address,
                'Staking token is not correct'
            )
        })
        it('Sets rewardToken', async () => {
            assert.equal(
                await implementation.rewardToken(),
                rewardToken,
                'Reward token is not correct'
            )
        })
        it('Sets tokens', async () => {
            assert.equal(
                await implementation.tokenA(),
                await stakingToken.token0(),
                'TokenA is not correct'
            )
            assert.equal(
                await implementation.tokenB(),
                await stakingToken.token1(),
                'TokenB is not correct'
            )
        })
        it('Sets assetRouter', async () => {
            assert.equal(
                await implementation.assetRouter(),
                assetRouter,
                'assetRouter is not correct'
            )
        })
    })

    describe('functions available only for asset router', () => {
        // CALLER_NOT_ASSET_ROUTER check fails
        it('Prevents function calls for not asset router', async () => {
            await expectRevert(
                implementation.deposit(
                    0,
                    0,
                    0,
                    0,
                    0,
                    accounts[0],
                    accounts[0],
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevert(
                implementation.withdraw(
                    0,
                    0,
                    0,
                    false,
                    accounts[0],
                    accounts[0],
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevert(
                implementation.distribute(
                    [
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 }
                    ],
                    [
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 }
                    ],
                    { feeTo: accounts[1], fee: 0 },
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
        })

        // ASSET_ROUTER check passes, revert for a different reason
        it('Allows function calls for asset router', async () => {
            await expectRevert(
                implementation.deposit(
                    0,
                    0,
                    0,
                    0,
                    0,
                    accounts[0],
                    accounts[0],
                    { from: assetRouter }
                ),
                'NO_LIQUIDITY_PROVIDED'
            )
            await expectRevert(
                implementation.withdraw(
                    0,
                    0,
                    0,
                    false,
                    accounts[0],
                    accounts[0],
                    { from: assetRouter }
                ),
                'INSUFFICIENT_AMOUNT'
            )
            await expectRevert(
                implementation.distribute(
                    [
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 }
                    ],
                    [
                        { route: [], amountOutMin: 0 },
                        { route: [], amountOutMin: 0 }
                    ],
                    { feeTo: accounts[1], fee: 0 },
                    { from: assetRouter }
                ),
                'NO_LIQUIDITY'
            )
        })
    })
})
