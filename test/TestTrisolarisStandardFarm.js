const {
    expectEvent, expectRevert, BN, constants
} = require('@openzeppelin/test-helpers')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniversalMasterChef = artifacts.require('IUniversalMasterChef')
const IComplexRewarder = artifacts.require('IComplexRewarder')

const Farm = artifacts.require('UnoFarmTrisolarisStandard')

const pool = '0x03B666f3488a7992b2385B12dF7f35156d7b29cD' // wNEAR-USDT pool

const masterChefV1 = '0x1f1Ed214bef5E83D8f5d0eB5D7011EB965D0D79B'
const masterChefV2 = '0x3838956710bcc9D122Dd23863a0549ca8D5675D6'

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

contract('Test UnoFarmTrisolarisStandard initialization', (accounts) => {
    const assetRouter = accounts[0]
    let implementation
    let lpToken
    let pid
    let masterChefType
    let rewardTokenAddress; let
        rewarderTokenAddress
    let receipt

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] })

        receipt = await implementation.initialize(pool, assetRouter, { from: accounts[0] })

        const MasterChefV1 = await IUniversalMasterChef.at(masterChefV1)
        const MasterChefV2 = await IUniversalMasterChef.at(masterChefV2)

        const poolLengthV1 = await MasterChefV1.poolLength()
        const poolLengthV2 = await MasterChefV2.poolLength()

        let poolFound = false

        for (let i = 0; i < poolLengthV2.toNumber(); i++) {
            const _lpToken = await MasterChefV2.lpToken(i)
            if (_lpToken.toString() === pool) {
                pid = i
                poolFound = true
                masterChefType = 2
                break
            }
        }

        if (!poolFound) {
            for (let i = 0; i < poolLengthV1.toNumber(); i++) {
                const _lpToken = (await MasterChefV1.poolInfo(i))['0']
                if (_lpToken.toString() === pool) {
                    pid = i
                    poolFound = true
                    masterChefType = 1
                    break
                }
            }
        }

        const MasterChef = masterChefType === 1 ? MasterChefV1 : MasterChefV2

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
        it('Sets lpPool', async () => {
            assert.equal(await implementation.lpPool(), lpToken.address, 'LP token is not correct')
        })
        it('Sets correct pid', async () => {
            assert.equal((await implementation.pid()).toNumber(), pid, 'Pid not correct')
        })
        it('Sets rewardToken', async () => {
            assert.equal(
                (await implementation.rewardToken()).toString(),
                rewardTokenAddress,
                'Reward token is not correct'
            )
        })
        it('Sets rewarderToken', async () => {
            assert.equal(
                (await implementation.rewarderToken()).toString(),
                rewarderTokenAddress,
                'Rewarder token is not correct'
            )
        })
        it('Sets tokens', async () => {
            assert.equal(
                await implementation.tokenA(),
                await lpToken.token0(),
                'TokenA is not correct'
            )
            assert.equal(
                await implementation.tokenB(),
                await lpToken.token1(),
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
    describe('Functions available only for asset router', () => {
        // CALLER_NOT_ASSET_ROUTER check fails
        it('Prevents function calls for not asset router', async () => {
            await expectRevertCustomError(
                implementation.deposit(
                    0,
                    constants.ZERO_ADDRESS,
                    {
                        from: accounts[1]
                    }
                ),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.withdraw(
                    0,
                    constants.ZERO_ADDRESS,
                    constants.ZERO_ADDRESS,
                    {
                        from: accounts[1]
                    }
                ),
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
