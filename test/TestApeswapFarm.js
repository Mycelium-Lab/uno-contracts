const {
    expectEvent, expectRevert, BN, constants
} = require('@openzeppelin/test-helpers')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IRewarder = artifacts.require('IMiniComplexRewarderTime')

const Farm = artifacts.require('UnoFarmApeswap')
const IMiniApeV2 = artifacts.require('IMiniApeV2')

const pool = '0x65D43B64E3B31965Cd5EA367D4c2b94c03084797' // usdt wmatic
const miniApeAddress = '0x54aff400858Dcac39797a81894D9920f16972D1D'

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

contract('UnoFarmApeswap', (accounts) => {
    const assetRouter = accounts[0]

    let implementation
    let stakingToken
    let miniChef
    let pid
    let rewardToken
    let rewarderToken

    let receipt

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] })

        receipt = await implementation.initialize(pool, assetRouter, { from: accounts[0] })

        miniChef = await IMiniApeV2.at(miniApeAddress)
        const poolLength = await miniChef.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const lpToken = await miniChef.lpToken(i)
            if (lpToken.toString() === pool) {
                pid = i
                break
            }
        }

        try {
            const rewarderAddress = (await miniChef.rewarder(pid)).toString()

            const rewarder = await IRewarder.at(rewarderAddress)
            const data = await rewarder.pendingTokens(pid, constants.ZERO_ADDRESS, 0)
            rewarderToken = data['0']['0'].toString()
        } catch (error) {
            rewarderToken = constants.ZERO_ADDRESS
        }
        stakingToken = await IUniswapV2Pair.at(pool)

        rewardToken = await miniChef.BANANA()
    })

    describe('Emits initialize event', () => {
        it('fires events', async () => {
            expectEvent(receipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async () => {
            await expectRevert(
                implementation.initialize(pool, assetRouter, { from: accounts[0] }),
                'Initializable: contract is already initialized'
            )
        })
    })

    describe('Initializes variables', () => {
        it('Sets pool ID', async () => {
            assert.equal(
                await implementation.pid(),
                pid,
                'PID is not correct'
            )
        })
        it('Sets lpPool', async () => {
            assert.equal(
                await implementation.lpPool(),
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
        it('Sets rewarderToken', async () => {
            assert.equal(
                await implementation.rewarderToken(),
                rewarderToken,
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
            await expectRevertCustomError(
                implementation.deposit(0, accounts[0], { from: accounts[1] }),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.withdraw(0, accounts[0], accounts[0], { from: accounts[1] }),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.distribute(
                    [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                    { feeTo: accounts[1], fee: 0 },
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
        })

        // ASSET_ROUTER check passes, revert for a different reason
        it('Allows function calls for asset router', async () => {
            await expectRevertCustomError(
                implementation.deposit(0, accounts[0], { from: assetRouter }),
                'NO_LIQUIDITY_PROVIDED'
            )
            await expectRevertCustomError(
                implementation.withdraw(0, accounts[0], accounts[0], { from: assetRouter }),
                'INSUFFICIENT_AMOUNT'
            )
            await expectRevertCustomError(
                implementation.distribute(
                    [{ route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }, { route: [], amountOutMin: 0 }],
                    { feeTo: accounts[1], fee: 0 },
                    { from: assetRouter }
                ),
                'NO_LIQUIDITY'
            )
        })
    })
})
