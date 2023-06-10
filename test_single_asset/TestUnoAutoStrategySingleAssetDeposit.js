const {
    expectEvent, BN, constants
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
    describe('Deposits With swap', () => {
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

                const tokenAData = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded10000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000eb3d9d1000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001150000000000000000000000000000000000000000000000f700006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a0630c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000eb3d9d18f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000b4eb6cb3`
                const tokenBData = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded10000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a063000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000eaad1d70000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000025d00000000000000000000000000000000000000000000023f00006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a06300a0c9e75c48000000000000000006040000000000000000000000000000000000000000000000000001a900008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a06359153f27eefe07e5ece4f9304ebba1da6f53ca886ae40711b8002dc6c059153f27eefe07e5ece4f9304ebba1da6f53ca881111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000005debad18f3cf7ad23cd3cadbd9735aff958023239c6a06300a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd2cf7252e74036d1da831d11089d326296e64a7280000000000000000000000000000000000000000000000000000000008d2d4938f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae40711b8002dc6c02cf7252e74036d1da831d11089d326296e64a7281111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000008cc17052791bca1f2de4661ed88a30c99a7a9449aa84174000000b4eb6cb3`;// await fetchData(tokenBSwapParams);
                ({
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await autoStrategy.userStake(DAIHolder))

                // Deposit
                receipt = await autoStrategy.depositWithSwap(id, [tokenAData, tokenBData], DAIHolder, constants.ZERO_ADDRESS, {
                    from: DAIHolder
                })
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {
                    poolID: id,
                    from: DAIHolder,
                    recipient: DAIHolder
                })
                const tokenBalanceAfter = await DAIToken.balanceOf(DAIHolder)
                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)
                expectEvent(receipt, 'DepositTokensWithSwap', {
                    poolID: id,
                    token0: DAIToken.address,
                    token1: DAIToken.address,
                    sent0: new BN('500000000000000000000'),
                    sent1: new BN('500000000000000000000')
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

                tokenAData = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000000000000000223b2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f30000000000000000000000000000000000000000d500004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b940410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf12706e7a5fafcec6bb1e78bae2a1f0b612012bf148276ae40711b8002dc6c06e7a5fafcec6bb1e78bae2a1f0b612012bf148271111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000000223b20d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000b4eb6cb3`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouterSushiswap.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000002234e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f30000000000000000000000000000000000000000d500004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b940410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf1270604229c960e5cacf2aaeac8be68ac07ba9df81c36ae40711b8002dc6c0604229c960e5cacf2aaeac8be68ac07ba9df81c31111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000002234e0d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000b4eb6cb3`;
                ({
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await autoStrategy.userStake(DAIHolder))
            })
            it('fires events', async () => {
                ethBalanceBefore = new BN(await web3.eth.getBalance(DAIHolder))
                const receipt = await autoStrategy.depositWithSwap(id, [tokenAData, tokenBData], DAIHolder, constants.ZERO_ADDRESS, { from: DAIHolder, value: amountETH })

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                ethSpentOnGas = gasUsed.mul(effectiveGasPrice)

                expectEvent(receipt, 'Deposit', { poolID: id, from: DAIHolder, recipient: DAIHolder })

                const ethBalanceAfter = new BN(await web3.eth.getBalance(DAIHolder))
                const ethDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(ethSpentOnGas)

                expectEvent(receipt, 'DepositTokensWithSwap', {
                    poolID: id,
                    token0: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
                    token1: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
                    sent0: new BN('500000000000000000'),
                    sent1: new BN('500000000000000000')
                })
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
