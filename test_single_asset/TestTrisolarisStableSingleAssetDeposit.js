const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IUniversalMasterChef = artifacts.require('IUniversalMasterChef')
const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTrisolarisStable')
const AssetRouter = artifacts.require('UnoAssetRouterTrisolarisStable')

const pool = '0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970' // USDC-USDT-USN
const lpTokenAddress = '0x87BCC091d0A7F9352728100268Ac8D25729113bB'
// 0xB12BFcA5A55806AaF64E99521918A4bf0fC40802
// 0x4988a896b1227218e4A686fdE5EabdcAbd91571f
// 0x5183e1B1091804BC2602586919E6880ac1cf2896
const masterChefV2 = '0x3838956710bcc9D122Dd23863a0549ca8D5675D6'
const DAIHolder = '0xCdF46720BdF30D6bd0912162677c865d4344B0CA'// has to be unlocked and hold 0xe3520349F477A5F6EB06107066048508498A291b

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterTrisolarisStableSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory

    let tokens
    const tokenContracts = []
    let MasterChef
    let pid

    before(async () => {
        const implementation = await Farm.new({ from: admin })
        accessManager = await AccessManager.new({ from: admin })
        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })
        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: admin })

        tokens = await assetRouter.getTokens(pool)
        for (let i = 0; i < tokens.length; i++) {
            tokenContracts.push(await IERC20.at(tokens[i]))
        }

        MasterChef = await IUniversalMasterChef.at(masterChefV2)
        const poolLength = (await MasterChef.poolLength()).toNumber()
        for (let i = 0; i < poolLength; i++) {
            const _lpToken = await MasterChef.lpToken(i)
            if (_lpToken.toString().toLowerCase() === lpTokenAddress.toLowerCase()) {
                pid = i
                break
            }
        }
    })

    describe('Single Asset Deposit', () => {
        describe('deposit token', () => {
            let stakeLPBefore
            let totalDepositsLPBefore
            let DAIToken
            let DAIAmount
            let tokenBalanceBefore
            const tokensData = []

            before(async () => {
                const fromToken = '0xe3520349F477A5F6EB06107066048508498A291b'

                DAIToken = await IERC20.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1500000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokensData[0] = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000e3520349f477a5f6eb06107066048508498a291b000000000000000000000000b12bfca5a55806aaf64e99521918a4bf0fc408020000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000c645ec20000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000055e00000000000000000000000000000000000000000000000000000000054000a0c9e75c480000000000000403020100000000000000000000000000000000000000051200039100030200018100a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b2c4d78a40bab1a6cbb4b59297cd7b2eba21128ef6ae40711b8002dc6c02c4d78a40bab1a6cbb4b59297cd7b2eba21128ef2639f48ace89298fa2e874ef2e26d4576058ae6d00000000000000000000000000000000000000000000000000000000015a272de3520349f477a5f6eb06107066048508498a291b00206ae4071138002dc6c02639f48ace89298fa2e874ef2e26d4576058ae6d2f41af687164062f118297ca10751f4b55478ae1000000000000000000000000000000000000000000000000003c3287ca35619f4988a896b1227218e4a686fde5eabdcabd91571f00206ae40711b8002dc6c02f41af687164062f118297ca10751f4b55478ae11111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000001342100c9bdeed33cd01541e1eed10f90519d2c06fe3feb00a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b28058325c9d1779b74f5b6ae9ecd83e30bc961b16ae40711b8002dc6c028058325c9d1779b74f5b6ae9ecd83e30bc961b103b666f3488a7992b2385b12df7f35156d7b29cd0000000000000000000000000000000000000000001b128f314beea5a2fe1332e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c003b666f3488a7992b2385b12df7f35156d7b29cd2fe064b6c7d274082aa5d2624709bc9ae7d16c7700000000000000000000000000000000000000000000000000000000028e08c7c42c30ac6cc15fac9bd938618bcaa1a1fae8501d00206ae4071138002dc6c02fe064b6c7d274082aa5d2624709bc9ae7d16c771111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000028c58914988a896b1227218e4a686fde5eabdcabd91571f0c20e3520349f477a5f6eb06107066048508498a291bbb310ef4fac855f2f49d8fb35a2da8f639b3464e6ae40711b8002dc6c0bb310ef4fac855f2f49d8fb35a2da8f639b3464e1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000003aaf2f4e3520349f477a5f6eb06107066048508498a291b00a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b3f239d83af94f836b93910d29704def88542e2a76ae40711b8002dc6c03f239d83af94f836b93910d29704def88542e2a763da4db6ef4e7c62168ab03982399f9588fcd19800000000000000000000000000000000000000000000000000f65c41fb1e1ad7e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19820f8aefb5697b77e0bb835a8518be70775cda1b000000000000000000000000000000000000000000034b478d0880ab38cf9716cc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae40711b8002dc6c020f8aefb5697b77e0bb835a8518be70775cda1b01111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000004f8f23cc42c30ac6cc15fac9bd938618bcaa1a1fae8501d0000cfee7c08`// await fetchData(tokenASwapParams)
                tokensData[1] = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000e3520349f477a5f6eb06107066048508498a291b0000000000000000000000004988a896b1227218e4a686fde5eabdcabd91571f0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000000000000000c1d3e9d0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000037600000000000000000000000000000000000000000000000000000000035800a0c9e75c480000000000000005030200000000000000000000000000000000000000000000032a0001a900008f0c20e3520349f477a5f6eb06107066048508498a291b2c4d78a40bab1a6cbb4b59297cd7b2eba21128ef6ae40711b8002dc6c02c4d78a40bab1a6cbb4b59297cd7b2eba21128ef1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000027c04b9e3520349f477a5f6eb06107066048508498a291b00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20e3520349f477a5f6eb06107066048508498a291bbb310ef4fac855f2f49d8fb35a2da8f639b3464e6ae40711b8002dc6c0bb310ef4fac855f2f49d8fb35a2da8f639b3464e2fe064b6c7d274082aa5d2624709bc9ae7d16c770000000000000000000000000000000000000000000000000000000003aaf2f4e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c02fe064b6c7d274082aa5d2624709bc9ae7d16c771111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000003a79839b12bfca5a55806aaf64e99521918a4bf0fc4080200a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c20e3520349f477a5f6eb06107066048508498a291b3f239d83af94f836b93910d29704def88542e2a76ae40711b8002dc6c03f239d83af94f836b93910d29704def88542e2a763da4db6ef4e7c62168ab03982399f9588fcd198000000000000000000000000000000000000000000000000012816f0752182f6e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd19803b666f3488a7992b2385b12df7f35156d7b29cd0000000000000000000000000000000000000000003f561c5017145cc53f56fdc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae40711b8002dc6c003b666f3488a7992b2385b12df7f35156d7b29cd1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000005f9a1abc42c30ac6cc15fac9bd938618bcaa1a1fae8501d00000000000000000000cfee7c08`
                tokensData[2] = `0x12aa3caf0000000000000000000000004e66794586cc9c53a8c604d77b4ce3d39b1cff7c000000000000000000000000e3520349f477a5f6eb06107066048508498a291b0000000000000000000000005183e1b1091804bc2602586919e6880ac1cf28960000000000000000000000003f239d83af94f836b93910d29704def88542e2a7000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef50000000000000000000000000000000000000000000000000000392d3cf51fa7961c50000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000015900a007e5c0d20000000000000000000000000000000000000000000001350000ce00006700206ae40711b8002dc6c03f239d83af94f836b93910d29704def88542e2a763da4db6ef4e7c62168ab03982399f9588fcd19800000000000000000000000000000000000000000000000001f08dd5d6c504c7e3520349f477a5f6eb06107066048508498a291b00206ae40711b8002dc6c063da4db6ef4e7c62168ab03982399f9588fcd198a36df7c571beba7b3fb89f25dfc990eac75f525a0000000000000000000000000000000000000000006a2aec074e7f0d22943a7bc9bdeed33cd01541e1eed10f90519d2c06fe3feb00206ae40711b8002dc6c0a36df7c571beba7b3fb89f25dfc990eac75f525a1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000392d3cf51fa7961c5c42c30ac6cc15fac9bd938618bcaa1a1fae8501d000000000000000000cfee7c08`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = (await MasterChef.userInfo(pid, farm.address)).amount
                }
                stakeLPBefore = await assetRouter.userStake(DAIHolder, pool)

                totalDepositsLPBefore = await assetRouter.totalDeposits(pool)
            })
            it('fires events', async () => {
                const receipt = await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, tokensData, 0, DAIHolder, { from: DAIHolder })

                expectEvent(receipt, 'Deposit', { lpPool: pool, sender: DAIHolder, recipient: DAIHolder })
            })
            it('withdraws tokens from balance', async () => {
                const tokenBalanceAfter = await DAIToken.balanceOf(DAIHolder)
                const tokenDiff = tokenBalanceBefore.sub(tokenBalanceAfter)

                approxeq(tokenDiff, DAIAmount, new BN(0), 'Amount Tokens Sent is not correct')
            })
            it('updates stakes', async () => {
                const stakeLP = await assetRouter.userStake(DAIHolder, pool)
                assert.ok(stakeLP.gt(stakeLPBefore), 'LP stake not increased')
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.ok(totalDepositsLP.gt(totalDepositsLPBefore), 'totalDeposits not increased')
            })
            it('stakes tokens in MasterChef contract', async () => {
                const farmAddress = await factory.Farms(pool)
                const farm = await Farm.at(farmAddress)

                const stakingRewardBalance = new BN((await MasterChef.userInfo(pid, farm.address)).amount)
                assert.ok(stakingRewardBalance.gt(stakingRewardsBalanceBefore), 'MasterChef balance not increased')
            })
        })
    })
})
