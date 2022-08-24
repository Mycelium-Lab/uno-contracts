const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers')
const IStakingDualRewards = artifacts.require('IStakingDualRewards')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const Farm = artifacts.require('UnoFarmQuickswapDual')

const pool = "0x14977e7E263FF79c4c3159F497D9551fbE769625" //WMATIC-USDC

contract('UnoFarmQuickswapDual', accounts => {
    let assetRouter = accounts[0]

    let implementation
    let stakingDualRewards, stakingToken

    let receipt

    before(async () => {
        implementation = await Farm.new({from: accounts[0]})

        receipt = await implementation.initialize(pool, assetRouter, {from: accounts[0]})

        stakingDualRewards = await IStakingDualRewards.at(pool)
        const stakingTokenAddress = await stakingDualRewards.stakingToken()
        stakingToken = await IUniswapV2Pair.at(stakingTokenAddress)
    })

    describe("Emits initialize event", () => {
        it('fires events', async () => {
            expectEvent(receipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async()=>{
            await expectRevert(
                implementation.initialize(pool, assetRouter, {from: accounts[0]}),
                "Initializable: contract is already initialized"
            )
        })
    })

    describe('Initializes variables', () => {
        it('Sets lpPair', async()=>{
            assert.equal(
                await implementation.lpPair(),
                stakingToken.address,
                "Staking token is not correct"
            )
        })
        it('Sets rewardTokens', async () => {
            assert.equal(
                await implementation.rewardTokenA(),
                await stakingDualRewards.rewardsTokenA(),
                "Reward token is not correct"
            )
            assert.equal(
                await implementation.rewardTokenB(),
                await stakingDualRewards.rewardsTokenB(),
                "Reward token is not correct"
            )
        })
        it('Sets tokens', async () => {
            assert.equal(
                await implementation.tokenA(),
                await stakingToken.token0(),
                "TokenA is not correct"
            )
            assert.equal(
                await implementation.tokenB(),
                await stakingToken.token1(),
                "TokenB is not correct"
            )
        })
        it('Sets assetRouter', async () => {
            assert.equal(
                await implementation.assetRouter(),
                assetRouter,
                "assetRouter is not correct"
            )
        })
    })

    describe('functions available only for asset router', () => {
        //CALLER_NOT_ASSET_ROUTER check fails
        it('Prevents function calls for not asset router', async()=>{
            await expectRevert(
                implementation.deposit(0, 0, 0, 0, 0, accounts[0], accounts[0], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
            await expectRevert(
                implementation.withdraw(0, 0, 0, false, accounts[0], accounts[0], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
            await expectRevert(
                implementation.distribute([[], [], [], []], [0, 0, 0, 0], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
        })

        //ASSET_ROUTER check passes, revert for a different reason
        it('Allows function calls for asset router', async()=>{
            await expectRevert(
                implementation.deposit(0, 0, 0, 0, 0, accounts[0], accounts[0], {from: assetRouter}),
                "NO_LIQUIDITY_PROVIDED"
            )
            await expectRevert(
                implementation.withdraw(0, 0, 0, false, accounts[0], accounts[0], {from: assetRouter}),
                "INSUFFICIENT_AMOUNT"
            )
            await expectRevert(
                implementation.distribute([[], [], [], []], [0, 0, 0, 0], {from: assetRouter}),
                "NO_LIQUIDITY"
            )
        })
    })
})