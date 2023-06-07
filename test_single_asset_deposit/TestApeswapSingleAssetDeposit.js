const {
    expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IMiniChefV2 = artifacts.require('IMiniChefV2')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmApeswap')
const AssetRouter = artifacts.require('UnoAssetRouterApeswap')

const pool = '0x65D43B64E3B31965Cd5EA367D4c2b94c03084797' // wmatic usdt
const miniChefAddress = '0x54aff400858Dcac39797a81894D9920f16972D1D'

const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1
const feeCollector = '0x46a3A41bd932244Dd08186e4c19F1a7E48cbcDf4'

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterApeswapSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory
    let miniChef
    let pid

    const initReceipt = {}
    before(async () => {
        const implementation = await Farm.new({ from: admin })
        accessManager = await AccessManager.new({ from: admin })// accounts[0] is admin

        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: admin })

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash)
        const events = await assetRouter.getPastEvents('AllEvents', {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })
        // convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        const lpToken = await IUniswapV2Pair.at(pool)

        const tokenAAddress = await lpToken.token0()
        const tokenBAddress = await lpToken.token1()

        tokenA = await IERC20.at(tokenAAddress)
        tokenB = await IERC20.at(tokenBAddress)

        miniChef = await IMiniChefV2.at(miniChefAddress)
        const poolLength = await miniChef.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const _lpToken = await miniChef.lpToken(i)
            if (_lpToken.toString() === pool) {
                pid = i
                break
            }
        }
    })

    describe('Single Asset Deposit', () => {
        describe('deposit token', () => {
            let stakeLPBefore
            let stakeABefore
            let stakeBBefore
            let totalDepositsLPBefore
            let tokenAData
            let tokenBData
            let DAIToken
            let DAIAmount
            let tokenBalanceBefore
            let feeBalanceBefore

            before(async () => {
                const fromToken = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                feeBalanceBefore = await DAIToken.balanceOf(feeCollector)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokenAData = `0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000010e908603a7d949dc7000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e80000000000000000000000000000000000000000000002ca00006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf4000000000000000000000000000000000000000000000000d02ab486cedc00000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a06300a0c9e75c480000000000000000080200000000000000000000000000000000000000000000000000023400011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a06359153f27eefe07e5ece4f9304ebba1da6f53ca886ae40711b8002dc6c059153f27eefe07e5ece4f9304ebba1da6f53ca88604229c960e5cacf2aaeac8be68ac07ba9df81c30000000000000000000000000000000000000000000000000000000002e054388f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae4071138002dc6c0604229c960e5cacf2aaeac8be68ac07ba9df81c31111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000361e61cb7b0cf03c5c2132d05d31c914a87c6611c10748aeb04b58e8f00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd6e7a5fafcec6bb1e78bae2a1f0b612012bf14827000000000000000000000000000000000000000000000000000000000b852c938f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae4071138002dc6c06e7a5fafcec6bb1e78bae2a1f0b612012bf148271111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000d87224382ccc59a012791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000000000000000000000000000cfee7c08`
                tokenBData = `0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a063000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000e60d7f90000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000025d00000000000000000000000000000000000000000000023f00006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf4000000000000000000000000000000000000000000000000d02ab486cedc00000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a06300a0c9e75c48000000000000000008020000000000000000000000000000000000000000000000000001a900008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a06359153f27eefe07e5ece4f9304ebba1da6f53ca886ae40711b8002dc6c059153f27eefe07e5ece4f9304ebba1da6f53ca881111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000002e054388f3cf7ad23cd3cadbd9735aff958023239c6a06300a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd2cf7252e74036d1da831d11089d326296e64a728000000000000000000000000000000000000000000000000000000000b852c938f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae40711b8002dc6c02cf7252e74036d1da831d11089d326296e64a7281111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000b8083c12791bca1f2de4661ed88a30c99a7a9449aa84174000000cfee7c08`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = (await miniChef.userInfo(pid, farm.address))['0']
                }
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(DAIHolder, pool));

                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool))
            })
            it('fires events', async () => {
                const receipt = await assetRouter.depositWithSwap(pool, [tokenAData, tokenBData], DAIHolder, { from: DAIHolder })

                expectEvent(receipt, 'Deposit', { lpPool: pool, sender: DAIHolder, recipient: DAIHolder })
            })
            it('withdraws tokens from balance', async () => {
                const tokenBalanceAfter = await DAIToken.balanceOf(DAIHolder)

                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)

                approxeq(tokenDiff, DAIAmount, new BN(0), 'Amount Tokens Sent is not correct')
            })
            it('updates stakes', async () => {
                const { stakeLP, stakeA: stakeAAfter, stakeB: stakeBAfter } = await assetRouter.userStake(DAIHolder, pool)
                assert.ok(stakeLP.gt(stakeLPBefore), 'Stake not increased')
                assert.ok(stakeAAfter.gt(stakeABefore), 'StakeA not increased')
                assert.ok(stakeBAfter.gt(stakeBBefore), 'StakeB not increased')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.ok(totalDepositsLP.gt(totalDepositsLPBefore), 'Stake not increased')
            })
            it('stakes tokens in StakingRewards contract', async () => {
                const farmAddress = await factory.Farms(pool)
                const farm = await Farm.at(farmAddress)

                const stakingRewardsBalance = (await miniChef.userInfo(pid, farm.address))['0']
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
            it('collects fee', async () => {
                const feeBalanceAfter = await DAIToken.balanceOf(feeCollector)
                assert.ok(feeBalanceAfter.gt(feeBalanceBefore), 'fee balance not increased')
            })
        })
        describe('deposit ETH', () => {
            let stakeLPBefore
            let stakeABefore
            let stakeBBefore
            let totalDepositsLPBefore
            let tokenAData
            let tokenBData
            let ethBalanceBefore
            let ethSpentOnGas
            let feeBalanceBefore

            before(async () => {
                const fromToken = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))
                amountETH = new BN('1000000000000000000') // 1 ether

                // const tokenASwapParams = swapParams(fromToken, tokenAAddress, amountETH.div(new BN(2)).toString(), assetRouter.address)
                // const tokenBSwapParams = swapParams(fromToken, tokenBAddress, amountETH.sub(amountETH.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = `0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000035d887716084000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b200000000000000000000000000000000000000009400004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf4000000000000000000354a6ba7a1800000206b4be0b940610d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db080206c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf12701111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000006bb10ee2c1080000000000000000000000000000000cfee7c08`
                tokenBData = `0x12aa3caf000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f000000000000000000000000b97cd69145e5a9357b2acd6af6c5076380f17afb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000002d806000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f30000000000000000000000000000000000000000d500004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf4000000000000000000354a6ba7a1800000206b4be0b940410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf1270604229c960e5cacf2aaeac8be68ac07ba9df81c36ae40711b8002dc6c0604229c960e5cacf2aaeac8be68ac07ba9df81c31111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000002d8060d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000cfee7c08`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = (await miniChef.userInfo(pid, farm.address))['0']
                }
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(DAIHolder, pool));

                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool))
            })
            it('fires events', async () => {
                ethBalanceBefore = new BN(await web3.eth.getBalance(DAIHolder))
                feeBalanceBefore = new BN(await web3.eth.getBalance(feeCollector))
                const receipt = await assetRouter.depositWithSwap(pool, [tokenAData, tokenBData], DAIHolder, { from: DAIHolder, value: amountETH })

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                ethSpentOnGas = gasUsed.mul(effectiveGasPrice)

                expectEvent(receipt, 'Deposit', { lpPool: pool, sender: DAIHolder, recipient: DAIHolder })
            })
            it('withdraws ETH from balance', async () => {
                const ethBalanceAfter = new BN(await web3.eth.getBalance(DAIHolder))

                const ethDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(ethSpentOnGas)

                approxeq(ethDiff, amountETH, new BN(0), 'Amount Tokens Sent is not correct')
            })
            it('updates stakes', async () => {
                const { stakeLP, stakeA: stakeAAfter, stakeB: stakeBAfter } = await assetRouter.userStake(DAIHolder, pool)
                assert.ok(stakeLP.gt(stakeLPBefore), 'Stake not increased')
                assert.ok(stakeAAfter.gt(stakeABefore), 'StakeA not increased')
                assert.ok(stakeBAfter.gt(stakeBBefore), 'StakeB not increased')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.ok(totalDepositsLP.gt(totalDepositsLPBefore), 'Stake not increased')
            })
            it('stakes tokens in StakingRewards contract', async () => {
                const farmAddress = await factory.Farms(pool)
                const farm = await Farm.at(farmAddress)

                const stakingRewardsBalance = (await miniChef.userInfo(pid, farm.address))['0']
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
            it('collects fee', async () => {
                const feeBalanceAfter = new BN(await web3.eth.getBalance(feeCollector))
                assert.ok(feeBalanceAfter.gt(feeBalanceBefore), 'fee balance not increased')
            })
        })
    })
})
