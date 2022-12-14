const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const fetch = require('node-fetch')

const IStakingDualRewards = artifacts.require('IStakingDualRewards')
const IStakingDualRewardsFactory = artifacts.require('IStakingDualRewardsFactory')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniswapV2Router01 = artifacts.require('IUniswapV2Router01')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmQuickswapDual')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswapDual')

const pool = '0x14977e7E263FF79c4c3159F497D9551fbE769625' // WMATIC-USDC

const DQuickHolder = '0xcf0b86f9944a60a0ba22b51a33c11d9e4de1ce9f'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1
const WMaticHolder = '0xFffbCD322cEace527C8ec6Da8de2461C6D9d4e6e'// has to be unlocked and hold 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270
const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1
const stakingRewardsOwner = '0x476307dac3fd170166e007fcaa14f0a129721463'// has to be unlocked

const account1 = '0xDaBDab6115D32136d0E663A5d0e867923A923EeF'// has to be unlocked and hold 0x6e7a5FAFcec6BB1e78bAE2A1F0B612012BF14827

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

apiRequestUrl = (queryParams) => {
    const baseApiRequestURL = 'https://api.1inch.io/v5.0/137/swap'
    return `${baseApiRequestURL}?${(new URLSearchParams(queryParams)).toString()}`
}

fetchData = async (queryParams) => fetch(apiRequestUrl(queryParams)).then((res) => res.json()).then((res) => {
    let data
    try {
        data = res.tx.data
    } catch {
        data = '0x'
    }
    return data
})

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

contract('UnoAssetRouterQuickswapDualSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager; let assetRouter; let
        factory

    let stakingRewards; let
        stakingToken

    let tokenA; let
        tokenB

    const initReceipt = {}
    let rewardsTokenA; let
        rewardsTokenB

    before(async () => {
        const implementation = await Farm.new({ from: account1 })
        accessManager = await AccessManager.new({ from: admin })// accounts[0] is admin

        await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor, { from: admin }) // DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, { from: admin }) // PAUSER_ROLE

        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: account1 })

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash)
        const events = await assetRouter.getPastEvents('AllEvents', {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })

        // convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        stakingRewards = await IStakingDualRewards.at(pool)

        const stakingTokenAddress = await stakingRewards.stakingToken()
        stakingToken = await IUniswapV2Pair.at(stakingTokenAddress)

        const tokenAAddress = await stakingToken.token0()
        const tokenBAddress = await stakingToken.token1()

        tokenA = await IUniswapV2Pair.at(tokenAAddress)// should be ERC20 but IUniswapV2Pair has everything we need
        tokenB = await IUniswapV2Pair.at(tokenBAddress)// should be ERC20 but IUniswapV2Pair has everything we need

        const stakingRewardsFactoryAddress = await stakingRewards.dualRewardsDistribution()
        const stakingRewardsFactory = await IStakingDualRewardsFactory.at(stakingRewardsFactoryAddress)

        const rewardsTokenAAddress = await stakingRewards.rewardsTokenA()// dQuick
        rewardsTokenA = await IUniswapV2Pair.at(rewardsTokenAAddress)
        const rewardAmountA = await rewardsTokenA.balanceOf(DQuickHolder)
        await rewardsTokenA.transfer(stakingRewardsFactory.address, rewardAmountA, { from: DQuickHolder })

        const rewardsTokenBAddress = await stakingRewards.rewardsTokenB()// WMatic
        rewardsTokenB = await IUniswapV2Pair.at(rewardsTokenBAddress)
        const rewardAmountB = await rewardsTokenB.balanceOf(WMaticHolder)
        await rewardsTokenB.transfer(stakingRewardsFactory.address, rewardAmountB, { from: WMaticHolder })

        // add rewards to pool
        await stakingRewardsFactory.update(stakingToken.address, rewardAmountA, rewardAmountB, 1000000, { from: stakingRewardsOwner })
        await stakingRewardsFactory.notifyRewardAmount(stakingToken.address, { from: stakingRewardsOwner })
    })

    describe('Single Asset Deposit', () => {
        describe('deposit token', () => {
            let tokenAAddress
            let tokenBAddress
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

                const tokenASwapParams = swapParams(DAIToken.address, tokenAAddress, DAIAmount.div(new BN(2)).toString(), assetRouter.address)
                const tokenBSwapParams = swapParams(DAIToken.address, tokenBAddress, DAIAmount.sub(DAIAmount.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = await fetchData(tokenASwapParams)
                tokenBData = await fetchData(tokenBSwapParams)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await stakingRewards.balanceOf(farm.address)
                }
                ({
                    stakeLP: stakeLPBefore,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore
                } = await assetRouter.userStake(DAIHolder, pool));

                ({ totalDepositsLP: totalDepositsLPBefore } = await assetRouter.totalDeposits(pool))
            })
            it('fires events', async () => {
                const receipt = await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, [tokenAData, tokenBData], 0, 0, 0, DAIHolder, { from: DAIHolder })

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

                const stakingRewardsBalance = await stakingRewards.balanceOf(farm.address)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
        describe('deposit ETH', () => {
            let tokenAAddress
            let tokenBAddress
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

                const tokenASwapParams = swapParams(fromToken, tokenAAddress, amountETH.div(new BN(2)).toString(), assetRouter.address)
                const tokenBSwapParams = swapParams(fromToken, tokenBAddress, amountETH.sub(amountETH.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = await fetchData(tokenASwapParams)
                tokenBData = await fetchData(tokenBSwapParams)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await stakingRewards.balanceOf(farm.address)
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
                const receipt = await assetRouter.depositSingleETH(pool, constants.ZERO_ADDRESS, amountETH, [tokenAData, tokenBData], 0, 0, 0, DAIHolder, { from: DAIHolder, value: amountETH })

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

                const stakingRewardsBalance = await stakingRewards.balanceOf(farm.address)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
    })
})
