const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const fetch = require('node-fetch')

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
            const tokensData = []

            before(async () => {
                const fromToken = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokensData[0] = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000f5c3455d30458e9a1128f85941f533834f01d8b6000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef500000000000000000000000000000000000000000000000000022273a3b40943f2be5000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e40000000000000000000000000000000000000000000000000000c600009800a007e5c0d200000000000000000000000000000000000000000000000000007400003a4020f5c3455d30458e9a1128f85941f533834f01d8b6bd6015b4000000000000000000000000a71415675f68f29259ddd63215e5518d2735bf0a4020a71415675f68f29259ddd63215e5518d2735bf0add93f59a0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf80a06c4eca270d500b1d8e8ef31e21c99d1db9a6444d3adf12701111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000000000000000000cfee7c08`// await fetchData(tokenASwapParams)
                tokensData[1] = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a0630000000000000000000000003a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4000000000000000000000000f04adbf75cdfc5ed26eea4bbbb991db002036bdd000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000001b1ae4d6e2ef5000000000000000000000000000000000000000000000000000104c39798e0533948b0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000015900a007e5c0d20000000000000000000000000000000000000000000001350000ce00006700206ae40711b8002dc6c0f04adbf75cdfc5ed26eea4bbbb991db002036bdd6e7a5fafcec6bb1e78bae2a1f0b612012bf14827000000000000000000000000000000000000000000000000000000000ed7757c8f3cf7ad23cd3cadbd9735aff958023239c6a06300206ae40711b8002dc6c06e7a5fafcec6bb1e78bae2a1f0b612012bf1482765752c54d9102bdfd69d351e1838a1be83c924c60000000000000000000000000000000000000000000000114959e6820e569a8c2791bca1f2de4661ed88a30c99a7a9449aa8417400206ae4071138002dc6c065752c54d9102bdfd69d351e1838a1be83c924c61111111254eeb25477b68fb85ed929f73a9605820000000000000000000000000000000000000000000000104c39798e0533948b0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000cfee7c08`

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
                const receipt = await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, tokensData, tokens, 0, DAIHolder, { from: DAIHolder })

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
        })
        describe('deposit ETH', () => {
            let stakeLPBefore
            let totalDepositsLPBefore
            let ethBalanceBefore
            const tokensData = []

            before(async () => {
                const fromToken = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
                amountETH = new BN('1000000000000000000') // 1 ether

                tokensData[0] = '0x'
                tokensData[1] = `0x12aa3caf0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf12700000000000000000000000003a58a54c066fdc0f2d55fc9c89f0415c92ebf3c400000000000000000000000065752c54d9102bdfd69d351e1838a1be83c924c6000000000000000000000000${assetRouter.address.substring(2).toLowerCase()}00000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000067d92de48747e8f0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008500000000000000000000000000000000000000000000000000000000006700206ae4071138002dc6c065752c54d9102bdfd69d351e1838a1be83c924c61111111254eeb25477b68fb85ed929f73a960582000000000000000000000000000000000000000000000000067d92de48747e8f0d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000cfee7c08`

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
                const receipt = await assetRouter.depositSingleETH(pool, tokensData, tokens, 0, DAIHolder, { from: DAIHolder, value: amountETH })

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
        })
    })
})
