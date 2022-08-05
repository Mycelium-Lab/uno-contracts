const { expectRevert, expectEvent, BN, constants, time } = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')


const IERC20 = artifacts.require("IERC20")
const IUnoAssetRouter = artifacts.require("IUnoAssetRouter")

const AccessManager = artifacts.require('UnoAccessManager') 

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = "0xafb76771c98351aa7fca13b130c9972181612b54" // usdt-usdc quickswap
const pool2 = "0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001" // usdt-usdc sushiswap

const assetRouter1 = "0xF5AE5c5151aE25019be8b328603C18153d669461" // quickswap
const assetRouter2 = "0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8" // sushiswap

const account1 = "0x477b8D5eF7C2C42DB84deB555419cd817c336b6F" // -u
const account2 = "0x72A53cDBBcc1b9efa39c834A540550e23463AAcB" // -u
const account3 = "0x7EF2D7B88D43F1831241F0dD63E0bdeF048Ba8aC" // -u

const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(4400000000), new BN(5000)]

approxeq = function(bn1, bn2, epsilon, message) {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message);
}

contract('UnoAutoStrategy', accounts => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]

    let accessManager

    let autoStrategyFactory
    let autoStrategy

    let strategyToken
    let snapshotId
    before(async () => {

        accessManager = await AccessManager.new({from: admin}) //accounts[0] is admin

        await accessManager.grantRole('0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f', liquidityManager, {from: admin}) //DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {from: admin}) //PAUSER_ROLE

        const autoStrategyImplementation = await AutoStrategy.new()

        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)

        await autoStrategyFactory.approveAssetRouter(assetRouter1, {from: admin})
        await autoStrategyFactory.approveAssetRouter(assetRouter2, {from: admin})
  
        await autoStrategyFactory.createStrategy([{pool: pool1, assetRouter: assetRouter1}, {pool: pool2, assetRouter: assetRouter2}])

        autoStrategy = await AutoStrategy.at(await autoStrategyFactory.autoStrategies(0))

        strategyToken = await IERC20.at(autoStrategy.address)

        let snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot['result']
    })

    describe('Deposits', () => {
        describe('reverts', () => {
            it('reverts if provided with the wrong poolID', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevert(
                    autoStrategy.deposit(poolID.add(new BN(1)), 0, 0, 0, 0, account1, {from: account1}),
                    "BAD_POOL_ID"
                )
            })
        })
        describe('deposit tokens', () => {
            let id
            let receipt
            let sentA, sentB
            let tokenABalanceBefore, tokenBBalanceBefore
            let totalDepositsABefore, totalDepositsBBefore
            let strategyTokenBalanceBefore
            before(async () => {
                id = await autoStrategy.poolID()
    
                const data = await autoStrategy.pools(id)
    
                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])
    
                let tokenABalance = await tokenA.balanceOf(account1)
                let tokenBBalance = await tokenB.balanceOf(account1)

                tokenABalanceBefore = tokenABalance
                tokenBBalanceBefore = tokenBBalance
    
                await tokenA.approve(autoStrategy.address, amounts[1], {from: account1})
                await tokenB.approve(autoStrategy.address, amounts[1], {from: account1})

                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                strategyTokenBalanceBefore = await strategyToken.balanceOf(account1)

                // Deposit
                receipt = await autoStrategy.deposit(id, amounts[1], amounts[1], 0, 0, account1, {from: account1})

                tokenABalance = await tokenA.balanceOf(account1)
                tokenBBalance = await tokenB.balanceOf(account1)

                sentA = tokenABalanceBefore.sub(tokenABalance)
                sentB = tokenBBalanceBefore.sub(tokenBBalance)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {poolID: id, from: account1, recipient: account1})
            })
            it('mints tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                assert.ok(strategyTokenBalance.gt(strategyTokenBalanceBefore), "tokens were not minted")
            })
            it('updates user stakes', async () => {
                const {stakeA, stakeB, leftoverA, leftoverB} = await autoStrategy.userStake(account1)

                const assetRouter = await IUnoAssetRouter.at((await autoStrategy.pools(id))["assetRouter"])
                const pool = (await autoStrategy.pools(id))["pool"]

                const {stakeLP: assetRouterStakeAStakeLP, stakeA: assetRouterStakeA, stakeB: assetRouterStakeB} = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(stakeA, assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply), new BN(10), "stakeA is not correct")
                approxeq(stakeB, assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply), new BN(10), "stakeB is not correct")

            })
            it('updates total deposits', async () => {
                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()
                
                approxeq(totalDepositsA.sub(totalDepositsABefore), sentA, new BN(10), "totalDepositsA is not correct")
                approxeq(totalDepositsB.sub(totalDepositsBBefore), sentB, new BN(10), "totalDepositsB is not correct")   
            })
        })
        describe('deposit tokens from multiple accounts', () => {
            let id
            let totalDepositsABefore, totalDepositsBBefore
            let strategyTokenBalancesBefore = []

            let sentA = []
            let sentB = []
            const testAccounts = [account2, account3]
            let txs = []
            before(async () => {
                id = await autoStrategy.poolID()
    
                const data = await autoStrategy.pools(id)
    
                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])

                let tokenABalancesBefore = []
                let tokenBBalancesBefore = []

                for (let i = 0; i < testAccounts.length; i++) {
                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    tokenABalancesBefore.push(tokenABalance)
                    tokenBBalancesBefore.push(tokenBBalance)

                    await tokenA.approve(autoStrategy.address, amounts[2], {from: testAccounts[i]})
                    await tokenB.approve(autoStrategy.address, amounts[2], {from: testAccounts[i]})

                    strategyTokenBalancesBefore.push(await strategyToken.balanceOf(testAccounts[i]))
                }

                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                // Deposit
                for (let i = 0; i < testAccounts.length; i++) {
                    txs.push(await autoStrategy.deposit(id, amounts[2], amounts[2], 0, 0, testAccounts[i], {from: testAccounts[i]}))

                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    sentA.push(tokenABalancesBefore[i].sub(tokenABalance))
                    sentB.push(tokenBBalancesBefore[i].sub(tokenBBalance))
                }
            })
            it('fires events', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    expectEvent(txs[i], 'Deposit', {poolID: id, from: testAccounts[i], recipient: testAccounts[i]})
                }
            })
            it('mints tokens', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    assert.ok(strategyTokenBalance.gt(strategyTokenBalancesBefore[i]), `tokens were not minted for ${testAccounts[i]}`)
                }
            })
            it('updates user stakes', async () => {
                const assetRouter = await IUnoAssetRouter.at((await autoStrategy.pools(id))["assetRouter"])
                const pool = (await autoStrategy.pools(id))["pool"]

                const totalSupply = await strategyToken.totalSupply()

                
                for (let i = 0; i < testAccounts.length; i++) {
                    const {stakeA, stakeB, leftoverA, leftoverB} = await autoStrategy.userStake(testAccounts[i])

                    const {stakeLP: assetRouterStakeAStakeLP, stakeA: assetRouterStakeA, stakeB: assetRouterStakeB} = await assetRouter.userStake(autoStrategy.address, pool)

                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    approxeq(stakeA, assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply), new BN(10), `stakeA is not correct for ${testAccounts[i]}`)
                    approxeq(stakeB, assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply), new BN(10), `stakeB is not correct for ${testAccounts[i]}`)
                }
            })
            it('updates total deposits', async () => {
                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                let totalDepositedA = new BN(0)
                let totalDepositedB = new BN(0)

                for (let i = 0; i < testAccounts.length; i++) {
                    totalDepositedA.add(sentA[i])
                    totalDepositedB.add(sentB[i])
                }
                
                approxeq(totalDepositsA.sub(totalDepositsABefore), totalDepositedA, new BN(10), "totalDepositsA is not correct")
                approxeq(totalDepositsB.sub(totalDepositsBBefore), totalDepositedB, new BN(10), "totalDepositsB is not correct")
            })
        })
    })
    describe('Withdraws', () => {
        describe('reverts', () => {
            it('reverts if provided with the wrong poolID', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevert(
                    autoStrategy.withdraw(poolID.add(new BN(1)), 0, 0, 0, account1, {from: account1}),
                    "BAD_POOL_ID"
                )
            })
        })
        describe('withdraw tokens', () => {
            let id
            let receipt
            let tokenABalanceBefore, tokenBBalanceBefore
            let totalDepositsABefore, totalDepositsBBefore
            let strategyTokenBalanceBefore
            let tokensToBurn

            let withdrawnA
            let withdrawnB

            before(async () => {
                id = await autoStrategy.poolID()
    
                const data = await autoStrategy.pools(id)
    
                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])

                await tokenA.approve(autoStrategy.address, amounts[3], {from: account1})
                await tokenB.approve(autoStrategy.address, amounts[3], {from: account1})

                await autoStrategy.deposit(id, amounts[3], amounts[3], 0, 0, account1, {from: account1})
    
                let tokenABalance = await tokenA.balanceOf(account1)
                let tokenBBalance = await tokenB.balanceOf(account1)

                tokenABalanceBefore = tokenABalance
                tokenBBalanceBefore = tokenBBalance

                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                strategyTokenBalanceBefore = await strategyToken.balanceOf(account1)
                tokensToBurn = strategyTokenBalanceBefore

                // Withdraw
                receipt = await autoStrategy.withdraw(id, tokensToBurn, 0, 0, account1, {from: account1})

                tokenABalance = await tokenA.balanceOf(account1)
                tokenBBalance = await tokenB.balanceOf(account1)

                withdrawnA = tokenABalance.sub(tokenABalanceBefore)
                withdrawnB = tokenBBalance.sub(tokenBBalanceBefore)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {poolID: id, from: account1, recipient: account1})
            })
            it('burns tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)

                assert.equal(strategyTokenBalance.toString(), strategyTokenBalanceBefore.sub(tokensToBurn).toString(), "Amount of tokens burnt is not correct")
            })
            it('updates user stakes', async () => {
                const {stakeA, stakeB, leftoverA, leftoverB} = await autoStrategy.userStake(account1)

                const assetRouter = await IUnoAssetRouter.at((await autoStrategy.pools(id))["assetRouter"])
                const pool = (await autoStrategy.pools(id))["pool"]

                const {stakeLP: assetRouterStakeAStakeLP, stakeA: assetRouterStakeA, stakeB: assetRouterStakeB} = await assetRouter.userStake(autoStrategy.address, pool)

                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                const totalSupply = await strategyToken.totalSupply()

                approxeq(stakeA, assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply), new BN(10), "stakeA is not correct")
                approxeq(stakeB, assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply), new BN(10), "stakeB is not correct")

                
            })
            it('updates total deposits', async () => {
                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()
                
                approxeq(totalDepositsABefore.sub(totalDepositsA), withdrawnA, new BN(10), "totalDepositsA is not correct")
                approxeq(totalDepositsBBefore.sub(totalDepositsB), withdrawnB, new BN(10), "totalDepositsB is not correct")
            })
        })
        describe('withdraw tokens for multiple accounts', () => {
            let id
            let receipt
            let tokenABalancesBefore = []
            let tokenBBalancesBefore = []
            let totalDepositsABefore, totalDepositsBBefore
            let strategyTokenBalancesBefore = []
            let tokensToBurn = []

            let withdrawnA = []
            let withdrawnB = []
            const testAccounts = [account2, account3]
            let txs = []
            before(async () => {
                id = await autoStrategy.poolID()
    
                const data = await autoStrategy.pools(id)
    
                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])

                for (let i = 0; i < testAccounts.length; i++) {
                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    await tokenA.approve(autoStrategy.address, amounts[4], {from: testAccounts[i]})
                    await tokenB.approve(autoStrategy.address, amounts[4], {from: testAccounts[i]})

                    await autoStrategy.deposit(id, amounts[4], amounts[4], 0, 0, testAccounts[i], {from: testAccounts[i]})

                    strategyTokenBalancesBefore.push(await strategyToken.balanceOf(testAccounts[i]))
                    tokensToBurn.push(strategyTokenBalancesBefore[i].sub(amounts[5]))

                    tokenABalancesBefore.push(await tokenA.balanceOf(testAccounts[i]))
                    tokenBBalancesBefore.push(await tokenB.balanceOf(testAccounts[i]))
                }

                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                // Withdraw
                for (let i = 0; i < testAccounts.length; i++) {
                    txs.push(await autoStrategy.withdraw(id, tokensToBurn[i], 0, 0, testAccounts[i], {from: testAccounts[i]}))

                    const tokenABalance = await tokenA.balanceOf(testAccounts[i])
                    const tokenBBalance = await tokenB.balanceOf(testAccounts[i])

                    withdrawnA.push(tokenABalance.sub(tokenABalancesBefore[i]))
                    withdrawnB.push(tokenBBalance.sub(tokenBBalancesBefore[i]))
                }
            })
            it('fires events', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    expectEvent(txs[i], 'Withdraw', {poolID: id, from: testAccounts[i], recipient: testAccounts[i]})
                }
            })
            it('burns tokens', async () => {
                const strategyTokenBalance = await strategyToken.balanceOf(account1)
                for (let i = 0; i < testAccounts.length; i++) {
                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    assert.equal(strategyTokenBalance.toString(), strategyTokenBalancesBefore[i].sub(tokensToBurn[i]).toString(), `Amount of tokens burnt is not correct for ${testAccounts[i]}`)
                }

            })
            it('updates user stakes', async () => {
                const assetRouter = await IUnoAssetRouter.at((await autoStrategy.pools(id))["assetRouter"])
                const pool = (await autoStrategy.pools(id))["pool"]

                const totalSupply = await strategyToken.totalSupply()

                for (let i = 0; i < testAccounts.length; i++) {
                    const {stakeA, stakeB, leftoverA, leftoverB} = await autoStrategy.userStake(testAccounts[i])

                    const {stakeLP: assetRouterStakeAStakeLP, stakeA: assetRouterStakeA, stakeB: assetRouterStakeB} = await assetRouter.userStake(autoStrategy.address, pool)

                    const strategyTokenBalance = await strategyToken.balanceOf(testAccounts[i])

                    approxeq(stakeA, assetRouterStakeA.mul(strategyTokenBalance).div(totalSupply), new BN(10), `stakeA is not correct for ${testAccounts[i]}`)
                    approxeq(stakeB, assetRouterStakeB.mul(strategyTokenBalance).div(totalSupply), new BN(10), `stakeB is not correct for ${testAccounts[i]}`)
                }
            })
            it('updates total deposits', async () => {
                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                let totalWithdrawnA = new BN(0)
                let totalWithdrawnB = new BN(0)
                
                for (let i = 0; i < testAccounts.length; i++) {
                    totalWithdrawnA.add(withdrawnA[i])
                    totalWithdrawnB.add(withdrawnB[i])
                }
                
                approxeq(totalDepositsABefore.sub(totalDepositsA), totalWithdrawnA, new BN(10), "totalDepositsA is not correct")
                approxeq(totalDepositsBBefore.sub(totalDepositsB), totalWithdrawnA, new BN(10), "totalDepositsB is not correct")
            })

        })
        
        
    })
    describe('Move Liquidity', () => {
        let snapshotIdBeforeDeposit

        describe('reverts', () => {
            it('reverts if called not by liquidity manager', async () => {
                const poolID = await autoStrategy.poolID()
                await expectRevert(
                    autoStrategy.moveLiquidity(poolID.add(new BN(1)), "0x", "0x", 0, 0, {from: account1}),
                    "CALLER_NOT_LIQUIDITY_MANAGER"
                )
            })
            it('reverts if no liquidity was provided', async () => {
                const poolID = await autoStrategy.poolID()
                
                await timeMachine.revertToSnapshot(snapshotId)
                console.log(`### Reverting to snapshot: ${snapshotId}`)
                
                await expectRevert(
                    autoStrategy.moveLiquidity(poolID.add(new BN(1)), "0x", "0x", 0, 0, {from: liquidityManager}),
                    "NO_LIQUIDITY"
                )
            })
            it('reverts if provided with the wrong poolID', async () => {
                snapshotIdBeforeDeposit = (await timeMachine.takeSnapshot())['result']

                const poolID = await autoStrategy.poolID()

                const data = await autoStrategy.pools(poolID)

                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])

                await tokenA.approve(autoStrategy.address, amounts[3], {from: account1})
                await tokenB.approve(autoStrategy.address, amounts[3], {from: account1})

                await autoStrategy.deposit(poolID, amounts[3], amounts[3], 0, 0, account1, {from: account1})

                await expectRevert(
                    autoStrategy.moveLiquidity(poolID, "0x", "0x", 0, 0, {from: liquidityManager}),
                    "BAD_POOL_ID"
                )
            })
        })
        describe('multiple users stakes and totalDeposits after move liquidity', () => {
            let id
            let receipt
            let totalDepositsABefore, totalDepositsBBefore

            testAccounts = [account2, account3]

            let stakesABefore = []
            let stakesBBefore = []
            let leftoversABefore = []
            let leftoversBBefore = []

            before(async () => {
                id = await autoStrategy.poolID()

                await timeMachine.revertToSnapshot(snapshotIdBeforeDeposit)
                console.log(`### Reverting to snapshot: ${snapshotIdBeforeDeposit}`)

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data["tokenA"])
                const tokenB = await IERC20.at(data["tokenB"])

                for (let i = 0; i < testAccounts.length; i++) {
                    await tokenA.approve(autoStrategy.address, amounts[3], {from: testAccounts[i]})
                    await tokenB.approve(autoStrategy.address, amounts[3], {from: testAccounts[i]})

                    await autoStrategy.deposit(id, amounts[3], amounts[3], 0, 0, testAccounts[i], {from: testAccounts[i]})

                    const { stakeA, stakeB, leftoverA, leftoverB } = await autoStrategy.userStake(testAccounts[i])

                    stakesABefore.push(stakeA)
                    stakesBBefore.push(stakeB)

                    leftoversABefore.push(leftoverA)
                    leftoversBBefore.push(leftoverB)
                }

                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()

                totalDepositsABefore = totalDepositsA
                totalDepositsBBefore = totalDepositsB

                receipt = await autoStrategy.moveLiquidity(id.add(new BN(1)), "0x", "0x", 0, 0, {from: liquidityManager})
            })
            it('user stakes stay the same', async () => {
                for (let i = 0; i < testAccounts.length; i++) {
                    const { stakeA, stakeB, leftoverA, leftoverB } = await autoStrategy.userStake(testAccounts[i])

                    approxeq(stakeA.add(leftoverA), stakesABefore[i], new BN(10), `stakeA is not correct for ${testAccounts[i]}`)
                    approxeq(stakeB.add(leftoverB), stakesBBefore[i], new BN(10), `stakeA is not correct for ${testAccounts[i]}`)
                }
            })
            it('totalDeposits stay the same', async () => {
                const {totalDepositsA, totalDepositsB} = await autoStrategy.totalDeposits()
                approxeq(totalDepositsA, totalDepositsABefore, new BN(10), "totalDepositsA is not correct")
                approxeq(totalDepositsB, totalDepositsBBefore, new BN(10), "totalDepositsB is not correct")
            })
        })
    })
})