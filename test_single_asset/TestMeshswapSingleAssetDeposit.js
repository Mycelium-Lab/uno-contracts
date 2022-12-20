const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const fetch = require('node-fetch')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmMeshswap')
const AssetRouter = artifacts.require('UnoAssetRouterMeshswap')

const pool = '0x2915D57D076Ca2233F73B2E724Fea4F3DB967F9B' // usdt usdc

const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

apiRequestUrl = (queryParams) => {
    const baseApiRequestURL = 'https://api.1inch.io/v5.0/137/swap'
    return `${baseApiRequestURL}?${(new URLSearchParams(queryParams)).toString()}`
}
fetchData = async (queryParams) => fetch(apiRequestUrl(queryParams)).then((res) => res.json()).then((res) => res.tx.data)

swapParams = (
    fromTokenAddress,
    toTokenAddress,
    amount,
    fromAddress
) => ({
    fromTokenAddress,
    toTokenAddress,
    amount,
    fromAddress,
    slippage: 1,
    disableEstimate: true
})

contract('UnoAssetRouterMeshswapSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory

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

            before(async () => {
                const fromToken = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                // const tokenASwapParams = swapParams(DAIToken.address, tokenAAddress, DAIAmount.div(new BN(2)).toString(), assetRouter.address)
                // const tokenBSwapParams = swapParams(DAIToken.address, tokenBAddress, DAIAmount.sub(DAIAmount.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000f5c3455d30458e9a1128f85941f533834f01d8b6000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef50000000000000000000000000000000000000000000000000000005db6d1862af0da0000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002f50000000000000000000000000000000000000000000000000002d70002a900a007e5c0d200000000000000000000000000000000000000000000028500008900003a4020f5c3455d30458e9a1128f85941f533834f01d8b6bd6015b40000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf02a0000000000000000000000000000000000000000000000022471eb8eede51ab59ee63c1e500a374094527e1673a86de625aa59517c5de346d322791bca1f2de4661ed88a30c99a7a9449aa8417400a0c9e75c48000000000000002607050000000000000000000000000000000000000000000001ce00017f00004f02a0000000000000000000000000000000000000000000000000009611bb0cea8831ee63c1e50133c4f0043e2e988b3c2e9c77e2c670efe709bfe30d500b1d8e8ef31e21c99d1db9a6444d3adf1270510610f4a785f458bc144e37065759248899549466390d500b1d8e8ef31e21c99d1db9a6444d3adf1270000438ed1739000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d1ff67e23dae5600000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000000000000000000000000000000000063a727bc00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f61902a000000000000000000000000000000000000000000000000004735bf57386d719ee63c1e50186f1d8390222a3691c28938ec7404a1661e618e00d500b1d8e8ef31e21c99d1db9a6444d3adf127080a06c4eca277ceb23fd6bc0add59e62ac25578270cff1b9f6191111111254eeb25477b68fb85ed929f73a9605820000000000000000000000cfee7c08`
                tokenBData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000975454aff666519a07eef401d5e97769cb2e82f000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000001d80b89a0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008600000000000000000000000000000000000000000000000000006800003a40200975454aff666519a07eef401d5e97769cb2e82fdd93f59a0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf80a06c4eca272791bca1f2de4661ed88a30c99a7a9449aa841741111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000cfee7c08`

                // console.log(tokenAData, tokenBData)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await (await IUniswapV2Pair.at(pool)).balanceOf(farm.address)
                }
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(DAIHolder, pool));

                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool))
            })
            it('fires events', async () => {
                const receipt = await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, [tokenAData, tokenBData], 0, 0, DAIHolder, { from: DAIHolder })

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

                const stakingRewardsBalance = await (await IUniswapV2Pair.at(pool)).balanceOf(farm.address)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
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

            before(async () => {
                const fromToken = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))
                amountETH = new BN('1000000000000000000') // 1 ether

                // const tokenASwapParams = swapParams(fromToken, tokenAAddress, amountETH.div(new BN(2)).toString(), assetRouter.address)
                // const tokenBSwapParams = swapParams(fromToken, tokenBAddress, amountETH.sub(amountETH.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000007ceb23fd6bc0add59e62ac25578270cff1b9f619000000000000000000000000def834ae4a1198bfec84544fb374ec7f1314a7c5000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000000012c92202a32740000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138000f4240def834ae4a1198bfec84544fb374ec7f1314a7c51111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000012c92202a32740d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000cd353f79d9fade311fc3119b841e1f456b54e858000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000005ea600000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c0cd353f79d9fade311fc3119b841e1f456b54e8581111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000005ea600d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenBSwapParams)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await (await IUniswapV2Pair.at(pool)).balanceOf(farm.address)
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
                const receipt = await assetRouter.depositSingleETH(pool, [tokenAData, tokenBData], 0, 0, DAIHolder, { from: DAIHolder, value: amountETH })

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

                const stakingRewardsBalance = await (await IUniswapV2Pair.at(pool)).balanceOf(farm.address)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
    })
})
