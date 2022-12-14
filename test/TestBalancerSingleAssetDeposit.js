const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const fetch = require('node-fetch')

const DQuickHolder = '0xcf0b86f9944a60a0ba22b51a33c11d9e4de1ce9f'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1
const DAIHolder = '0x06959153B974D0D5fDfd87D561db6d8d4FA0bb0B'// has to be unlocked and hold 0xf28164A485B0B2C90639E47b0f377b4a438a16B1
const stakingRewardsOwner = '0x476307dac3fd170166e007fcaa14f0a129721463'// has to be unlocked

const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IGauge = artifacts.require('IGauge')
const IBasePool = artifacts.require('IBasePool')
const IVault = artifacts.require('IVault')

const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')

const Farm = artifacts.require('UnoFarmBalancer')
const AssetRouter = artifacts.require('UnoAssetRouterBalancer')
const AssetRouterV2 = artifacts.require('UnoAssetRouterBalancerV2')

const balancerVault = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
const gaugeFactoryAddress = '0x3b8cA519122CdD8efb272b0D3085453404B25bD0'

const pool = '0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D' // WMATIC-stMATIC

const account1 = '0x70D04384b5c3a466EC4D8CFB8213Efc31C6a9D15'// has to be unlocked and hold 0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D

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
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager; let assetRouter; let
        factory

    let stakingToken

    const initReceipt = {}

    let poolId; let
        gauge

    let Vault
    let tokens; let
        zeroAmounts

    const tokenContracts = []

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
            let tokensData

            before(async () => {
                const fromToken = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'

                DAIToken = await IUniswapV2Pair.at(fromToken)
                const DAIHolderBalance = await DAIToken.balanceOf(DAIHolder)
                tokenBalanceBefore = DAIHolderBalance

                DAIAmount = new BN('1000000000000000000000') // 1000$

                await DAIToken.approve(assetRouter.address, DAIAmount, { from: DAIHolder }) // change

                tokensData = []
                for (let i = 0; i < tokens.length; i++) {
                    const tokenSwapParams = swapParams(DAIToken.address, tokens[i], DAIAmount.div(new BN(tokens.length)).toString(), assetRouter.address)
                    const tokenData = await fetchData(tokenSwapParams)
                    tokensData.push(tokenData)
                }

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
                const receipt = await assetRouter.depositSingleAsset(pool, DAIToken.address, DAIAmount, tokensData, tokens, 0, 0, DAIHolder, { from: DAIHolder })

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
            let tokensData

            before(async () => {
                const fromToken = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'

                amountETH = new BN('1000000000000000000') // 1 ether

                tokensData = []
                for (let i = 0; i < tokens.length; i++) {
                    let tokenData
                    if (fromToken !== tokens[i]) {
                        const tokenSwapParams = swapParams(fromToken, tokens[i], amountETH.div(new BN(tokens.length)).toString(), assetRouter.address)
                        tokenData = await fetchData(tokenSwapParams)
                    } else {
                        tokenData = '0x'
                    }
                    tokensData.push(tokenData)
                }
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
                const receipt = await assetRouter.depositSingleETH(pool, constants.ZERO_ADDRESS, amountETH, tokensData, tokens, 0, 0, DAIHolder, { from: DAIHolder, value: amountETH })

                const gasUsed = new BN(receipt.receipt.gasUsed)
                const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)

                ethSpentOnGas = gasUsed.mul(effectiveGasPrice)

                expectEvent(receipt, 'Deposit', { lpPool: pool, sender: DAIHolder, recipient: DAIHolder })
            })
            it('withdraws ETH from balance', async () => {
                const ethBalanceAfter = new BN(await web3.eth.getBalance(DAIHolder))

                const ethDiff = ethBalanceBefore.sub(ethBalanceAfter).sub(ethSpentOnGas) // вот этот тест немного странный, не могу понять, почему возвращяет другое значение ETHDiff (мейби там ебанутое соотношение токенов в пуле)
                console.log(ethDiff.toString())

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
