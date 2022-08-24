const { expectEvent, expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IRewarder = artifacts.require("IRewarder")

const Farm = artifacts.require('UnoFarmSushiswap')
const IMiniChefV2 = artifacts.require('IMiniChefV2')

const pool = "0x4B1F1e2435A9C96f7330FAea190Ef6A7C8D70001" //usdt usdc 
const miniChefAddress = "0x0769fd68dFb93167989C6f7254cd0D766Fb2841F"

contract('UnoFarmSushiswap', accounts => {
    let assetRouter = accounts[0]

    let implementation
    let stakingToken
    let miniChef
    let pid
    let rewardToken
    let rewarderToken

    let receipt

    before(async () => {
        implementation = await Farm.new({from: accounts[0]})

        receipt = await implementation.initialize(pool, assetRouter, {from: accounts[0]})

        miniChef = await IMiniChefV2.at(miniChefAddress)
        const poolLength = await miniChef.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const lpToken = await miniChef.lpToken(i);
            if (lpToken.toString() === pool) {
                pid = i;
                break;
            }
        }

        try {
            const rewarderAddress = (await miniChef.rewarder(pid)).toString();

            const rewarder = await IRewarder.at(rewarderAddress);
            const data = await rewarder.pendingTokens(pid, constants.ZERO_ADDRESS, 0);
            rewarderToken = data["0"]["0"].toString();

        } catch (error) {
            rewarderToken = constants.ZERO_ADDRESS;
        }
        stakingToken = await IUniswapV2Pair.at(pool)

        rewardToken = await miniChef.SUSHI()
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
        it('Sets pool ID', async()=>{
            assert.equal(
                await implementation.pid(),
                pid,
                "PID is not correct"
            )
        })
        it('Sets lpPair', async()=>{
            assert.equal(
                await implementation.lpPair(),
                stakingToken.address,
                "Staking token is not correct"
            )
        })
        it('Sets rewardToken', async () => {
            assert.equal(
                await implementation.rewardToken(),
                rewardToken,
                "Reward token is not correct"
            )
        })
        it('Sets rewarderToken', async () => {
            assert.equal(
                await implementation.rewarderToken(),
                rewarderToken,
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