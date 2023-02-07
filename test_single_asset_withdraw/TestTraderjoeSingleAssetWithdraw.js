const {
    expectEvent, BN
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmTraderjoe')
const AssetRouter = artifacts.require('UnoAssetRouterTraderjoe')

const pool = '0xf4003F4efBE8691B60249E6afbD307aBE7758adb' // wAVAX-USDC

const DAIHolder = '0xd699571A57D3Efe7c50369Fb5350448FA1ad246E'// has to be unlocked and hold 0xd586E7F844cEa2F87f50152665BCbc2C279D8d70

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterTraderjoeSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter

    before(async () => {
        const implementation = await Farm.new({ from: admin })
        accessManager = await AccessManager.new({ from: admin })// accounts[0] is admin
        assetRouter = await deployProxy(AssetRouter, { kind: 'uups', initializer: false })
        await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, { from: admin })
        DAIToken = await IUniswapV2Pair.at('0xd586E7F844cEa2F87f50152665BCbc2C279D8d70')
    })

    describe('Single Asset Withdraw', () => {
        describe('withdraw token', () => {
            let stakeLPBefore
            let tokenBalanceBefore

            before(async () => {
                const DAIAmount = new BN('1000000000000000000000') // 1000$
                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder })
                const tokenAData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000018650127cc3dc800000000000000000000000000000000000000000000000000009acc9522e35c1ee2000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f50000000000000000000000000000000000000000000000000000000001d700a0c9e75c48000000000000000008020000000000000000000000000000000000000000000000000001a900011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d70a6908c7e3be8f4cd2eb704b5cb73583ebf56ee626ae4071138002dc6c0a6908c7e3be8f4cd2eb704b5cb73583ebf56ee62ed8cbd9f0ce3c6986b22002f03c6475ceb7a62560000000000000000000000000000000000000000000000000000000002aa4276d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae4071138002dc6c0ed8cbd9f0ce3c6986b22002f03c6475ceb7a62561111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000001ee7f5868344f170c7198437980c041c805a1edcba50c1ce5db951180c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae4071138002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86a1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000007be49f9c60172d71d586e7f844cea2f87f50152665bcbc2c279d8d700000000000000000000000cfee7c08`
                const tokenBData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000018650127cc3dc80000000000000000000000000000000000000000000000000000000000000d439b760000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000026200a0c9e75c480000000000000000080200000000000000000000000000000000000000000000000000023400011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7063abe32d0ee76c05a11838722a63e012008416e66ae4071138002dc6c063abe32d0ee76c05a11838722a63e012008416e62a8a315e82f85d1f0658c5d66a452bbdd93567830000000000000000000000000000000000000000000000000000000002a95f43d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae40711b8002dc6c02a8a315e82f85d1f0658c5d66a452bbdd93567831111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000002a7238da7d7079b0fead91f3e65f86e8915cb59c1a4c66400a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae4071138002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86af4003f4efbe8691b60249e6afbd307abe7758adb0000000000000000000000000000000000000000000000007be49f9c60172d71d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae40711b8002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000a9c77e9b31f66aa3c1e785363f0875a1b74e27b85fd66c7cfee7c08`
                await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, [tokenAData, tokenBData], 0, 0, DAIHolder, { from: DAIHolder })

                tokenBalanceBefore = await DAIToken.balanceOf(DAIHolder);
                ({
                    stakeLP: stakeLPBefore,
                    stakeA,
                    stakeB
                } = await assetRouter.userStake(DAIHolder, pool))
            })
            it('fires events', async () => {
                const tokenAData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d7000000000000000000000000087dee1cc9ffd464b79e058ba20387c1984aed86a000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000000a688906bd8b000000000000000000000000000000000000000000000000000067c909d5891ad25030000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae40711b8002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86a1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000067c909d5891ad2503b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000000000000000000000000000000000cfee7c08`
                const tokenBData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000f4003f4efbe8691b60249e6afbd307abe7758adb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000000000000000bebc2000000000000000000000000000000000000000000000000056305e94cad163f81000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001100000000000000000000000000000000000000000000000000000000000f200a007e5c0d20000000000000000000000000000000000000000000000000000ce00006700206ae4071138002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb87dee1cc9ffd464b79e058ba20387c1984aed86a000000000000000000000000000000000000000000000000451ddf7fb868e5d5b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e00206ae40711b8002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86a1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000056305e94cad163f81b31f66aa3c1e785363f0875a1b74e27b85fd66c700000000000000000000000000000000cfee7c08`

                const receipt = await assetRouter.withdrawSingleAsset(pool, stakeLPBefore, DAIToken.address, [tokenAData, tokenBData], DAIHolder, { from: DAIHolder })
                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool, sender: DAIHolder, recipient: DAIHolder, amount: stakeLPBefore
                })
            })
            it('deposits tokens to balance', async () => {
                const tokenBalanceAfter = await DAIToken.balanceOf(DAIHolder)

                const tokenDiff = tokenBalanceAfter.sub(tokenBalanceBefore)
                assert.ok(tokenDiff.gt(new BN(0)), 'Dai Balance not increased')
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(DAIHolder, pool)
                assert.equal(stakeLP.toString(), '0', 'Stake not withdrawn')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(totalDepositsLP.toString(), '0', 'Stake not withdrawn')
            })
        })
        describe('withdraw ETH', () => {
            let stakeLPBefore
            let ethBalanceBefore
            let ethSpentOnGas

            before(async () => {
                const DAIAmount = new BN('1000000000000000000000') // 1000$
                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder })
                const tokenAData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000018650127cc3dc800000000000000000000000000000000000000000000000000009acc9522e35c1ee2000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f50000000000000000000000000000000000000000000000000000000001d700a0c9e75c48000000000000000008020000000000000000000000000000000000000000000000000001a900011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d70a6908c7e3be8f4cd2eb704b5cb73583ebf56ee626ae4071138002dc6c0a6908c7e3be8f4cd2eb704b5cb73583ebf56ee62ed8cbd9f0ce3c6986b22002f03c6475ceb7a62560000000000000000000000000000000000000000000000000000000002aa4276d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae4071138002dc6c0ed8cbd9f0ce3c6986b22002f03c6475ceb7a62561111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000001ee7f5868344f170c7198437980c041c805a1edcba50c1ce5db951180c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae4071138002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86a1111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000007be49f9c60172d71d586e7f844cea2f87f50152665bcbc2c279d8d700000000000000000000000cfee7c08`
                const tokenBData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000d586e7f844cea2f87f50152665bcbc2c279d8d70000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000018650127cc3dc80000000000000000000000000000000000000000000000000000000000000d439b760000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000028000000000000000000000000000000000000000000000000000000000026200a0c9e75c480000000000000000080200000000000000000000000000000000000000000000000000023400011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7063abe32d0ee76c05a11838722a63e012008416e66ae4071138002dc6c063abe32d0ee76c05a11838722a63e012008416e62a8a315e82f85d1f0658c5d66a452bbdd93567830000000000000000000000000000000000000000000000000000000002a95f43d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae40711b8002dc6c02a8a315e82f85d1f0658c5d66a452bbdd93567831111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000000000002a7238da7d7079b0fead91f3e65f86e8915cb59c1a4c66400a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c20d586e7f844cea2f87f50152665bcbc2c279d8d7087dee1cc9ffd464b79e058ba20387c1984aed86a6ae4071138002dc6c087dee1cc9ffd464b79e058ba20387c1984aed86af4003f4efbe8691b60249e6afbd307abe7758adb0000000000000000000000000000000000000000000000007be49f9c60172d71d586e7f844cea2f87f50152665bcbc2c279d8d7000206ae40711b8002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000000000000a9c77e9b31f66aa3c1e785363f0875a1b74e27b85fd66c7cfee7c08`
                await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, [tokenAData, tokenBData], 0, 0, DAIHolder, { from: DAIHolder })

                ethBalanceBefore = new BN(await web3.eth.getBalance(DAIHolder));
                ({
                    stakeLP: stakeLPBefore
                } = await assetRouter.userStake(DAIHolder, pool))
            })
            it('fires events', async () => {
                const tokenAData = '0x'
                const tokenBData = `0x12aa3caf000000000000000000000000f01ef4051130cc8871fa0c17024a6d62e379e856000000000000000000000000b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000b31f66aa3c1e785363f0875a1b74e27b85fd66c7000000000000000000000000f4003f4efbe8691b60249e6afbd307abe7758adb000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}000000000000000000000000000000000000000000000000000000000bebc200000000000000000000000000000000000000000000000000451ddf7fb868e5d50000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c0f4003f4efbe8691b60249e6afbd307abe7758adb1111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000451ddf7fb868e5d5b97ef9ef8734c71904d8002f8b6bc66dd9c48a6e000000000000000000000000000000000000000000000000000000cfee7c08`
                const receipt = await assetRouter.withdrawSingleETH(pool, stakeLPBefore, [tokenAData, tokenBData], DAIHolder, { from: DAIHolder })

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                ethSpentOnGas = gasUsed.mul(effectiveGasPrice)

                expectEvent(receipt, 'Withdraw', {
                    lpPool: pool, sender: DAIHolder, recipient: DAIHolder, amount: stakeLPBefore
                })
            })
            it('withdraws ETH from balance', async () => {
                const ethBalanceAfter = new BN(await web3.eth.getBalance(DAIHolder))

                const ethDiff = ethBalanceAfter.sub(ethBalanceBefore.add(ethSpentOnGas))
                assert.ok(ethDiff.gt(new BN(0)), 'Eth Balance not increased')
            })
            it('updates stakes', async () => {
                const { stakeLP } = await assetRouter.userStake(DAIHolder, pool)
                assert.equal(stakeLP.toString(), '0', 'Stake not withdrawn')
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(totalDepositsLP.toString(), '0', 'Stake not withdrawn')
            })
        })
    })
})
