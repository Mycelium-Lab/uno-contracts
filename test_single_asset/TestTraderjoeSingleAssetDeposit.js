const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IMasterJoe = artifacts.require('IMasterChefJoe')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTraderjoe')
const AssetRouter = artifacts.require('UnoAssetRouterTraderjoe')

const pool = '0xf4003F4efBE8691B60249E6afbD307aBE7758adb' // wAVAX-USDC
const masterJoeAddress = '0x4483f0b6e2F5486D06958C20f8C39A7aBe87bf8F'

const DAIHolder = '0x05541A4891F0241Cc4ba7E0664428e5Af86Ae3Fe'// has to be unlocked and hold 0xd586E7F844cEa2F87f50152665BCbc2C279D8d70

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterTraderjoeSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory
    let masterJoe
    let pid

    before(async () => {
        const implementation = await Farm.new({ from: admin })
        accessManager = await AccessManager.new({ from: admin })
        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })
        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: admin })

        const lpToken = await IUniswapV2Pair.at(pool)

        const tokenAAddress = await lpToken.token0()
        const tokenBAddress = await lpToken.token1()

        tokenA = await IERC20.at(tokenAAddress)
        tokenB = await IERC20.at(tokenBAddress)

        masterJoe = await IMasterJoe.at(masterJoeAddress)
        const poolLength = await masterJoe.poolLength()

        for (let i = 0; i < poolLength.toNumber(); i++) {
            const _lpToken = (await masterJoe.poolInfo(i)).lpToken
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

            before(async () => {
                const fromToken = '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokenAData = `0x12aa3caf00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c700000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef50000000000000000000000000000000000000000000000000000113a2b3f3643b2c85000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001e20000000000000000000000000000000000000000000001c400006800004e80206c4eca27d586e7f844cea2f87f50152665bcbc2c279d8d7046a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf78d586e7f844cea2f87f50152665bcbc2c279d8d7000a007e5c0d20000000000000000000000000000000000000000000001380000de00008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d70459eb852799057912138519eab28c8e0c227c42c6ae4071138002dc6c0459eb852799057912138519eab28c8e0c227c42cd87cd5aa7efdc4de73ef8c7166d4d1daa37e2330000000000000000000000000000000000000000000000000000000000df97c7bd586e7f844cea2f87f50152665bcbc2c279d8d7000a0c028b46d06d87cd5aa7efdc4de73ef8c7166d4d1daa37e2330000000000000000000000000000000000000000000000000000000000df87986b5352a39c11a81fe6748993d586ec448a01f08b54020b5352a39c11a81fe6748993d586ec448a01f08b553c059a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000000b4eb6cb3`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000df879860000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000018800000000000000000000000000000000000000000000016a00006800004e80206c4eca27d586e7f844cea2f87f50152665bcbc2c279d8d7046a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf78d586e7f844cea2f87f50152665bcbc2c279d8d7000a007e5c0d20000000000000000000000000000000000000000000000000000de00008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d70459eb852799057912138519eab28c8e0c227c42c6ae4071138002dc6c0459eb852799057912138519eab28c8e0c227c42cd87cd5aa7efdc4de73ef8c7166d4d1daa37e2330000000000000000000000000000000000000000000000000000000000df97c7bd586e7f844cea2f87f50152665bcbc2c279d8d7000a0c028b46d06d87cd5aa7efdc4de73ef8c7166d4d1daa37e2330000000000000000000000000000000000000000000000000000000000df879861111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000b4eb6cb3`// await fetchData(tokenBSwapParams)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = new BN((await masterJoe.userInfo(pid, farm.address)).amount)
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

                const stakingRewardsBalance = new BN((await masterJoe.userInfo(pid, farm.address)).amount)
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
                const fromToken = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))
                amountETH = new BN('1000000000000000000') // 1 ether

                // const tokenASwapParams = swapParams(fromToken, tokenAAddress, amountETH.div(new BN(2)).toString(), assetRouter.address)
                // const tokenBSwapParams = swapParams(fromToken, tokenBAddress, amountETH.sub(amountETH.div(new BN(2))).toString(), assetRouter.address)

                tokenAData = `0x12aa3caf00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c700000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000036f4bf04de8c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b200000000000000000000000000000000000000009400004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b94061b31f66aa3c1e785363f0875a1b74e27b85fd66c7d0e30db080206c4eca27b31f66aa3c1e785363f0875a1b74e27b85fd66c71111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000006de97e09bd180000000000000000000000000000000b4eb6cb3`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e00000000000000000000000032d12a25f539e341089050e2d26794f041fc9df8000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000000000000002c38e2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f30000000000000000000000000000000000000000d500004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b94041b31f66aa3c1e785363f0875a1b74e27b85fd66c7d0e30db00c20b31f66aa3c1e785363f0875a1b74e27b85fd66c76539bf462f73ff9497054ba261c195da8639ed616ae40711b8002dc6c06539bf462f73ff9497054ba261c195da8639ed611111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000002c38e2b31f66aa3c1e785363f0875a1b74e27b85fd66c700000000000000000000000000b4eb6cb3`// await fetchData(tokenBSwapParams)

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = new BN((await masterJoe.userInfo(pid, farm.address)).amount)
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

                const stakingRewardsBalance = new BN((await masterJoe.userInfo(pid, farm.address)).amount)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
    })
})
