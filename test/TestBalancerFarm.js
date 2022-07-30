const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers')
const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IBasePool = artifacts.require('IBasePool')

const Farm = artifacts.require('UnoFarmBalancer')

const pool = "0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D" //WMATIC-stMATIC
const gaugeFactoryAddress = "0x3b8cA519122CdD8efb272b0D3085453404B25bD0"

contract('UnoFarmBalancer', accounts => {
    let assetRouter = accounts[0]

    let implementation
    let gauge, poolId

    let receipt

    before(async () => {
        implementation = await Farm.new({from: accounts[0]})
        receipt = await implementation.initialize(pool, assetRouter, {from: accounts[0]})

        const gaugeFactory = await IGaugeFactory.at(gaugeFactoryAddress)
        gauge = await gaugeFactory.getPoolGauge(pool)

        const poolContract = await IBasePool.at(pool)
        poolId = await poolContract.getPoolId()

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
        it('Sets lpPool', async()=>{
            assert.equal(
                await implementation.lpPool(),
                pool,
                "Staking pool is not correct"
            )
        })
        it('Sets gauge', async () => {
            assert.equal(
                await implementation.gauge(),
                gauge,
                "Gauge is not correct"
            )
        })
        it('Sets poolID', async()=>{
            assert.equal(
                await implementation.poolId(),
                poolId,
                "PoolID is not correct"
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
                implementation.deposit([], [], 0, 0, accounts[0], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
            await expectRevert(
                implementation.withdraw(0, [], false, accounts[0], accounts[0], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
            await expectRevert(
                implementation.distribute([], [], [], {from: accounts[1]}),
                "CALLER_NOT_ASSET_ROUTER"
            )
        })

        //ASSET_ROUTER check passes, revert for a different reason
        it('Allows function calls for asset router', async()=>{
            await expectRevert(
                implementation.deposit([], [], 0, 0, accounts[0], {from: assetRouter}),
                "BAD_AMOUNTS_LENGTH"
            )
            await expectRevert(
                implementation.withdraw(0, [], false, accounts[0], accounts[0], {from: assetRouter}),
                "INSUFFICIENT_AMOUNT"
            )
            await expectRevert(
                implementation.distribute([], [], [], {from: assetRouter}),
                "NO_LIQUIDITY"
            )
        })
    })
})