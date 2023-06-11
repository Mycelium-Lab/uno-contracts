const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1

const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IBasePool = artifacts.require('IBasePool')
const IVault = artifacts.require('IVault')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmBalancer')
const AssetRouter = artifacts.require('UnoAssetRouterBalancer')

const balancerVault = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
const gaugeFactoryAddress = '0x3b8cA519122CdD8efb272b0D3085453404B25bD0'

const pool = '0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D' // WMATIC-stMATIC
const feeCollector = '0x46a3A41bd932244Dd08186e4c19F1a7E48cbcDf4'
approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAssetRouterBalancerSingleAssetDeposit', (accounts) => {
    const admin = accounts[0]

    let accessManager; let assetRouter; let
        factory

    const initReceipt = {}

    let poolId; let
        gauge

    let Vault
    let tokens

    const tokenContracts = []

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

        const gaugeFactory = await IGaugeFactory.at(gaugeFactoryAddress)
        const gaugeAddress = await gaugeFactory.getPoolGauge(pool)
        gauge = await IUniswapV2Pair.at(gaugeAddress) // this is not a IUniswapV2Pair, however the abi is sufficient for our purposes

        const poolContract = await IBasePool.at(pool)
        poolId = await poolContract.getPoolId()

        stakingToken = await IUniswapV2Pair.at(pool) // this is not a IUniswapV2Pair, however the abi is sufficient for our purposes
        Vault = await IVault.at(balancerVault)

        tokens = (await Vault.getPoolTokens(poolId)).tokens
        zeroAmounts = new Array(tokens.length).fill(0)

        for (let i = 0; i < tokens.length; i++) {
            tokenContracts.push(await IUniswapV2Pair.at(tokens[i])) // should be ERC20 but IUniswapV2Pair has everything we need
        }
    })

    describe('Single Asset Deposit', () => {
        describe('deposit token', () => {
            let stakeLPBefore
            let totalDepositsLPBefore
            let DAIToken
            let DAIAmount
            let tokenBalanceBefore
            let feeBalanceBefore
            const tokensData = []

            before(async () => {
                const fromToken = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                feeBalanceBefore = await DAIToken.balanceOf(feeCollector)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokensData[0] = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded10000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000017749e235429b60633000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002e80000000000000000000000000000000000000000000002ca00006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a06300a0c9e75c480000000000000000080200000000000000000000000000000000000000000000000000023400011a00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a06359153f27eefe07e5ece4f9304ebba1da6f53ca886ae40711b8002dc6c059153f27eefe07e5ece4f9304ebba1da6f53ca88604229c960e5cacf2aaeac8be68ac07ba9df81c30000000000000000000000000000000000000000000000000000000002f03a7b8f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae4071138002dc6c0604229c960e5cacf2aaeac8be68ac07ba9df81c31111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000004b0e2c39e09c4c8c2c2132d05d31c914a87c6611c10748aeb04b58e8f00a007e5c0d20000000000000000000000000000000000000000000000000000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd6e7a5fafcec6bb1e78bae2a1f0b612012bf14827000000000000000000000000000000000000000000000000000000000bc36d5e8f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae4071138002dc6c06e7a5fafcec6bb1e78bae2a1f0b612012bf148271111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000012c3bb5fb61ff13d712791bca1f2de4661ed88a30c99a7a9449aa84174000000000000000000000000000000000000000000000000b4eb6cb3`// await fetchData(tokenASwapParams)
                tokensData[1] = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded10000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000003a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000015afd9c090316d9d3b000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002070000000000000000000000000000000000000000000001e900006800004e80206c4eca278f3cf7ad23cd3cadbd9735aff958023239c6a06346a3a41bd932244dd08186e4c19f1a7e48cbcdf40000000000000000000000000000000000000000000000004563918244f400000020d6bdbf788f3cf7ad23cd3cadbd9735aff958023239c6a06300a007e5c0d200000000000000000000000000000000000000000000015d0000f600008f0c208f3cf7ad23cd3cadbd9735aff958023239c6a063f04adbf75cdfc5ed26eea4bbbb991db002036bdd6ae4071138002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd6e7a5fafcec6bb1e78bae2a1f0b612012bf14827000000000000000000000000000000000000000000000000000000000eb3d9d18f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae4071138002dc6c06e7a5fafcec6bb1e78bae2a1f0b612012bf1482765752c54d9102bdfd69d351e1838a1be83c924c6000000000000000000000000000000000000000000000017735b5af76f90565e2791bca1f2de4661ed88a30c99a7a9449aa8417400206ae40711b8002dc6c065752c54d9102bdfd69d351e1838a1be83c924c61111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000015afd9c090316d9d3b0d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000b4eb6cb3`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await gauge.balanceOf(farm.address)
                }
                stakeLPBefore = await assetRouter.userStake(DAIHolder, pool)

                totalDepositsLPBefore = await assetRouter.totalDeposits(pool)
            })
            it('fires events', async () => {
                const receipt = await assetRouter.depositWithSwap(pool, tokensData, 0, DAIHolder, { from: DAIHolder })

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
            it('stakes tokens in Gauge contract', async () => {
                const farmAddress = await factory.Farms(pool)
                const farm = await Farm.at(farmAddress)
                const stakingRewardBalance = await gauge.balanceOf(farm.address)
                assert.ok(stakingRewardBalance.gt(stakingRewardsBalanceBefore), 'Gauge balance not increased')
            })
            it('collects fee', async () => {
                const feeBalanceAfter = await DAIToken.balanceOf(feeCollector)
                assert.ok(feeBalanceAfter.gt(feeBalanceBefore), 'fee balance not increased')
            })
        })
        describe('deposit ETH', () => {
            let stakeLPBefore
            let totalDepositsLPBefore
            let ethBalanceBefore
            let feeBalanceBefore
            const tokensData = []

            before(async () => {
                const fromToken = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
                amountETH = new BN('1000000000000000000') // 1 ether

                tokensData[0] = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000036f4bf04de8c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b200000000000000000000000000000000000000009400004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b940610d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db080206c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf12701111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000006de97e09bd180000000000000000000000000000000b4eb6cb3`
                tokensData[1] = `0x12aa3caf000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000003a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4000000000000000000000000cfd674f8731e801a4a15c1ae31770960e1afded1000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000000000000000000000000000000331e24744121a4e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f30000000000000000000000000000000000000000d500004600002c000026e02146a3a41bd932244dd08186e4c19f1a7e48cbcdf400000000000000000011c37937e0800000206b4be0b940410d500b1d8e8ef31e21c99d1db9a6444d3adf1270d0e30db00c200d500b1d8e8ef31e21c99d1db9a6444d3adf127065752c54d9102bdfd69d351e1838a1be83c924c66ae40711b8002dc6c065752c54d9102bdfd69d351e1838a1be83c924c61111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000000331e24744121a4e0d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000b4eb6cb3`

                const farmAddress = await factory.Farms(pool)

                if (farmAddress === constants.ZERO_ADDRESS) {
                    stakingRewardsBalanceBefore = new BN(0)
                } else {
                    const farm = await Farm.at(farmAddress)
                    stakingRewardsBalanceBefore = await gauge.balanceOf(farm.address)
                }
                stakeLPBefore = await assetRouter.userStake(DAIHolder, pool)

                totalDepositsLPBefore = await assetRouter.totalDeposits(pool)
            })
            it('fires events', async () => {
                ethBalanceBefore = new BN(await web3.eth.getBalance(DAIHolder))
                feeBalanceBefore = new BN(await web3.eth.getBalance(feeCollector))
                const receipt = await assetRouter.depositWithSwap(pool, tokensData, 0, DAIHolder, { from: DAIHolder, value: amountETH })

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
                const stakeLP = await assetRouter.userStake(DAIHolder, pool)
                assert.ok(stakeLP.gt(stakeLPBefore), 'LP stake not increased')
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.ok(totalDepositsLP.gt(totalDepositsLPBefore), 'totalDeposits not increased')
            })
            it('stakes tokens in Gauge contract', async () => {
                const farmAddress = await factory.Farms(pool)
                const farm = await Farm.at(farmAddress)
                const stakingRewardBalance = await gauge.balanceOf(farm.address)
                assert.ok(stakingRewardBalance.gt(stakingRewardsBalanceBefore), 'Gauge balance not increased')
            })
            it('collects fee', async () => {
                const feeBalanceAfter = new BN(await web3.eth.getBalance(feeCollector))
                assert.ok(feeBalanceAfter.gt(feeBalanceBefore), 'fee balance not increased')
            })
        })
    })
})
