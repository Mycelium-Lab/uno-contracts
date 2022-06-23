const { expectRevert, expectEvent, BN, constants } = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const timeMachine = require('ganache-time-traveler')

const IStakingRewards = artifacts.require('IStakingRewards')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniswapV2Router01 = artifacts.require('IUniswapV2Router01')

const AccessManager = artifacts.require('UnoAccessManager') 
const FarmFactory = artifacts.require('UnoFarmFactory') 

const Farm = artifacts.require('UnoFarmQuickswap')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswap')

const pauser = '0x2Aae5d0f3bee441ACc1fb2ABE9C2672A54F4bb48'
const distributor = '0xA7b7DDF752Ed3A9785F747a3694760bB8994e15F'

const quickswapRouter = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"
const pool =  "0xAFB76771C98351Aa7fCA13B130c9972181612b54" //usdt usdc 
const pool2 = "0x28b833473e047f6116C46d8ed5117708eeb151F9" // wmatic wone 
const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(52792912217)]

approxeq = function(bn1, bn2, epsilon, message) {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message);
}

contract('UnoAssetRouterQuickswap', accounts => {
    accounts[0] = "0xA4d07c23F28A1eb1ae471e530c3f5e0038d282F2"//"0xEa6E311c23
    accounts[1] = "0x4AF7f964fb155cc2d59fcD8cA6f2E956d995cBDE"//"0xA7b7DDF752

    let accessManager
    let assetRouter 
    let factory 

    let stakingRewards
    let stakingToken
    let snapshotId

    before(async () => {
        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot['result']

        const implementation = await Farm.new({from: accounts[0]})
        accessManager = await AccessManager.new({from: accounts[0]})

        await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor, {from: accounts[0]}) //DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {from: accounts[0]}) //PAUSER_ROLE

        assetRouter = await deployProxy(
            AssetRouter,
            { kind: 'uups', initializer: false }
        )

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, {from: accounts[0]})

        stakingRewards = await IStakingRewards.at(pool)
        const stakingTokenAddress = await stakingRewards.stakingToken()
        stakingToken = await IUniswapV2Pair.at(stakingTokenAddress)
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async()=>{
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, {from: accounts[0]}),
                "Initializable: contract is already initialized"
            )
        })
    })

    describe('Initializes variables', () => {
        it('Sets accessManager', async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                "accessManager not set"
            )
        })

        it('Sets farmFactory', async()=>{
            assert.equal(
                await assetRouter.farmFactory(),
                factory.address,
                "farmFactory not set"
            )
        })
    })

    let farm
    describe('Deposits', () => {
        it('reverts if total amount provided is zero', async () => {
            await expectRevert(
                assetRouter.deposit(pool, 0, 0, 0, 0, 0, accounts[0], {from: accounts[0]}),
                "NO_LIQUIDITY_PROVIDED"
            )
        })
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[0], accounts[0], {from: accounts[0]})

                const farmAddress = await factory.Farms(pool)
                farm = await Farm.at(farmAddress)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from:accounts[0], recipient: accounts[0], amount:amounts[0]})
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[1], accounts[0], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[0], amount:amounts[1]})
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], {from: accounts[1]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[2], accounts[1], {from: accounts[1]} )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[1], recipient: accounts[1], amount: amounts[2]})
            })
            it("doesn't change stakes for account[0]" ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent changed userStake for accounts[0]"
                )
            })
            it('updates stakes for account[1]' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[3], accounts[1], {from: accounts[0]})
            })
            it('fires event', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[1], amount:amounts[3]})
            })
            it('doesnt change stakes for accounts[0]' ,async () => {
                const { stakeLP } = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "stakeLP is not 0"
                )
            })
            it('updates stakes for accounts[1]' ,async () => {
                const { stakeLP } = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[2].add(amounts[3])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            let balanceAbefore
            let balanceBbefore
            
            let amountA
            let amountB

            let tokenAContract
            let tokenBContract

            let receipt

            before(async () => {
                const tokenA = await stakingToken.token0()
                const tokenB = await stakingToken.token1()

                tokenAContract = await IUniswapV2Pair.at(tokenA)
                tokenBContract = await IUniswapV2Pair.at(tokenB)

                const routerContract = await IUniswapV2Router01.at(quickswapRouter)
                await stakingToken.approve(quickswapRouter, amounts[4], {from: accounts[0]})
                const tx = await routerContract.removeLiquidity(tokenA, tokenB, amounts[4], 1, 1, accounts[0], '16415710000', {from: accounts[0]})
                const event = tx.receipt.rawLogs.find(l => { return l.topics[0] == '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496' })

                amountA = web3.utils.hexToNumberString(event.data.substring(0,66))
                amountB = web3.utils.hexToNumberString('0x' + event.data.substring(66,130))

                balanceAbefore = await tokenAContract.balanceOf(accounts[0])
                balanceBbefore = await tokenBContract.balanceOf(accounts[0])

                await tokenAContract.approve(assetRouter.address, amountA, {from: accounts[0]})
                await tokenBContract.approve(assetRouter.address, amountB, {from: accounts[0]})
            })
            it('reverts if minAmountA > amountA || minAmountB > amountB', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, amountA, new BN(1), amountA, 0, 0, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_A_AMOUNT"
                )
                await expectRevert(
                    assetRouter.deposit(pool, new BN(1), amountB, 0, amountB, 0, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_B_AMOUNT"
                )
            })
            it('fires events', async () => {
                receipt = await assetRouter.deposit(pool, amountA, amountB, 0, 0, 0, accounts[0], {from: accounts[0]})
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[0]})
            })
            it('withdraws tokens from balance', async () => {
                const balanceAafter = await tokenAContract.balanceOf(accounts[0])
                approxeq(balanceAbefore.sub(balanceAafter), new BN(amountA), new BN(10), 'Token A amount is not close enough to the LP amount sent')

                const balanceBafter = await tokenBContract.balanceOf(accounts[0])
                approxeq(balanceBbefore.sub(balanceBafter), new BN(amountB), new BN(10), 'Token B amount is not close enough to the LP amount sent')
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)

                approxeq(stakeLP, amounts[0].add(amounts[1]).add(amounts[4]), new BN(10), "LP Amount sent doesn't equal userStake")//add to stake
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                approxeq(totalDepositsLP, amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]), new BN(10), "Total amount sent doesn't equal totalDeposits")//add to stake
            })
            it('stakes tokens in StakingRewards contract', async () => {
                approxeq(await stakingRewards.balanceOf(farm.address), amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]), new BN(10), "Total amount sent doesn't equal totalDeposits")//add to stake
            })
        })
    })
    describe('withdraw', () => {
        describe('withdraws for multiple accs', () => {
            let balance1before
            let balance2before

            let stake1before
            let stake2before
            
            let receipt1
            let receipt2
            before(async () => {
                balance1before = await stakingToken.balanceOf(accounts[0]);
                balance2before = await stakingToken.balanceOf(accounts[1]);

                ({stakeLP:stake1before} = await assetRouter.userStake(accounts[0], pool));
                ({stakeLP:stake2before} = await assetRouter.userStake(accounts[1], pool));
            
                receipt1 = await assetRouter.withdraw(pool, amounts[0], 0, 0, true, accounts[0], {from: accounts[0]})
                receipt2 = await assetRouter.withdraw(pool, amounts[2], 0, 0, true, accounts[1], {from: accounts[1]})
            })
            it('reverts if the pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool2, amounts[0], 0, 0, true, accounts[0], {from: accounts[0]}),
                    "FARM_NOT_EXISTS"
                )
            })
            it('reverts if the stake is zero', async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, new BN(1), 0, 0, true, accounts[3], {from: accounts[3]})
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, constants.MAX_UINT256, 0, 0, true, accounts[0], {from: accounts[0]})
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, 0, 0, 0, true, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_AMOUNT"
                )
            })
            it('fires events', async () => {
                expectEvent(receipt1, 'Withdraw', {lpPool:pool, from: accounts[0], recipient: accounts[0], amount:amounts[0]})
                expectEvent(receipt2, 'Withdraw', {lpPool:pool, from: accounts[1], recipient: accounts[1], amount:amounts[2]})
            })
        
            it('sets userStake rightly for account accounts[0]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    "Stake is not zero for accounts[0]"
                )
            })
            it('sets userStake rightly for account accounts[1]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    "Stake is not right for accounts[1]"
                )
            })
            it('sets totalDeposits correctly', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before.sub(amounts[0]).add(stake2before.sub(amounts[2])).toString(),
                    "totalDeposits are not right"
                )
            })
            it('transfers tokens to user', async ()=>{
                const balance1after = await stakingToken.balanceOf(accounts[0])
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    amounts[0].toString(),
                    "Tokens withdrawn for accounts[0] do not equal provided in the withdraw function"
                )
                const balance2after = await stakingToken.balanceOf(accounts[1])
                assert.equal(
                    (balance2after.sub(balance2before)),
                    amounts[2].toString(),
                    "Tokens withdrawn for accounts[1] do not equal provided in the withdraw function"
                )
            })
        })
        /*describe('withdraws for different acc', () => {
            let balance1before
            let balance2before
            let receipt
            const amount = lpTokensSent[0].amount
            const withdrawAmount = amount.sub(new BN(100000))
            before(async () => {
                await stakingTokenContract.approve(farmFactory.address, amount, {from: accounts[0]})
                await farmFactory.deposit(0, 0, amount, pool, accounts[0], {from: accounts[0]})
            
                balance1before = await stakingTokenContract.balanceOf(accounts[0])
                balance2before = await stakingTokenContract.balanceOf(accounts[1])
            
                receipt = await farmFactory.withdraw(pool, withdrawAmount, true, false, accounts[1], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {sender: accounts[0], lpPool:pool, amount:withdrawAmount})
            })
            it('sets userStake rightly for account accounts[0]', async () => {
                const {stakeLP} = await farmFactory.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amount.sub(withdrawAmount)).toString(),
                    "Stake is not right for accounts[0]"
                )
            })
            it('doesnt change stake for accounts[1]', async () => {
                const {stakeLP} = await farmFactory.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "Stake is not right for accounts[1]"
                )
            })
            it('transfers tokens to accounts[1]', async ()=>{
                const balance1after = await stakingTokenContract.balanceOf(accounts[0])
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    '0',
                    "Tokens were withdrawn for accounts[0]"
                )
                const balance2after = await stakingTokenContract.balanceOf(accounts[1])
                assert.equal(
                    (balance2after.sub(balance2before)),
                    withdrawAmount.toString(),
                    "Tokens withdrawn for accounts[1] do not equal provided in the withdraw function"
                )
            })
        })
        describe('withdraws in normal tokens', () => {
            let balanceAbefore
            let balanceBbefore
            let receipt
            const amount = lpTokensSent[0].amount

            let amountA
            let amountB
            let tokenAContract
            let tokenBContract
            before(async () => {

                const tokenA = await stakingTokenContract.token0()
                const tokenB = await stakingTokenContract.token1()

                tokenAContract = await IUniswapV2Pair.at(tokenA)
                tokenBContract = await IUniswapV2Pair.at(tokenB)
                const routerContract = await IUniswapV2Router01.at(quickswapRouter)
 
                await stakingTokenContract.approve(quickswapRouter, amount, {from: accounts[0]})
                const tx = await routerContract.removeLiquidity(tokenA, tokenB, amount, 1, 1, accounts[0], '16415710000', {from: accounts[0]})
                const event = tx.receipt.rawLogs.find(l => { return l.topics[0] == '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496' })

                amountA = Web3Utils.hexToNumberString(event.data.substring(0,66))
                amountB = Web3Utils.hexToNumberString('0x' + event.data.substring(66,130))


                await tokenAContract.approve(farmFactory.address, amountA, {from: accounts[0]})
                await tokenBContract.approve(farmFactory.address, amountB, {from: accounts[0]})
    
                await farmFactory.deposit(amountA, amountB, 0, pool, accounts[0], {from: accounts[0]})
                const {stakeLP} = await farmFactory.userStake(accounts[0], pool)
                balanceAbefore = await tokenAContract.balanceOf(accounts[0])
                balanceBbefore = await tokenBContract.balanceOf(accounts[0])
                receipt = await farmFactory.withdraw(pool, stakeLP, false, false, accounts[0], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {sender: accounts[0], lpPool:pool})
            })
            it('sets userStake rightly', async () => {
                const {stakeLP, stakeA, stakeB} = await farmFactory.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "stakeLP is wrong"
                )
                assert.equal(
                    stakeA.toString(),
                    '0',
                    "stakeA is wrong"
                )
                assert.equal(
                    stakeB.toString(),
                    '0',
                    "stakeB is wrong"
                )
            })
            it('sets totalDeposits rightly', async () => {
                const { totalDepositsLP, totalDepositsA, totalDepositsB } = await farmFactory.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    '0',
                    "totalDepositsLP are wrong"
                )
                assert.equal(
                    totalDepositsA.toString(),
                    '0',
                    "totalDepositsA are wrong"
                )
                assert.equal(
                    totalDepositsB.toString(),
                    '0',
                    "totalDepositsB are wrong"
                )
            })
            it('transfers tokens to user', async ()=>{
                const balanceAafter = await tokenAContract.balanceOf(accounts[0])
                approxeq(balanceAafter.sub(balanceAbefore), new BN(amountA), new BN(10), "TokensA withdrawn do not equal deposited")

                const balanceBafter = await tokenBContract.balanceOf(accounts[0])
                approxeq(balanceBafter.sub(balanceBbefore), new BN(amountB), new BN(10), "TokensB withdrawn do not equal deposited")
            })
        })*/
    })
    /*describe('onlyDistributor, onlyPauser, onlyAdmin', () => {

    })*/
    after(async () => {
        await timeMachine.revertToSnapshot(snapshotId)
    })
    //pausable - only for pausers, prevents functions from beeng called
    //router upgradeability
})