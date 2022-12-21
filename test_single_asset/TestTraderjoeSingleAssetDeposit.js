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
// 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
// 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
const masterJoeAddress = '0x4483f0b6e2F5486D06958C20f8C39A7aBe87bf8F'

const DAIHolder = '0xd699571A57D3Efe7c50369Fb5350448FA1ad246E'// has to be unlocked and hold 0xd586E7F844cEa2F87f50152665BCbc2C279D8d70

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

                tokenAData = `0x12aa3caf000000000000000000000000d41b24bba51fac0e4827b6f94c0d6ddeb183cd64000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000d41b24bba51fac0e4827b6f94c0d6ddeb183cd64000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000001238ccf1a6e5698c2000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f50000000000000000000000000000000000000000000000000000000001d700a0c9e75c48000000000000000008020000000000000000000000000000000000000000000000000001a900011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d70a6908c7e3be8f4cd2eb704b5cb73583ebf56ee626ae40711b8002dc6c0a6908c7e3be8f4cd2eb704b5cb73583ebf56ee62ed8cbd9f0ce3c6986b22002f03c6475ceb7a62560000000000000000000000000000000000000000000000000000000002f7a6ccd586e7f844cea2f87f50152665bcbc2c279d8d7000206ae40711b8002dc6c0ed8cbd9f0ce3c6986b22002f03c6475ceb7a62561111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000003a499bacf187563fc7198437980c041c805a1edcba50c1ce5db951180c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae40711b8002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86a1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000e943336d7ccf4283d586e7f844cea2f87f50152665bcbc2c279d8d700000000000000000000000cfee7c08`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf000000000000000000000000d41b24bba51fac0e4827b6f94c0d6ddeb183cd64000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000d41b24bba51fac0e4827b6f94c0d6ddeb183cd64000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000ebed3f20000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000026200a0c9e75c480000000000000000080200000000000000000000000000000000000000000000000000023400011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7063abe32d0ee76c05a11838722a63e012008416e66ae40711b8002dc6c063abe32d0ee76c05a11838722a63e012008416e62a8a315e82f85d1f0658c5d66a452bbdd93567830000000000000000000000000000000000000000000000000000000002f55a2fd586e7f844cea2f87f50152665bcbc2c279d8d7000206ae4071138002dc6c02a8a315e82f85d1f0658c5d66a452bbdd93567831111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000002f226d6a7d7079b0fead91f3e65f86e8915cb59c1a4c66400a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae40711b8002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86af4003f4efbe8691b60249e6afbd307abe7758adb000000000000000000000000000000000000000000000000e943336d7ccf4283d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae4071138002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000bccad1bb31f66aa3c1e785363f0875a1b74e27b85fd66c7cfee7c08`// await fetchData(tokenBSwapParams)

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

                tokenAData = '0x'// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf000000000000000000000000d41b24bba51fac0e4827b6f94c0d6ddeb183cd64000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000f4003f4efbe8691b60249e6afbd307abe7758adb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000000000000002cef230000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000002cef23b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenBSwapParams)

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

                const stakingRewardsBalance = new BN((await masterJoe.userInfo(pid, farm.address)).amount)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
    })
})
