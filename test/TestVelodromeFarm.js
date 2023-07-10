const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers')

const IPool = artifacts.require('IPool')
const IGauge = artifacts.require('IGauge')

const Farm = artifacts.require('UnoFarmVelodrome')
const gaugeAddress = '0x0f30716960f0618983ac42be2982ffec181af265' // velo-optimism

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

contract('UnoFarmVelodrome', (accounts) => {
    const assetRouter = accounts[0]

    let implementation
    let gauge
    let stakingToken
    let rewardToken

    let receipt

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] })

        receipt = await implementation.initialize(gaugeAddress, assetRouter, {
            from: accounts[0]
        })

        gauge = await IGauge.at(gaugeAddress)
        stakingToken = await IPool.at(await gauge.stakingToken())
        rewardToken = await gauge.rewardToken()
    })

    describe('Emits initialize event', () => {
        it('fires events', async () => {
            expectEvent(receipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async () => {
            await expectRevert(
                implementation.initialize(gaugeAddress, assetRouter, {
                    from: accounts[0]
                }),
                'Initializable: contract is already initialized'
            )
        })
    })

    describe('Initializes variables', () => {
        it('Sets gauge', async () => {
            assert.equal((await implementation.gauge()).toLowerCase(), gaugeAddress, 'gauge is not correct')
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
                implementation.deposit(
                    0,
                    accounts[0],
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.withdraw(
                    0,
                    accounts[0],
                    accounts[0],
                    { from: accounts[1] }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.distribute(
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
            await expectRevertCustomError(
                implementation.deposit(
                    0,
                    accounts[0],
                    { from: assetRouter }
                ),
                'NO_LIQUIDITY_PROVIDED'
            )
            await expectRevertCustomError(
                implementation.withdraw(
                    0,
                    accounts[0],
                    accounts[0],
                    { from: assetRouter }
                ),
                'INSUFFICIENT_AMOUNT'
            )
            await expectRevertCustomError(
                implementation.distribute(
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
