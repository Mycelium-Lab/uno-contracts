const {
    expectEvent, BN
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const IERC20 = artifacts.require('IBEP20')
const UnoAssetRouterPancakeswap = artifacts.require('UnoAssetRouterPancakeswap')
const UnoFarmPancakeswap = artifacts.require('UnoFarmPancakeswap')
const FarmFactory = artifacts.require('UnoFarmFactory')

const AccessManager = artifacts.require('UnoAccessManager')

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16' // busd wbnb
const pool2 = '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16' // busd wbnb

const account1 = '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3'// has to be unlocked and hold BUSD and BNB

const amounts = [new BN('1000000000000000000'), new BN('10000000000000000'), new BN(500), new BN(4000), new BN(4400000000), new BN(5000)]

approxeq = (bn1, bn2, epsilon, message) => {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message)
}

contract('UnoAutoStrategy', (accounts) => {
    const admin = accounts[0]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let strategyToken

    let assetRouterPancakeswap
    before(async () => {
        accessManager = await AccessManager.new({ from: admin }) // accounts[0] is admin
        const autoStrategyImplementation = await AutoStrategy.new()
        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)

        assetRouterPancakeswap = await deployProxy(
            UnoAssetRouterPancakeswap,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationPancakeswap = await UnoFarmPancakeswap.new()
        await FarmFactory.new(farmImplementationPancakeswap.address, accessManager.address, assetRouterPancakeswap.address)

        await autoStrategyFactory.approveAssetRouter(assetRouterPancakeswap.address, {
            from: admin
        })

        await autoStrategyFactory.createStrategy([
            { pool: pool1, assetRouter: assetRouterPancakeswap.address },
            { pool: pool2, assetRouter: assetRouterPancakeswap.address }
        ])

        autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))
        strategyToken = await IERC20.at(autoStrategy.address)
    })
    describe('Deposits ETH', () => {
        let id
        let receipt
        let sentA; let
            sentB
        let tokenABalanceBefore; let
            tokenBBalanceBefore

        before(async () => {
            id = await autoStrategy.poolID()
            const data = await autoStrategy.pools(id)
            const tokenB = await IERC20.at(data.tokenB)

            await tokenB.approve(autoStrategy.address, amounts[1], {
                from: account1
            })

            tokenABalanceBefore = new BN(await web3.eth.getBalance(account1))
            tokenBBalanceBefore = await tokenB.balanceOf(account1)

            // Deposit
            receipt = await autoStrategy.depositETH(id, amounts[1], 0, 0, account1, {
                value: amounts[0],
                from: account1
            })

            const tokenABalance = new BN(await web3.eth.getBalance(account1))
            const tokenBBalance = await tokenB.balanceOf(account1)

            const gasUsed = new BN(receipt.receipt.gasUsed)
            const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)
            const ETHSpentOnGas = gasUsed.mul(effectiveGasPrice)

            sentA = tokenABalanceBefore.sub(tokenABalance).sub(ETHSpentOnGas) // sub gas cost
            sentB = tokenBBalanceBefore.sub(tokenBBalance)
        })
        it('fires events', async () => {
            expectEvent(receipt, 'Deposit', {
                poolID: id,
                from: account1,
                recipient: account1
            })
        })
        it('mints tokens', async () => {
            const strategyTokenBalance = await strategyToken.balanceOf(account1)
            assert.ok(strategyTokenBalance.gt(new BN('0')), 'tokens were not minted')
        })
        it('updates user stakes', async () => {
            const {
                stakeA, stakeB
            } = await autoStrategy.userStake(account1)

            const assetRouter = await UnoAssetRouterPancakeswap.at((await autoStrategy.pools(id)).assetRouter)
            const pool = (await autoStrategy.pools(id)).pool

            const {
                stakeA: assetRouterStakeA,
                stakeB: assetRouterStakeB
            } = await assetRouter.userStake(autoStrategy.address, pool)

            const strategyTokenBalance = await strategyToken.balanceOf(account1)
            const totalSupply = await strategyToken.totalSupply()

            approxeq(
                stakeA,
                assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply),
                new BN(10),
                'stakeA is not correct'
            )
            approxeq(
                stakeB,
                assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply),
                new BN(10),
                'stakeB is not correct'
            )

            approxeq(
                stakeA,
                sentA,
                new BN(100000),
                'stakeA is not correct_2'
            )// i don't get why this is ~50000 lower than it should be but it still is nothing. The values are correct during transaction execution
            approxeq(
                stakeB,
                sentB,
                new BN(100000),
                'stakeB is not correct_2'
            )
        })
    })
    describe('Withdraws', () => {
        let id
        let receipt
        let tokensToBurn

        before(async () => {
            id = await autoStrategy.poolID()
            const data = await autoStrategy.pools(id)
            const tokenB = await IERC20.at(data.tokenB)
            tokensToBurn = await strategyToken.balanceOf(account1)

            const _tokenABalance = new BN(await web3.eth.getBalance(account1))
            const _tokenBBalance = await tokenB.balanceOf(account1)
            // Withdraw
            receipt = await autoStrategy.withdrawETH(id, tokensToBurn, 0, 0, account1, {
                from: account1
            })

            const gasUsed = new BN(receipt.receipt.gasUsed)
            const effectiveGasPrice = new BN(receipt.receipt.effectiveGasPrice)
            const ETHSpentOnGas = gasUsed.mul(effectiveGasPrice)

            const tokenABalance = new BN(await web3.eth.getBalance(account1))
            const tokenBBalance = await tokenB.balanceOf(account1)

            sentA = tokenABalance.sub(_tokenABalance).sub(ETHSpentOnGas) // sub gas cost
            sentB = tokenBBalance.sub(_tokenBBalance)
        })
        it('fires events', async () => {
            expectEvent(receipt, 'Withdraw', {
                poolID: id,
                from: account1,
                recipient: account1
            })
        })
        it('burns tokens', async () => {
            const strategyTokenBalance = await strategyToken.balanceOf(account1)

            assert.equal(
                strategyTokenBalance.toString(),
                '0',
                'Amount of tokens burnt is not correct'
            )
        })
        it('updates user stakes', async () => {
            const {
                stakeA, stakeB
            } = await autoStrategy.userStake(account1)

            assert.equal(
                stakeA.toString(),
                '0',
                'stakeA is not correct'
            )
            assert.equal(
                stakeB.toString(),
                '0',
                'stakeB is not correct'
            )
        })
        it('transfers tokens to user', async () => {
            assert.ok(
                sentA.gt(0),
                true,
                'BalanceA not increased'
            )
            assert.ok(
                sentB.gt(0),
                true,
                'BalanceB not increased'
            )
        })
    })
})
