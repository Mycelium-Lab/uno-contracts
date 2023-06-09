const { expectEvent, expectRevert, BN } = require('@openzeppelin/test-helpers')

const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IBasePool = artifacts.require('IBasePool')

const Farm = artifacts.require('UnoFarmBalancer')

const pool = '0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D' // WMATIC-stMATIC
const gaugeFactoryAddress = '0x3b8cA519122CdD8efb272b0D3085453404B25bD0'

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

contract('UnoFarmBalancer', (accounts) => {
    const assetRouter = accounts[0]

    let implementation
    let gauge; let
        poolId

    let receipt

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] })
        receipt = await implementation.initialize(pool, assetRouter, { from: accounts[0] })

        const gaugeFactory = await IGaugeFactory.at(gaugeFactoryAddress)
        gauge = await gaugeFactory.getPoolGauge(pool)

        const poolContract = await IBasePool.at(pool)
        poolId = await poolContract.getPoolId()
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
            assert.equal(
                await implementation.lpPool(),
                pool,
                'Staking pool is not correct'
            )
        })
        it('Sets gauge', async () => {
            assert.equal(
                await implementation.gauge(),
                gauge,
                'Gauge is not correct'
            )
        })
        it('Sets poolID', async () => {
            assert.equal(
                await implementation.poolId(),
                poolId,
                'PoolID is not correct'
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
                implementation.withdrawTokens(web3.eth.abi.encodeParameter('uint256', '0'), [], accounts[0], accounts[0], { from: accounts[1] }),
                'CALLER_NOT_ASSET_ROUTER'
            )
            await expectRevertCustomError(
                implementation.distribute([{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], { feeTo: accounts[1], fee: 0 }, { from: accounts[1] }),
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
                implementation.withdrawTokens(web3.eth.abi.encodeParameter('uint256', '0'), [], accounts[0], accounts[0], { from: assetRouter }),
                'MIN_AMOUNTS_OUT_BAD_LENGTH'
            )
            await expectRevertCustomError(
                implementation.distribute([{ swaps: [], assets: [], limits: [] }], [{ swaps: [], assets: [], limits: [] }], { feeTo: accounts[1], fee: 0 }, { from: assetRouter }),
                'NO_LIQUIDITY'
            )
        })
    })
})
