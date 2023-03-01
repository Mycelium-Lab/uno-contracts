const {
    expectEvent, BN
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IERC20 = artifacts.require('IERC20')
const UnoAssetRouterSushiswap = artifacts.require('UnoAssetRouterSushiswap')
const UnoFarmSushiswap = artifacts.require('UnoFarmSushiswap')
const FarmFactory = artifacts.require('UnoFarmFactory')

const AccessManager = artifacts.require('UnoAccessManager')

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0x4B1F1e2435A9C96f7330FAea190Ef6A7C8D70001' // usdt usdc sushiswap
const pool2 = '0xc4e595acDD7d12feC385E5dA5D43160e8A0bAC0E' // wmatic-eth sushiswap

const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAutoStrategy', (accounts) => {
    const admin = accounts[0]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let strategyToken

    let assetRouterSushiswap
    before(async () => {
        accessManager = await AccessManager.new({ from: admin }) // accounts[0] is admin
        const autoStrategyImplementation = await AutoStrategy.new()
        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)

        assetRouterSushiswap = await deployProxy(
            UnoAssetRouterSushiswap,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationSushiswap = await UnoFarmSushiswap.new()
        await FarmFactory.new(farmImplementationSushiswap.address, accessManager.address, assetRouterSushiswap.address)

        await autoStrategyFactory.approveAssetRouter(assetRouterSushiswap.address, {
            from: admin
        })

        await autoStrategyFactory.createStrategy([
            { pool: pool1, assetRouter: assetRouterSushiswap.address },
            { pool: pool2, assetRouter: assetRouterSushiswap.address }
        ])

        autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))
        strategyToken = await IERC20.at(autoStrategy.address)
    })
    describe('Deposits Single', () => {
        describe('deposit token', () => {
            let id
            let receipt
            let stakeABefore
            let stakeBBefore
            let DAIToken
            let DAIAmount
            let tokenBalanceBefore

            before(async () => {
                id = await autoStrategy.poolID()

                DAIToken = await IERC20.at('0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063')
                tokenBalanceBefore = await DAIToken.balanceOf(DAIHolder)
                DAIAmount = new BN('1000000000000000000000') // 1000$
                await DAIToken.approve(autoStrategy.address, DAIAmount, { from: DAIHolder }) // change

                const tokenAData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000975454aff666519a07eef401d5e97769cb2e82f000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000001d80b89a0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008600000000000000000000000000000000000000000000000000006800003a40200975454aff666519a07eef401d5e97769cb2e82fdd93f59a0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf80a06c4eca272791bca1f2de4661ed88a30c99a7a9449aa841741111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000cfee7c08`
                const tokenBData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a063000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000001d7f99850000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000013a00000000000000000000000000000000000000000000000000000000011c4332742aeea3cdc97efc045aab1d432a8fab5a0bcdc1000000000000000000000000000000000000000000000000000000001d7f9985002424b31a0c0000000000000000000000001111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000001000276a400000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a063000000000000cfee7c08`;
                ({
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await autoStrategy.userStake(DAIHolder))

                // Deposit
                receipt = await autoStrategy.depositSingleAsset(id, DAIToken.address, DAIAmount, [tokenAData, tokenBData], 0, 0, DAIHolder, {
                    from: DAIHolder
                })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    poolID: id,
                    from: DAIHolder,
                    recipient: DAIHolder
                })
            })
            it('withdraws tokens from balance', async () => {
                const tokenBalanceAfter = await DAIToken.balanceOf(DAIHolder)
                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)
                approxeq(tokenDiff, DAIAmount, new BN(0), 'Amount Tokens Sent is not correct')
            })
            it('mints tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(DAIHolder)
                assert.ok(strategyTokenBalance.gt(new BN('0')), 'tokens were not minted')
            })
            it('updates stakes', async () => {
                const { stakeA, stakeB } = await autoStrategy.userStake(DAIHolder)
                assert.ok(stakeA.gt(stakeABefore), 'StakeA not increased')
                assert.ok(stakeB.gt(stakeBBefore), 'StakeB not increased')

                const assetRouter = await UnoAssetRouterSushiswap.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(DAIHolder)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeA is not correct'
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeB is not correct'
                )
            })
        })
        describe('deposit ETH', () => {
            let id
            let stakeABefore
            let stakeBBefore
            let ethBalanceBefore
            let ethSpentOnGas
            let tokenAData
            let tokenBData

            before(async () => {
                id = await autoStrategy.poolID()
                amountETH = new BN('1000000000000000000') // 1 ether

                tokenAData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000cd353f79d9fade311fc3119b841e1f456b54e858000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000005ee7b0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c0cd353f79d9fade311fc3119b841e1f456b54e8581111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000005ee7b0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000055ff76bffc3cdd9d5fdbbc2ece4528ecce45047e000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000005efe90000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c055ff76bffc3cdd9d5fdbbc2ece4528ecce45047e1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000005efe90d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000cfee7c08`;// await fetchData(tokenBSwapParams)

                ({
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await autoStrategy.userStake(DAIHolder))
            })
            it('fires events', async () => {
                ethBalanceBefore = new BN(await web3.eth.getBalance(DAIHolder))
                const receipt = await autoStrategy.depositSingleETH(id, [tokenAData, tokenBData], 0, 0, DAIHolder, { from: DAIHolder, value: amountETH })

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                ethSpentOnGas = gasUsed.mul(effectiveGasPrice)

                expectEvent(receipt, 'Deposit', { poolID: id, from: DAIHolder, recipient: DAIHolder })
            })
            it('withdraws ETH from balance', async () => {
                const ethBalanceAfter = new BN(await web3.eth.getBalance(DAIHolder))

                const ethDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(ethSpentOnGas)

                approxeq(ethDiff, amountETH, new BN(0), 'Amount Tokens Sent is not correct')
            })
            it('updates stakes', async () => {
                const { stakeA, stakeB } = await autoStrategy.userStake(DAIHolder)
                assert.ok(stakeA.gt(stakeABefore), 'StakeA not increased')
                assert.ok(stakeB.gt(stakeBBefore), 'StakeB not increased')

                const assetRouter = await UnoAssetRouterSushiswap.at((await autoStrategy.pools(id)).assetRouter)
                const pool = (await autoStrategy.pools(id)).pool

                const {
                    stakeA: assetRouterStakeA,
                    stakeB: assetRouterStakeB
                } = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(DAIHolder)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(
                    stakeA,
                    assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeA is not correct'
                )
                approxeq(
                    stakeB,
                    assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                    new BN(10),
                    'stakeB is not correct'
                )
            })
        })
    })
})
