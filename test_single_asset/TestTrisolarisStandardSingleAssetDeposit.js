const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniversalMasterChef = artifacts.require('IUniversalMasterChef')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTrisolarisStandard')
const AssetRouter = artifacts.require('UnoAssetRouterTrisolarisStandard')

const pool = '0x2fe064B6c7D274082aa5d2624709bC9AE7D16C77' // usdt usdc

const masterChefV1 = '0x1f1Ed214bef5E83D8f5d0eB5D7011EB965D0D79B'
const masterChefV2 = '0x3838956710bcc9D122Dd23863a0549ca8D5675D6'
const DAIHolder = '0xCdF46720BdF30D6bd0912162677c865d4344B0CA'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterTrisolarisStandardSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory
    let MasterChef
    let pid

    before(async () => {
        const implementation = await Farm.new({ from: admin })
        accessManager = await AccessManager.new({ from: admin })// accounts[0] is admin
        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })
        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: admin })

        const lpToken = await IUniswapV2Pair.at(pool)
        const tokenAAddress = await lpToken.token0()// 0x4988a896b1227218e4A686fdE5EabdcAbd91571f
        const tokenBAddress = await lpToken.token1()// 0xB12BFcA5A55806AaF64E99521918A4bf0fC40802

        tokenA = await IERC20.at(tokenAAddress)
        tokenB = await IERC20.at(tokenBAddress)

        const MasterChefV1 = await IUniversalMasterChef.at(masterChefV1)
        const MasterChefV2 = await IUniversalMasterChef.at(masterChefV2)

        const poolLengthV1 = (await MasterChefV1.poolLength()).toNumber()
        const poolLengthV2 = (await MasterChefV2.poolLength()).toNumber()

        let poolFound = false

        for (let i = 0; i < poolLengthV2; i++) {
            const _lpToken = await MasterChefV2.lpToken(i)
            if (_lpToken.toString() === pool) {
                pid = i
                poolFound = true
                MasterChef = MasterChefV2
                break
            }
        }

        if (!poolFound) {
            for (let i = 0; i < poolLengthV1; i++) {
                const _lpToken = (await MasterChefV1.poolInfo(i)).lpToken
                if (_lpToken.toString() === pool) {
                    pid = i
                    MasterChef = MasterChefV1
                    break
                }
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
                const fromToken = '0xe3520349F477A5F6EB06107066048508498A291b';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))

                DAIToken = await IERC20.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokenAData = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000e3520349f477a5f6eb06107066048508498a291b0000000000000000000000004988a896b1227218e4a686fde5eabdcabd91571f0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000c2f0bca0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037600000000000000000000000000000000000000000000000000000000035800a0c9e75c480000000000000005030200000000000000000000000000000000000000000000032a0001a900008f0c20e3520349f477a5f6eb06107066048508498a291b2c4d78a40bab1a6cbb4b59297cd7b2eba21128ef6ae40711b8002dc6c02c4d78a40bab1a6cbb4b59297cd7b2eba21128ef1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000027c04b9e3520349f477a5f6eb06107066048508498a291b00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20e3520349f477a5f6eb06107066048508498a291bbb310ef4fac855f2f49d8fb35a2da8f639b3464e6ae40711b8002dc6c0bb310ef4fac855f2f49d8fb35a2da8f639b3464e2fe064b6c7d274082aa5d2624709bc9ae7d16c770000000000000000000000000000000000000000000000000000000003aaf2f4e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c02fe064b6c7d274082aa5d2624709bc9ae7d16c771111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000003a7a17bb12bfca5a55806aaf64e99521918a4bf0fc4080200a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b3f239d83af94f836b93910d29704def88542e2a76ae40711b8002dc6c03f239d83af94f836b93910d29704def88542e2a763da4db6ef4e7c62168ab03982399f9588fcd198000000000000000000000000000000000000000000000000012a8689fb4e9b51e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19803b666f3488a7992b2385b12df7f35156d7b29cd0000000000000000000000000000000000000000003fc78e82afcd8c833c79bac9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae40711b8002dc6c003b666f3488a7992b2385b12df7f35156d7b29cd1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000060b6596c42c30ac6cc15fac9bd938618bcaa1a1fae8501d00000000000000000000cfee7c08`
                tokenBData = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000e3520349f477a5f6eb06107066048508498a291b000000000000000000000000b12bfca5a55806aaf64e99521918a4bf0fc408020000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000c7839bc0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000055e00000000000000000000000000000000000000000000000000000000054000a0c9e75c480000000000000403020100000000000000000000000000000000000000051200039100030200018100a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b2c4d78a40bab1a6cbb4b59297cd7b2eba21128ef6ae40711b8002dc6c02c4d78a40bab1a6cbb4b59297cd7b2eba21128ef2639f48ace89298fa2e874ef2e26d4576058ae6d00000000000000000000000000000000000000000000000000000000015a272de3520349f477a5f6eb06107066048508498a291b00206ae4071138002dc6c02639f48ace89298fa2e874ef2e26d4576058ae6d2f41af687164062f118297ca10751f4b55478ae1000000000000000000000000000000000000000000000000003c3287ca35619f4988a896b1227218e4a686fde5eabdcabd91571f00206ae40711b8002dc6c02f41af687164062f118297ca10751f4b55478ae11111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000133ac97c9bdeed33cd01541e1eed10f90519d2c06fe3feb00a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b28058325c9d1779b74f5b6ae9ecd83e30bc961b16ae40711b8002dc6c028058325c9d1779b74f5b6ae9ecd83e30bc961b103b666f3488a7992b2385b12df7f35156d7b29cd0000000000000000000000000000000000000000001b128f314beea5a2fe1332e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c003b666f3488a7992b2385b12df7f35156d7b29cd2fe064b6c7d274082aa5d2624709bc9ae7d16c770000000000000000000000000000000000000000000000000000000002910949c42c30ac6cc15fac9bd938618bcaa1a1fae8501d00206ae4071138002dc6c02fe064b6c7d274082aa5d2624709bc9ae7d16c771111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000028f50914988a896b1227218e4a686fde5eabdcabd91571f0c20e3520349f477a5f6eb06107066048508498a291bbb310ef4fac855f2f49d8fb35a2da8f639b3464e6ae40711b8002dc6c0bb310ef4fac855f2f49d8fb35a2da8f639b3464e1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000003aaf2f4e3520349f477a5f6eb06107066048508498a291b00a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b3f239d83af94f836b93910d29704def88542e2a76ae40711b8002dc6c03f239d83af94f836b93910d29704def88542e2a763da4db6ef4e7c62168ab03982399f9588fcd19800000000000000000000000000000000000000000000000000f86c7281f1f7aae3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19820f8aefb5697b77e0bb835a8518be70775cda1b00000000000000000000000000000000000000000003514e100bbe4c29115040bc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae40711b8002dc6c020f8aefb5697b77e0bb835a8518be70775cda1b01111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000050a499fc42c30ac6cc15fac9bd938618bcaa1a1fae8501d0000cfee7c08`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = (await MasterChef.userInfo(pid, farm.address)).amount
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

                const stakingRewardsBalance = new BN((await MasterChef.userInfo(pid, farm.address)).amount)
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
                const fromToken = '0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB';
                ([tokenAAddress, tokenBAddress] = await assetRouter.getTokens(pool))
                amountETH = new BN('1000000000000000000') // 1 ether

                tokenAData = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000c9bdeed33cd01541e1eed10f90519d2c06fe3feb0000000000000000000000004988a896b1227218e4a686fde5eabdcabd91571f00000000000000000000000063da4db6ef4e7c62168ab03982399f9588fcd198000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000000000000000011f064fb0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012a00000000000000000000000000000000000000000000000000010c0000de00a007e5c0d20000000000000000000000000000000000000000000000000000ba00006700206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19803b666f3488a7992b2385b12df7f35156d7b29cd000000000000000000000000000000000000000000bd7ef1b07ffd7edce94d8dc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae4071198002dc6c003b666f3488a7992b2385b12df7f35156d7b29cd0000000000000000000000000000000000000000000000000000000011f064fbc42c30ac6cc15fac9bd938618bcaa1a1fae8501d80a06c4eca274988a896b1227218e4a686fde5eabdcabd91571f1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenASwapParams)
                tokenBData = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000c9bdeed33cd01541e1eed10f90519d2c06fe3feb000000000000000000000000b12bfca5a55806aaf64e99521918a4bf0fc4080200000000000000000000000063da4db6ef4e7c62168ab03982399f9588fcd198000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000000000000000011f37ab70000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012a00000000000000000000000000000000000000000000000000010c0000de00a007e5c0d20000000000000000000000000000000000000000000000000000ba00006700206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19820f8aefb5697b77e0bb835a8518be70775cda1b0000000000000000000000000000000000000000000bd7ef1b07ffd7edce94d8dc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae4071198002dc6c020f8aefb5697b77e0bb835a8518be70775cda1b00000000000000000000000000000000000000000000000000000000011f37ab7c42c30ac6cc15fac9bd938618bcaa1a1fae8501d80a06c4eca27b12bfca5a55806aaf64e99521918a4bf0fc408021111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000cfee7c08`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = (await MasterChef.userInfo(pid, farm.address)).amount
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

                const stakingRewardsBalance = new BN((await MasterChef.userInfo(pid, farm.address)).amount)
                assert.ok(stakingRewardsBalance.gt(stakingRewardsBalanceBefore), 'StakingRewards balance not increased')
            })
        })
    })
})
